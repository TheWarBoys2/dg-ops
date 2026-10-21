/**
 * Impossible Landscapes: the Yellow Sign, Interference, tomes, Soul Bottles and metal-and-porcelain
 * damage, plus the SAN hooks they need (the Repeater check, max loss after a destroyed bottle).
 */
import { postCard, button, registerAction, gmWhisper, list } from "../../core/chat.mjs";
import { evalFormula, skillValue } from "../../core/system.mjs";
import { update } from "../../core/ops.mjs";
import { prompt, esc, field, options } from "../../core/ui.mjs";
import { playerOwners } from "../../core/team.mjs";
import { schedule, cancel, registerEventType, events } from "../../core/scheduler.mjs";
import { sanCap } from "../../rules/sanity.mjs";
import { resolveLethality } from "../../rules/combat.mjs";
import { runForActor } from "../../features/sanity.mjs";
import { applyDamage } from "../../features/injury.mjs";
import { addSanPreCheck, onSanResult, addDamageFilter, addStudySource } from "../../core/extensions.mjs";
import { YELLOW_SIGN, INTERFERENCE_DELAY, interferenceFor, bottleSearch, BOTTLE_OPEN, BOTTLE_SEARCH_HOURS, metalAndPorcelain, TOMES, tomeSummary, BEACON, BOTTLE_FLOOR } from "./rules.mjs";
import { il, corruptionOf, adjustCorruption, setIl, setIlQuietly, gmCard } from "./state.mjs";

const TAG = { sign: "il:yellowSign", open: "il:openBottle" };

const ownersAndGm = (actor) => {
  const ids = new Set(gmWhisper());
  for (const u of playerOwners(actor)) ids.add(u.id);
  return [...ids];
};

/* ------------------------------------------------------------------------ */
/*  SAN hooks                                                               */
/* ------------------------------------------------------------------------ */

function sanPreCheck({ actor, params }) {
  const d = il(actor);
  const out = {};
  if (params.tags?.includes(TAG.sign) && d.yellowSign?.failed) out.skip = `${actor.name} has already failed a SAN roll against the Yellow Sign, so seeing it again costs nothing (p.347).`;
  if (d.bottleDestroyed) out.maxOnFail = true;
  return out;
}

async function sanResult({ actor, params, result }) {
  if (actor?.type !== "agent" || result?.skipped) return;
  const tags = params.tags ?? [];
  // The Yellow Sign: once failed, never again; any loss adds Corruption and the compulsion (p.347).
  if (tags.includes(TAG.sign) && result.outcome && !result.outcome.success) {
    await setIlQuietly(actor, { yellowSign: { failed: true, shared: false } });
    if (result.loss > 0) {
      await adjustCorruption(actor, 1, { rule: true, reason: "The Yellow Sign" });
      await postCard({ actor, title: "The mark", body: `<p>${esc(actor.name)} can't stop thinking about the shape they saw. They'd feel better if someone else saw it too: they have to draw, write or paint it somewhere it will be seen. Until they do, sleep brings only nightmares they can't remember (p.347).</p><div class="dgops-buttons">${button("ilSignShared", "They've shared it", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: "shared" })}</div>`, whisper: ownersAndGm(actor) });
    }
  }
  // Opening one's own Soul Bottle (p.344).
  if (tags.includes(TAG.open)) {
    if (result.sanAfter > 0) {
      const roll = await evalFormula("1d20", {}, { whisper: gmWhisper() });
      const capSan = sanCap({ unnatural: actor.system.skills?.unnatural?.proficiency ?? 0, maxBonus: actor.system.sanity?.maxBonus ?? 0 });
      const before = Number(actor.system.sanity.value) || 0;
      const after = Math.min(capSan, before + roll.total);
      await update(actor, { "system.sanity.value": after }, { dgOpsSan: true });
      // +5 first, then the floor (the floor would otherwise lift the starting value before the +5).
      await adjustCorruption(actor, 5, { rule: true, reason: "Listened to their Soul Bottle" });
      await setIlQuietly(actor, { corruptionFloor: true });
      await postCard({ actor, title: "The bottle whispers", body: `<p>${esc(actor.name)} listens, and keeps their mind. SAN +${after - before} (now ${after}).</p>`, rolls: [roll], whisper: ownersAndGm(actor) });
      await gmCard(actor, { title: "Soul Bottle", body: `<p>+5 Corruption; it can never drop below ${BOTTLE_FLOOR} again (p.344). Use the whisper to deliver whatever the bottle says.</p>` });
    } else {
      await setIlQuietly(actor, { vanished: true });
      await postCard({ actor, title: "Gone", body: `<p>${esc(actor.name)} opens the bottle, leans in to listen… and isn't there any more. The Agent belongs to the Handler now, though they might be seen again in Carcosa (p.344).</p>`, kind: "alert" });
    }
  }
  // 0 SAN at Corruption 10: a Repeater (p.18).
  if (result.permanentInsanity && corruptionOf(actor) >= BEACON && !il(actor).repeater) {
    await setIlQuietly(actor, { repeater: true });
    await gmCard(actor, { title: "Repeater", body: `<p>${esc(actor.name)} reaches 0 SAN at Corruption 10 and becomes a Repeater, a shadow that haunts Carcosa forever (pp.18, 341).</p>`, kind: "alert" });
  }
}

