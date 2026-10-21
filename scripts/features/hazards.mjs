/**
 * Environmental threats (pp.60–63), vehicles (p.95), healing (p.55), temporary stat loss,
 * and the scheduled events that drive them through game time.
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, statValue, skillValue, evalFormula, isAgent, rawTest } from "../core/system.mjs";
import { update, setStatus, createEffect, effectsWithFlag, deleteEmbedded } from "../core/ops.mjs";
import { postCard, button, registerAction, outcomeBadge, gmWhisper } from "../core/chat.mjs";
import { prompt, esc, options, field } from "../core/ui.mjs";
import { schedule, cancel, registerEventType } from "../core/scheduler.mjs";
import { d10sFromD100 } from "../rules/dice.mjs";
import { resolveLethality } from "../rules/combat.mjs";
import {
  POISONS,
  DISEASES,
  TIME_UNITS,
  FIRE,
  resolvePoison,
  resolveDiseaseInterval,
  fallProfile,
  impactRating,
  coldEndurance,
  suffocationTurns,
  firstAidResult,
  recuperationResult,
  rammingProfile,
} from "../rules/hazards.mjs";
import { applyDamage } from "./injury.mjs";

const conTest = (actor, modifier = 0, context = {}) => systemTest(actor, { type: "stat", key: "con", modifier, context: { noWpCost: true, ...context } });

async function lethalityOn(actor, rating, source) {
  const r = await evalFormula("1d100");
  const res = resolveLethality({ rating, total: r.total, protection: actor.type === "vehicle" ? "huge" : "exposed" });
  await postCard({ actor, title: esc(source), body: `<p>Lethality ${rating}%: rolled ${r.total} → ${res.killed ? "<b>LETHAL</b>" : `${res.damage} damage`}</p>`, rolls: [r] });
  await applyDamage(actor, res.killed ? Infinity : res.damage, { source, quiet: true });
  return res;
}

async function damageOn(actor, formula, source, opts = {}) {
  const r = await evalFormula(formula);
  await postCard({ actor, title: esc(source), body: `<p>${esc(formula)} = <b>${r.total}</b> damage</p>`, rolls: [r] });
  await applyDamage(actor, r.total, { source, quiet: true, ...opts });
  return r.total;
}

/* ---------------- Falls, impacts ---------------- */

export async function fall(actor, { metres, uncontrolled = false }) {
  const p = fallProfile({ metres, uncontrolled });
  const src = `Fall (${metres} m)`;
  const res = p.kind === "damage" ? { killed: false, damage: await damageOn(actor, p.formula, src) } : await lethalityOn(actor, p.rating, src);
  if (!res.killed && actor.system.health.value > 0) await stunCheck(actor, src);
}

export async function impact(actor, { kph, wall = false }) {
  const rating = impactRating({ kph, wall });
  const src = `Impact (${kph} km/h${wall ? ", into a wall" : ""})`;
  const res = rating > 0 ? await lethalityOn(actor, rating, src) : { killed: false };
  if (!res.killed && actor.system.health.value > 0) await stunCheck(actor, src);
}

async function stunCheck(actor, src) {
  if (actor.type === "vehicle") return;
  const { outcome } = await conTest(actor, 0, { stunCheck: true });
  if (!outcome.success) await setStatus(actor, STATUS.stun, true);
  await postCard({ actor, title: `${esc(src)}: stun check`, body: `<p>${esc(actor.name)} ${outcome.success ? "keeps their wits" : "is stunned"}.</p>` });
}

/* ---------------- Fire ---------------- */

export async function burn(actor, intensity) {
  const f = FIRE[intensity];
  if (f.lethality) await lethalityOn(actor, f.lethality, `Fire: ${f.label}`);
  else await damageOn(actor, f.damage, `Fire: ${f.label}`);
  if (intensity !== "minor" && actor.system.health.value > 0 && actor.type !== "vehicle") {
    const { outcome } = await systemTest(actor, { type: "stat", key: "dex", context: { catchFire: true, noWpCost: true } });
    if (!outcome.success) {
      await setStatus(actor, STATUS.onFire, true);
      await update(actor, { [`flags.${MODULE_ID}.fire`]: intensity });
      await postCard({ actor, title: "On fire!", body: `<p>${esc(actor.name)} catches fire: half damage every turn until extinguished. Being set on fire is a 0/1D6 SAN test.</p>${button("sanPreset", "SAN 0/1D6 (set on fire)", { args: { actorUuid: actor.uuid, preset: "setOnFire" }, owner: actor.uuid, once: "fire" })} ${button("extinguish", "Extinguish", { args: { actorUuid: actor.uuid }, once: "ext" })}` });
    }
  }
}

export async function fireTick(actor) {
  const intensity = actor.getFlag(MODULE_ID, "fire") ?? "moderate";
  const f = FIRE[intensity];
  if (f.lethality) {
    const r = await evalFormula("1d100");
    const dice = d10sFromD100(r.total);
    const dmg = Math.ceil((dice[0] + dice[1]) / 2);
    await postCard({ actor, title: "Burning", body: `<p>Half damage while on fire: ${dmg}</p>`, rolls: [r] });
    await applyDamage(actor, dmg, { source: "Burning", quiet: true });
  } else await damageOn(actor, `ceil((${f.damage})/2)`, "Burning");
}

registerAction("extinguish", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  await setStatus(actor, STATUS.onFire, false);
  await update(actor, { [`flags.${MODULE_ID}.-=fire`]: null });
  return "Out";
});

/* ---------------- Suffocation ---------------- */

export async function startSuffocation(actor, { tookBreath }) {
  const turns = suffocationTurns({ con: statValue(actor, "con"), tookBreath });
  await update(actor, { [`flags.${MODULE_ID}.suffocation`]: { left: turns } });
  await setStatus(actor, STATUS.suffocating, true);
  await postCard({ actor, title: "Holding breath", body: `<p>${esc(actor.name)} can last ${turns} turns (CON×5) before damage starts. Each turn after: CON×5 — failure 1D6 damage, success 1. Armor doesn't help.</p>${button("breathe", "Can breathe again", { args: { actorUuid: actor.uuid }, once: "breathe" })} ${button("suffocateTick", "Advance one turn", { args: { actorUuid: actor.uuid } })}` });
}

export async function suffocationTick(actor) {
  const s = actor.getFlag(MODULE_ID, "suffocation");
  if (!s) return;
  if (s.left > 0) {
    await update(actor, { [`flags.${MODULE_ID}.suffocation.left`]: s.left - 1 });
    return;
  }
  const { outcome } = await conTest(actor, 0, { suffocation: true });
  if (outcome.success) {
    await postCard({ actor, title: "Suffocating", body: "<p>1 damage.</p>" });
    await applyDamage(actor, 1, { source: "Suffocation", quiet: true });
  } else await damageOn(actor, "1d6", "Suffocation");
}

registerAction("breathe", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  await update(actor, { [`flags.${MODULE_ID}.-=suffocation`]: null });
  await setStatus(actor, STATUS.suffocating, false);
  return "Breathing";
});
registerAction("suffocateTick", async ({ args }) => {
  await suffocationTick(await fromUuid(args.actorUuid));
  return false;
});

/* ---------------- Cold ---------------- */

export async function startCold(actor, { preparation }) {
  const secs = coldEndurance({ con: statValue(actor, "con"), preparation });
  await cancel({ type: "cold", actorUuid: actor.uuid });
  await schedule({ type: "cold", delay: secs, actorUuid: actor.uuid, label: `${actor.name}: cold sets in` });
  await postCard({ actor, title: "Exposure to cold", body: `<p>${esc(actor.name)} lasts ${Math.round(secs / 60)} minutes before CON×5 tests every five minutes begin (p.63). Advance game time to proceed.</p>${button("warmUp", "Reached warmth and shelter", { args: { actorUuid: actor.uuid }, once: "warm" })}` });
}