/* ------------------------------------------------------------------------ */
/*  The Yellow Sign                                                          */
/* ------------------------------------------------------------------------ */

export async function yellowSign(actors) {
  const list_ = (actors ?? []).filter((a) => a?.type === "agent");
  if (!list_.length) return ui.notifications.warn("Select the Agents who see it.");
  const out = [];
  for (const a of list_) {
    out.push(await runForActor(a, { successLoss: YELLOW_SIGN.success, failureLoss: YELLOW_SIGN.failure, category: YELLOW_SIGN.category, source: "The Yellow Sign", tags: [TAG.sign] }));
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Interference (p.351)                                                     */
/* ------------------------------------------------------------------------ */

/** The operator stepped out of the circle: something finds them in 4D6 hours. */
export async function interference(actor) {
  if (!game.user.isGM) return ui.notifications.warn("Interference is rolled by the Handler.");
  if (!actor) return ui.notifications.warn("Select the operator.");
  const roll = await evalFormula(INTERFERENCE_DELAY, {}, { whisper: gmWhisper() });
  await schedule({ type: "ilMisfortune", delay: roll.total * 3600, actorUuid: actor.uuid, data: { hours: roll.total }, label: `Misfortune finds ${actor.name}` });
  await postCard({ actor, title: "Interference", subtitle: "Handler only", body: `<p>${esc(actor.name)} left the circle before the seal was inscribed. In <b>${roll.total} hours</b> of game time something random and violent finds them. It's on the Console's schedule; the kind of misfortune depends on their Corruption when it lands.</p>`, rolls: [roll], whisper: gmWhisper(), tip: "Interference, The Preliminary Invocation to Primeumaton (p.351)." });
  return roll.total;
}

export async function misfortune(actor) {
  if (!actor) return null;
  const m = interferenceFor(corruptionOf(actor));
  const lines = [`${esc(actor.name)}: ${esc(m.label)}. Nothing ties it to anything; however hard anyone looks, it was just bad luck.`];
  let rolls = [];
  if (m.lethality) {
    const r = await evalFormula("1d100");
    rolls = [r];
    const res = resolveLethality({ rating: m.lethality, total: r.total });
    lines.push(`Lethality ${m.lethality}%: rolled ${r.total} → ${res.killed ? "<b>LETHAL</b>" : `${res.damage} damage`}`);
    await postCard({ actor, title: "Misfortune", body: list(lines), rolls, kind: "damage" });
    await applyDamage(actor, res.killed ? Infinity : res.damage, { source: "Misfortune", quiet: true });
  } else {
    const r = await evalFormula(m.damage);
    rolls = [r];
    lines.push(`${m.damage} = <b>${r.total}</b> damage`);
    await postCard({ actor, title: "Misfortune", body: list(lines), rolls, kind: "damage" });
    await applyDamage(actor, r.total, { source: "Misfortune", quiet: true });
  }
  return m;
}

/* ------------------------------------------------------------------------ */
/*  Tomes (pp.348–350)                                                       */
/* ------------------------------------------------------------------------ */

function artSkills(actor) {
  return Object.entries(actor.system.typedSkills ?? {}).filter(([, s]) => /^art\b/i.test(String(s.group ?? "")));
}

/**
 * Read an Impossible Landscapes tome in one step: the SAN cost, Unnatural, an Art skill (or other
 * skill) and Corruption. Returns a summary for the Home-scene study card when called from there.
 */
export async function readTome(actor, tomeId = null, { home = false } = {}) {
  if (!actor) return ui.notifications.warn("Select the reader.");
  let tome = TOMES.find((t) => t.id === tomeId);
  const arts = artSkills(actor);
  let artKey = null;
  if (!tome || (tome.art && arts.length > 1)) {
    const r = await prompt({
      title: `Read a tome: ${actor.name}`,
      width: 520,
      content: `${field("Tome", `<select name="t">${options(Object.fromEntries(TOMES.map((t) => [t.id, `${t.name}: ${tomeSummary(t)}`])), tome?.id)}</select>`)}
        ${arts.length ? field("Art skill", `<select name="art">${options(Object.fromEntries(arts.map(([k, s]) => [k, `${s.label} (${s.proficiency}%)`])))}</select>`, "Tomes that raise an Art skill raise this one.") : `<p class="hint">${esc(actor.name)} has no Art skills; any Art gain is noted, not applied. Add the skill on the sheet and raise it by hand.</p>`}`,
      buttons: [{ action: "ok", label: "Read it", default: true }, { action: "no", label: "Cancel" }],
    });
    if (r?.action !== "ok") return null;
    tome = TOMES.find((t) => t.id === r.data.t);
    artKey = r.data.art ?? null;
  } else artKey = arts[0]?.[0] ?? null;
  if (!tome) return null;

  const lines = [`Study time: ${tome.study}.`];
  const data = {};
  const sys = actor.system;
  let un = sys.skills?.unnatural?.proficiency ?? 0;
  if (tome.unnatural) {
    un = Math.min(99, un + tome.unnatural);
    data["system.skills.unnatural.proficiency"] = un;
    lines.push(`Unnatural +${tome.unnatural}% (now ${un}%).`);
  }
  if (tome.art) {
    if (artKey) {
      const s = sys.typedSkills[artKey];
      const v = Math.min(99, (Number(s.proficiency) || 0) + tome.art);
      data[`system.typedSkills.${artKey}.proficiency`] = v;
      lines.push(`${esc(s.label)} +${tome.art}% (now ${v}%).`);
    } else lines.push(`One Art skill +${tome.art}% (none on the sheet).`);
  }
  if (tome.skill) {
    const v = Math.min(99, skillValue(actor, tome.skill.key) + tome.skill.gain);
    if (sys.skills?.[tome.skill.key]) data[`system.skills.${tome.skill.key}.proficiency`] = v;
    lines.push(`${esc(sys.skills?.[tome.skill.key]?.label ?? tome.skill.key)} +${tome.skill.gain}% (now ${v}%).`);
  }
  const capSan = sanCap({ unnatural: un, maxBonus: sys.sanity?.maxBonus ?? 0 });
  if (sys.sanity.value > capSan) data["system.sanity.value"] = capSan;
  if (Object.keys(data).length) await update(actor, data, { dgOpsSan: true });

  const rolls = [];
  if (tome.san?.fixed) {
    const r = await evalFormula(tome.san.fixed);
    if (r.dice?.length) rolls.push(r);
    await runForActor(actor, { fixedLoss: r.total, category: tome.san.category ?? "unnatural", source: tome.name });
    lines.push(`SAN −${r.total}${r.dice?.length ? ` (${tome.san.fixed})` : ""}.`);
  } else if (tome.san) {
    await runForActor(actor, { successLoss: tome.san.success, failureLoss: tome.san.failure, category: tome.san.category ?? "unnatural", source: tome.name });
    lines.push(`SAN test ${tome.san.success}/${tome.san.failure}.`);
  }
  if (tome.corruption) await adjustCorruption(actor, tome.corruption, { rule: true, reason: tome.name });
  if (tome.opens) lines.push("Reading it opens the reader to the King in Yellow.");
  if (tome.obsession) lines.push("At their next Breaking Point the reader develops an obsession with finding a complete copy of the play.");
  if (!home) await postCard({ actor, title: `Read: ${esc(tome.name)}`, body: list(lines), rolls, tip: `${esc(tome.name)}, p.${tome.page}.` });
  return { line: `Read <b>${esc(tome.name)}</b> (p.${tome.page})`, notes: lines, rolls };
}

/* ------------------------------------------------------------------------ */
/*  Soul Bottles (pp.343–344)                                                */
/* ------------------------------------------------------------------------ */

export async function bottleSearchRoll(actor) {
  const roll = await evalFormula("1d100", {}, { whisper: gmWhisper() });
  const c = corruptionOf(actor);
  const res = bottleSearch(roll.total + c);
  const btns = [];
  if (res.key === "own") {
    btns.push(button("ilOpenBottle", "Open it (SAN 1D10/1D100)", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: "open" }));
    btns.push(button("ilDestroyBottle", "It's destroyed unopened", { args: { actorUuid: actor.uuid }, once: "destroy" }));
  }
  await postCard({ actor, title: "Soul Bottle search", subtitle: "Handler only", body: `<p>${esc(actor.name)}, after ${BOTTLE_SEARCH_HOURS} hours in the Whisper Labyrinth: ${roll.total} + ${c} = <b>${roll.total + c}</b>. ${esc(res.label)}</p>${btns.length ? `<div class="dgops-buttons">${btns.join("")}</div>` : ""}`, rolls: [roll], whisper: gmWhisper(), tip: "Soul Bottle search table (p.344)." });
  return res;
}

/** Roll now, and (optionally) again every 8 hours of game time until stopped. */
export async function bottleSearchDialog(actors) {
  if (!game.user.isGM) return ui.notifications.warn("The Handler rolls the Soul Bottle search.");
  if (!actors?.length) return ui.notifications.warn("Select the Agents searching the labyrinth.");
  const searching = new Set(events().filter((e) => e.type === "ilBottleSearch").map((e) => e.actorUuid));
  const r = await prompt({
    title: "Soul Bottle search",
    content: `<p>After each ${BOTTLE_SEARCH_HOURS} hours in the Whisper Labyrinth, 1D100 + Corruption (p.344).</p>
      ${actors.map((a) => `<p>${esc(a.name)}${searching.has(a.uuid) ? " <em>(searching every 8 h)</em>" : ""}</p>`).join("")}`,
    buttons: [
      { action: "now", label: "Roll now", default: true },
      { action: "every", label: "Every 8 h of game time" },
      { action: "stop", label: "Stop searching" },
    ],
  });
  if (!r) return null;
  for (const a of actors) {
    if (r.action === "now") await bottleSearchRoll(a);
    if (r.action === "every" && !searching.has(a.uuid)) await schedule({ type: "ilBottleSearch", delay: BOTTLE_SEARCH_HOURS * 3600, actorUuid: a.uuid, label: `${a.name} searches the Whisper Labyrinth` });
    if (r.action === "stop") await cancel({ type: "ilBottleSearch", actorUuid: a.uuid });
  }
  return r.action;
}

export async function openBottle(actor) {
  if (!actor) return null;
  return runForActor(actor, { successLoss: BOTTLE_OPEN.success, failureLoss: BOTTLE_OPEN.failure, category: BOTTLE_OPEN.category, source: "Opening their Soul Bottle", tags: [TAG.open] });
}

export async function destroyBottle(actor) {
  if (!actor) return null;
  await setIl(actor, { bottleDestroyed: true });
  await postCard({ actor, title: "Bottle destroyed", subtitle: "Handler only", body: `<p>${esc(actor.name)}'s unopened bottle is gone. A listless nihilism settles on them for good: from now on every failed SAN roll takes the greatest possible loss (p.344).</p>`, whisper: gmWhisper(), kind: "alert" });
  return true;
}

/* ------------------------------------------------------------------------ */
/*  Metal and porcelain                                                      */
/* ------------------------------------------------------------------------ */

function porcelainFilter({ actor, kind, rolled, res }) {
  if (!il(actor).metalPorcelain) return null;
  return metalAndPorcelain({ kind, rolled, res });
}

export async function toggleMetalPorcelain(actors) {
  const list_ = (actors ?? []).filter((a) => a && a.type !== "agent");
  if (!list_.length) return ui.notifications.warn("Select the Clockwork Child or Marionette tokens.");
  for (const a of list_) {
    const on = !il(a).metalPorcelain;
    await setIl(a, { metalPorcelain: on });
    ui.notifications.info(`${a.name}: metal and porcelain ${on ? "on" : "off"}.`);
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/*  Registration                                                             */
/* ------------------------------------------------------------------------ */

export function registerEvents() {
  addSanPreCheck(sanPreCheck);
  onSanResult(sanResult);
  addDamageFilter(porcelainFilter);
  for (const t of TOMES) addStudySource({ id: `il-${t.id}`, group: "Impossible Landscapes", label: `${t.name} (p.${t.page})`, run: (actor, ctx) => readTome(actor, t.id, ctx) });

  registerEventType("ilMisfortune", async (evt, actor) => {
    await misfortune(actor);
  });
  registerEventType("ilBottleSearch", async (evt, actor) => {
    if (!actor || il(actor).vanished) return null;
    const res = await bottleSearchRoll(actor);
    return res.key === "own" ? null : { reschedule: evt.due + BOTTLE_SEARCH_HOURS * 3600 };
  });

  registerAction("ilSignShared", async ({ args }) => {
    const actor = await fromUuid(args.actorUuid);
    if (!actor) return false;
    await setIlQuietly(actor, { yellowSign: { ...(il(actor).yellowSign ?? {}), failed: true, shared: true } });
    return "Shared";
  });
  registerAction("ilOpenBottle", async ({ args }) => {
    const actor = await fromUuid(args.actorUuid);
    await openBottle(actor);
    return "Opened";
  });
  registerAction("ilDestroyBottle", async ({ args }) => {
    if (!game.user.isGM) return false;
    await destroyBottle(await fromUuid(args.actorUuid));
    return "Destroyed";
  });
}