registerEventType("cold", async (evt, actor) => {
  if (!actor) return null;
  const con = actor.system.statistics.con;
  const eff = con.effectiveValue ?? con.value;
  if (eff <= 1) {
    await damageOn(actor, "1d8", "Cold");
  } else {
    const { outcome } = await conTest(actor, 0, { cold: true });
    if (!outcome.success) await tempStatLoss(actor, "con", 1, { source: "Cold", restore: "warmth" });
  }
  return { reschedule: evt.due + 300 };
});

registerAction("warmUp", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  await cancel({ type: "cold", actorUuid: actor.uuid });
  const fx = effectsWithFlag(actor, "tempStat").filter((e) => e.getFlag(MODULE_ID, "tempStat")?.restore === "warmth");
  const total = fx.reduce((a, e) => a + (e.getFlag(MODULE_ID, "tempStat")?.amount ?? 0), 0);
  if (total) await schedule({ type: "warmth", delay: 60, actorUuid: actor.uuid, label: `${actor.name} warms up` });
  return "Warming";
});

registerEventType("warmth", async (evt, actor) => {
  if (!actor) return null;
  const more = await restoreTempStat(actor, { restore: "warmth" });
  return more ? { reschedule: evt.due + 60 } : null;
});

/* ---------------- Temporary stat loss ---------------- */

export async function tempStatLoss(actor, stat, amount, { source = "", restore = "daily" } = {}) {
  const existing = effectsWithFlag(actor, "tempStat").find((e) => e.getFlag(MODULE_ID, "tempStat")?.stat === stat && e.getFlag(MODULE_ID, "tempStat")?.restore === restore);
  if (existing) {
    const cur = existing.getFlag(MODULE_ID, "tempStat");
    const amt = cur.amount + amount;
    await update(existing, { changes: [{ key: `system.statistics.${stat}.modifier`, type: "add", value: String(-amt), phase: "final" }], [`flags.${MODULE_ID}.tempStat.amount`]: amt, name: `Temporary ${stat.toUpperCase()} −${amt}` });
  } else {
    await createEffect(actor, {
      name: `Temporary ${stat.toUpperCase()} −${amount}`,
      img: "icons/svg/downgrade.svg",
      changes: [{ key: `system.statistics.${stat}.modifier`, type: "add", value: String(-amount), phase: "final" }],
      flags: { tempStat: { stat, amount, restore, source } },
    });
  }
}

/** Restore 1 point of each temporarily lost stat. Returns true if anything remains. */
export async function restoreTempStat(actor, { restore = "daily" } = {}) {
  let remaining = false;
  for (const e of effectsWithFlag(actor, "tempStat")) {
    const t = e.getFlag(MODULE_ID, "tempStat");
    if (t.restore !== restore) continue;
    const amt = t.amount - 1;
    if (amt <= 0) await deleteEmbedded(actor, "ActiveEffect", [e.id]);
    else {
      remaining = true;
      await update(e, { changes: [{ key: `system.statistics.${t.stat}.modifier`, type: "add", value: String(-amt), phase: "final" }], [`flags.${MODULE_ID}.tempStat.amount`]: amt, name: `Temporary ${t.stat.toUpperCase()} −${amt}` });
    }
  }
  return remaining;
}

/* ---------------- Poison & disease ---------------- */

export async function startPoison(actor, key, { custom = null } = {}) {
  const def = custom ?? POISONS[key];
  const speed = await evalFormula(def.speed);
  const delay = speed.total * (TIME_UNITS[def.unit] ?? 3600);
  await schedule({ type: "poison", delay, actorUuid: actor.uuid, data: { def, antidote: false }, label: `${actor.name}: ${def.label} takes effect` });
  await postCard({
    actor,
    title: `Poisoned: ${esc(def.label)}`,
    body: `<p>Takes effect in ${speed.total} ${def.unit}. Lethality ${def.lethality}%. ${def.antidote ? "An antidote exists: Medicine or Pharmacy before onset renders it harmless; after onset halves Lethality and damage." : "No antidote."}</p>
      ${def.antidote ? button("antidote", "Administer antidote", { args: { actorUuid: actor.uuid } }) : ""}`,
    rolls: [speed],
    whisper: gmWhisper(),
  });
}

registerEventType("poison", async (evt, actor) => {
  if (!actor) return null;
  const def = evt.data.def;
  const hospital = actor.getFlag(MODULE_ID, "hospitalized") ? 20 : 0;
  const lr = await evalFormula("1d100");
  const rating = evt.data.antidote ? Math.floor(def.lethality / 2) : def.lethality;
  let conOutcome = { success: false, critical: false, fumble: false };
  if (lr.total > rating) conOutcome = (await conTest(actor, hospital, { poison: true })).outcome;
  const res = resolvePoison({ lethality: def.lethality, lethalityTotal: lr.total, dice: d10sFromD100(lr.total), conOutcome, antidoteAfterOnset: !!evt.data.antidote });
  await postCard({ actor, title: `${esc(def.label)} takes effect`, body: `<p>Lethality ${res.rating}%: ${lr.total} → ${res.killed ? "<b>LETHAL</b>" : `${res.damage} damage after CON×5${hospital ? " (+20% hospitalized)" : ""}`}</p>`, rolls: [lr] });
  await applyDamage(actor, res.killed ? Infinity : res.damage, { source: def.label, quiet: true });
  return null;
});

registerAction("antidote", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const healers = game.actors.filter((a) => a.isOwner && ["agent", "npc"].includes(a.type));
  const r = await prompt({ title: "Antidote", content: field("Who administers it?", `<select name="h">${healers.map((h) => `<option value="${h.id}">${esc(h.name)} (Medicine ${skillValue(h, "medicine")} / Pharmacy ${skillValue(h, "pharmacy")})</option>`).join("")}</select>`) + field("Skill", `<select name="s"><option value="medicine">Medicine</option><option value="pharmacy">Pharmacy</option></select>`) });
  if (!r) return false;
  const healer = game.actors.get(r.data.h);
  const { outcome } = await systemTest(healer, { type: "skill", key: r.data.s, context: { antidote: true } });
  if (!outcome.success) return false;
  const { events } = await import("../core/scheduler.mjs");
  const pending = events().filter((e) => e.type === "poison" && e.actorUuid === actor.uuid);
  if (pending.length) {
    await cancel({ type: "poison", actorUuid: actor.uuid });
    await postCard({ actor, title: "Antidote", body: `<p>Given before onset: the poison is rendered harmless.</p>` });
  } else {
    await postCard({ actor, title: "Antidote", body: `<p>Too late to prevent it — if the effect is still ongoing, halve its Lethality and damage (Handler).</p>` });
  }
  return "Given";
});

export async function startDisease(actor, key, { def = null, resurgence = false } = {}) {
  def ??= DISEASES[key];
  const speed = await evalFormula(def.speed);
  const delay = speed.total * (TIME_UNITS[def.unit] ?? 86400);
  await schedule({ type: "disease", delay, actorUuid: actor.uuid, data: { key, def }, label: `${actor.name}: ${def.label} interval` });
  const data = { [`flags.${MODULE_ID}.diseased`]: true };
  if (def.persistent) {
    const list = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "persistentDiseases") ?? []);
    if (!list.some((d) => d.key === key)) list.push({ key, def });
    data[`flags.${MODULE_ID}.persistentDiseases`] = list;
  }
  await update(actor, data);
  await postCard({ actor, title: `${resurgence ? "Resurgence" : "Infected"}: ${esc(def.label)}`, body: `<p>Speed ${def.speed} ${def.unit}; CON test ${def.penalty || "±0"}%; damage ${def.damage}. Cure: ${esc(def.cure)}. While sick, no HP can be regained.</p>`, rolls: [speed], whisper: gmWhisper() });
}

registerEventType("disease", async (evt, actor) => {
  if (!actor) return null;
  const { key, def } = evt.data;
  const hospital = actor.getFlag(MODULE_ID, "hospitalized") ? 20 : 0;
  const { outcome } = await conTest(actor, (def.penalty || 0) + hospital, { disease: key });
  const dmgRoll = await evalFormula(def.damage);
  const res = resolveDiseaseInterval({ rolledDamage: dmgRoll.total, conOutcome: outcome });
  await postCard({ actor, title: esc(def.label), body: `<p>${outcomeBadge(outcome)}: ${res.damage} damage. ${res.recovered ? (def.persistent ? "It subsides — for now." : "They recover.") : "Another test after the next interval."}</p>`, rolls: [dmgRoll] });
  if (res.damage) await applyDamage(actor, res.damage, { source: def.label, quiet: true });
  if (res.recovered) {
    await update(actor, { [`flags.${MODULE_ID}.-=diseased`]: null });
    return null;
  }
  const speed = await evalFormula(def.speed);
  return { reschedule: evt.due + speed.total * (TIME_UNITS[def.unit] ?? 86400) };
});

/* ---------------- Vehicles ---------------- */

export async function ram({ vehicle, target, speed, seatbelts = false, passengers = [], rammedPassengers = [] }) {
  const max = Number(vehicle.system.health.max) || 10;
  const p = rammingProfile({ speed, vehicleMaxHp: max });
  const src = `Rammed by ${vehicle.name}`;
  const armor = Number(vehicle.system.health.protection ?? 0);
  if (target) {
    if (p.kind === "damage") await damageOn(target, p.formula, src);
    else {
      const huge = target.type === "vehicle";
      const r = await evalFormula("1d100");
      const res = resolveLethality({ rating: p.rating, total: r.total, protection: huge ? "huge" : "exposed", bodyArmor: Number(target.system.health?.protection ?? 0), ap: armor });
      await postCard({ actor: target, title: esc(src), body: `<p>Lethality ${p.rating}% (vehicle armor ${armor} acts as armor piercing): ${r.total} → ${res.killed ? "<b>LETHAL</b>" : res.damage}</p>`, rolls: [r] });
      await applyDamage(target, res.killed ? Infinity : res.damage, { source: src, quiet: true });
    }
  }
  const targetHuge = target?.type === "vehicle" || target?.getFlag?.(MODULE_ID, "protection") === "huge";
  if (targetHuge) {
    // The ramming vehicle suffers half ramming damage based on the target's HP.
    const back = rammingProfile({ speed, vehicleMaxHp: Number(target.system.health.max) || 10 });
    if (back.kind === "damage") await damageOn(vehicle, `floor((${back.formula})/2)`, `${vehicle.name} (ramming a huge target)`);
    else await lethalityOn(vehicle, Math.floor(back.rating / 2), `${vehicle.name} (ramming a huge target)`);
  }
  for (const a of passengers) if (targetHuge) await damageOn(a, seatbelts ? "floor(1d6/2)" : "1d6", "Collision (ramming)");
  for (const a of rammedPassengers) await damageOn(a, seatbelts ? "floor(2d6/2)" : "2d6", "Collision (rammed)");
}

/* ---------------- Healing (p.55) ---------------- */

export async function firstAid(healer, patient) {
  if (patient.system.physical?.firstAidAttempted && patient.system.health.value > 0) {
    ui.notifications.warn(`${patient.name} has already had first aid since their last injury.`);
    return;
  }
  if (patient.system.health.value <= 0) return resuscitate(healer, patient);
  const { outcome } = await systemTest(healer, { type: "skill", key: "first_aid", context: { firstAid: patient.uuid } });
  const res = firstAidResult(outcome);
  if (res.heal) {
    const r = await evalFormula(res.heal === "2d4x" ? "2*(1d4)" : res.heal);
    await heal(patient, r.total, `First Aid by ${healer.name}`, [r]);
  } else if (res.damage) {
    await damageOn(patient, res.damage, `Botched First Aid by ${healer.name}`);
  }
  if (isAgent(patient)) await update(patient, { "system.physical.firstAidAttempted": true });
}

async function resuscitate(healer, patient) {
  const died = patient.getFlag(MODULE_ID, "deathTime");
  const window = statValue(patient, "con") * 60;
  if (died != null && game.time.worldTime - died > window) {
    ui.notifications.warn(`Too late: resuscitation must happen within ${statValue(patient, "con")} minutes of death.`);
    return;
  }
  const { outcome } = await systemTest(healer, { type: "skill", key: "first_aid", context: { resuscitate: patient.uuid } });
  if (outcome.success) {
    const r = await evalFormula(outcome.critical ? "2*(1d4)" : "1d4");
    await setStatus(patient, STATUS.dead, false);
    await heal(patient, r.total, `Resuscitated by ${healer.name}`, [r]);
  } else {
    await update(patient, { [`flags.${MODULE_ID}.beyondHelp`]: true });
    await postCard({ actor: patient, title: "Resuscitation fails", body: `<p>${esc(patient.name)} dies and cannot be resuscitated.</p>` });
  }
}

export async function heal(actor, amount, source, rolls = []) {
  if (actor.getFlag(MODULE_ID, "diseased")) {
    await postCard({ actor, title: esc(source), body: `<p>${esc(actor.name)} is sick: no HP can be regained while the disease lasts.</p>` });
    return 0;
  }
  const before = actor.system.health.value;
  const after = Math.min(actor.system.health.max, before + amount);
  await update(actor, { "system.health.value": after });
  if (after >= 3) await setStatus(actor, STATUS.unconscious, false);
  if (after >= actor.system.health.max) await update(actor, { [`flags.${MODULE_ID}.-=treated`]: null });
  await postCard({ actor, title: esc(source), body: `<p>${esc(actor.name)}: ${before} → <b>${after}</b> HP</p>`, rolls });
  return after - before;
}

export async function treatment(patient, { doctor = null, skill = "medicine", target = null, penalty = 0 }) {
  const last = patient.getFlag(MODULE_ID, "lastTreatment");
  if (last != null && game.time.worldTime - last < TIME_UNITS.weeks) {
    const ok = await (await import("../core/ui.mjs")).confirm("Treatment", `<p>Treatment is once per week; the last was ${Math.round((game.time.worldTime - last) / 86400)} days ago. Roll anyway?</p>`);
    if (!ok) return;
  }
  const res = doctor ? await systemTest(doctor, { type: "skill", key: skill, modifier: penalty, context: { treatment: patient.uuid } }) : await rawTest({ target, modifier: penalty, label: `Treatment (${skill})`, actor: patient });
  const o = res.outcome;
  await update(patient, { [`flags.${MODULE_ID}.lastTreatment`]: game.time.worldTime, [`flags.${MODULE_ID}.treated`]: true });
  if (o.success) {
    const r = await evalFormula(o.critical ? "2*(1d4)" : "1d4");
    await heal(patient, r.total, "Treatment", [r]);
  } else if (o.fumble) await damageOn(patient, "1d4", "Botched treatment");
}

export async function recuperate(actor) {
  const last = actor.getFlag(MODULE_ID, "lastRecuperation");
  if (last != null && game.time.worldTime - last < TIME_UNITS.days - 60) {
    ui.notifications.info(`${actor.name} already rolled recuperation today.`);
    return;
  }
  await update(actor, { [`flags.${MODULE_ID}.lastRecuperation`]: game.time.worldTime });
  const { outcome } = await conTest(actor, 0, { recuperation: true });
  const res = recuperationResult(outcome);
  if (res.heal) {
    const r = await evalFormula(res.heal);
    await heal(actor, r.total, "Recuperation", [r]);
  } else if (res.damage) await applyDamage(actor, 1, { source: "Recuperation setback" });
}

/** Strenuous activity after treatment tears sutures (p.55). */
export async function complicationsHook(roll) {
  if (!setting("complications")) return;
  const actor = roll.actor;
  if (!actor?.getFlag?.(MODULE_ID, "treated")) return;
  if (actor.system.health.value >= actor.system.health.max) return;
  const { STRENUOUS_SKILLS, PHYSICAL_STATS } = await import("../core/constants.mjs");
  const physical = (roll.type === "stat" && PHYSICAL_STATS.includes(roll.key)) || (["skill", "weapon"].includes(roll.type) && STRENUOUS_SKILLS.has(roll.key));
  if (!physical || roll.options?.dgOps?.noWpCost) return;
  await damageOn(actor, "1d4", "Complications (sutures rip, bones shift)");
}

/* ---------------- Daily tick ---------------- */

registerEventType("daily", async (evt) => {
  const day = evt.due;
  for (const actor of game.actors.filter((a) => ["agent", "npc"].includes(a.type))) {
    if (setting("tempStatRestore")) await restoreTempStat(actor, { restore: "daily" });
    if (setting("autoRecuperation") && actor.getFlag(MODULE_ID, "resting") && actor.system.health.value < actor.system.health.max) await recuperate(actor);
    if (setting("addictionClock") && isAgent(actor)) {
      const { addictionCheck } = await import("./wellbeing.mjs");
      await addictionCheck(actor);
    }
  }
  return { reschedule: day + TIME_UNITS.days };
});

registerEventType("removeEffectFlag", async (evt, actor) => {
  if (!actor) return null;
  const fx = effectsWithFlag(actor, evt.data.flag);
  if (fx.length) await deleteEmbedded(actor, "ActiveEffect", fx.map((e) => e.id));
  return null;
});

/* ---------------- Hazard dialog ---------------- */

export async function hazardDialog(actors) {
  if (!actors.length) return ui.notifications.warn("Select tokens first.");
  const r = await prompt({
    title: "Hazard",
    width: 520,
    content: `<p>For: <b>${actors.map((a) => esc(a.name)).join(", ")}</b></p>
      ${field("Hazard", `<select name="h">
        <option value="fall">Fall</option><option value="impact">Impact</option><option value="fire">Fire</option>
        <option value="poison">Poison</option><option value="disease">Disease</option><option value="suffocate">Suffocation</option>
        <option value="cold">Cold</option><option value="damage">Plain damage</option><option value="lethality">Plain Lethality</option></select>`)}
      ${field("Metres / km/h / amount", `<input type="text" name="n" value="5" style="width:6em">`, "Fall height in metres, impact speed in km/h, damage formula or Lethality %.")}
      ${field("Fire", `<select name="fire">${options(Object.fromEntries(Object.entries(FIRE).map(([k, v]) => [k, v.label])), "moderate")}</select>`)}
      ${field("Poison", `<select name="poison">${options(Object.fromEntries(Object.entries(POISONS).map(([k, v]) => [k, `${v.label} (${v.lethality}%)`])))}</select>`)}
      ${field("Disease", `<select name="disease">${options(Object.fromEntries(Object.entries(DISEASES).map(([k, v]) => [k, v.label])))}</select>`)}
      ${field("Cold preparation", `<select name="prep"><option value="none">Unprepared</option><option value="partial">Partially prepared</option><option value="full">Fully equipped</option></select>`)}
      <label class="dgops-radio"><input type="checkbox" name="flag"> Uncontrolled fall / into a wall / took a breath first</label>`,
    buttons: [{ action: "ok", label: "Apply", default: true }],
  });
  if (!r) return;
  const d = r.data;
  for (const actor of actors) {
    switch (d.h) {
      case "fall":
        await fall(actor, { metres: Number(d.n) || 0, uncontrolled: d.flag });
        break;
      case "impact":
        await impact(actor, { kph: Number(d.n) || 0, wall: d.flag });
        break;
      case "fire":
        await burn(actor, d.fire);
        break;
      case "poison":
        await startPoison(actor, d.poison);
        break;
      case "disease":
        await startDisease(actor, d.disease);
        break;
      case "suffocate":
        await startSuffocation(actor, { tookBreath: d.flag });
        break;
      case "cold":
        await startCold(actor, { preparation: d.prep });
        break;
      case "lethality":
        await lethalityOn(actor, Number(d.n) || 0, "Lethality");
        break;
      default:
        await damageOn(actor, d.n || "1d6", "Damage");
    }
  }
}

export async function medicalDialog(patients) {
  if (!patients.length) return ui.notifications.warn("Select the patient's token.");
  const healers = game.actors.filter((a) => ["agent", "npc"].includes(a.type) && (a.isOwner || game.user.isGM));
  const r = await prompt({
    title: "Medical care",
    width: 500,
    content: `<p>Patient(s): <b>${patients.map((p) => esc(`${p.name} ${p.system.health.value}/${p.system.health.max} HP`)).join(", ")}</b></p>
      ${field("Care", `<select name="c"><option value="firstAid">First Aid / stabilize (or resuscitate)</option><option value="treatment">Treatment (hospital, weekly)</option><option value="recuperate">Recuperation (CON×5, daily)</option><option value="rest">Toggle 'resting' for automatic daily recuperation</option><option value="hospital">Toggle hospitalized (+20% vs poison/disease)</option></select>`)}
      ${field("Caregiver", `<select name="h"><option value="">— none / off-sheet doctor —</option>${healers.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("")}</select>`)}
      ${field("Treatment skill", `<select name="s"><option value="medicine">Medicine</option><option value="surgery">Surgery</option></select>`)}
      ${field("Off-sheet doctor's skill %", `<input type="number" name="t" value="60" style="width:5em">`)}
      ${field("Penalty for poor facilities", `<input type="number" name="p" value="0" step="10" style="width:5em">`)}`,
  });
  if (!r) return;
  const d = r.data;
  const healer = d.h ? game.actors.get(d.h) : null;
  for (const p of patients) {
    if (d.c === "firstAid") {
      if (!healer) return ui.notifications.warn("First Aid needs a caregiver.");
      await firstAid(healer, p);
    } else if (d.c === "treatment") await treatment(p, { doctor: healer, skill: d.s, target: d.t, penalty: d.p });
    else if (d.c === "recuperate") await recuperate(p);
    else if (d.c === "rest") {
      const v = !p.getFlag(MODULE_ID, "resting");
      await update(p, { [`flags.${MODULE_ID}.resting`]: v });
      ui.notifications.info(`${p.name} ${v ? "is resting" : "is no longer resting"}.`);
    } else if (d.c === "hospital") {
      const v = !p.getFlag(MODULE_ID, "hospitalized");
      await update(p, { [`flags.${MODULE_ID}.hospitalized`]: v });
      ui.notifications.info(`${p.name} ${v ? "is hospitalized" : "has left hospital"}.`);
    }
  }
}

export async function vehicleDialog() {
  const vehicles = game.actors.filter((a) => a.type === "vehicle");
  const sceneActors = canvas.scene?.tokens.map((t) => t.actor).filter(Boolean) ?? [];
  if (!vehicles.length) return ui.notifications.warn("No vehicle actors exist.");
  const r = await prompt({
    title: "Ramming / collision",
    width: 520,
    content: `${field("Ramming vehicle", `<select name="v">${vehicles.map((v) => `<option value="${v.uuid}">${esc(v.name)} (${v.system.health.value}/${v.system.health.max} HP)</option>`).join("")}</select>`)}
      ${field("Target", `<select name="t"><option value="">— none —</option>${sceneActors.map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select>`)}
      ${field("Speed", `<select name="s"><option value="low">Low (1D6)</option><option value="lowHeavy">Low, heavy (2D6)</option><option value="moderate">Moderate (½ vehicle HP as Lethality)</option><option value="high">High (vehicle HP as Lethality, max 30%)</option></select>`)}
      <p>Passengers in the ramming vehicle:</p>${sceneActors.filter((a) => a.type !== "vehicle").map((a) => `<label class="dgops-radio"><input type="checkbox" data-multi name="pa" value="${a.uuid}"> ${esc(a.name)}</label>`).join("")}
      <p>Passengers in the rammed vehicle:</p>${sceneActors.filter((a) => a.type !== "vehicle").map((a) => `<label class="dgops-radio"><input type="checkbox" data-multi name="pb" value="${a.uuid}"> ${esc(a.name)}</label>`).join("")}
      <label class="dgops-radio"><input type="checkbox" name="belt"> Seat belts / air bags (half passenger damage)</label>`,
  });
  if (!r) return;
  const vehicle = await fromUuid(r.data.v);
  const target = r.data.t ? await fromUuid(r.data.t) : null;
  const pa = await Promise.all((r.data.pa ?? []).map((u) => fromUuid(u)));
  const pb = await Promise.all((r.data.pb ?? []).map((u) => fromUuid(u)));
  await ram({ vehicle, target, speed: r.data.s, seatbelts: r.data.belt, passengers: pa, rammedPassengers: pb });
}

