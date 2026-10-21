/**
 * Between operations: Home pursuits, getting fired, prosecution (pp.78–81),
 * plus the shared effect applier used by money/requisition.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, luckTest, statValue, skillValue, evalFormula, rawTest } from "../core/system.mjs";
import { update } from "../core/ops.mjs";
import { postCard, list, outcomeBadge, gmWhisper } from "../core/chat.mjs";
import { prompt, esc, options, field } from "../core/ui.mjs";
import { bonds, chooseBond, adjustBond, adjustBondByFormula, createBond, isDGBond, maxBond } from "../core/bonds.mjs";
import { percentileOutcome } from "../rules/dice.mjs";
import { sanCap } from "../rules/sanity.mjs";
import * as H from "../rules/home.mjs";
import { disordersOf, runForActor } from "./sanity.mjs";
import { requestAction, registerContinuation, playerMustRoll } from "../core/requests.mjs";

registerContinuation("homePursuit", async ({ id }, ctx) => {
  await runPursuit(ctx.actor, id, { handOver: false });
  return { label: "Played" };
});

/** A quick d100 test whose dice go into a summary card instead of separate messages. */
export async function quietTest(target, modifier = 0) {
  const roll = await evalFormula("1d100");
  const eff = Math.max(1, Math.min(99, target + modifier));
  return { roll, outcome: percentileOutcome(roll.total, eff), target: eff };
}

const sanTestFor = (actor, modifier = 0, ctx = {}) => systemTest(actor, { type: "sanity", key: "sanity", modifier, context: { home: true, ...ctx } });

/**
 * Apply effect descriptors from rules/home.mjs.
 * ctx: { bond (pre-chosen), key (skill/stat for improve), kind, therapistName, notes[] }
 */
export async function applyEffects(actor, effects, ctx = {}) {
  const notes = ctx.notes ?? [];
  const rolls = [];
  for (const fx of effects) {
    switch (fx.kind) {
      case "san": {
        let n = fx.amount;
        if (typeof n === "string") {
          const r = await evalFormula(n);
          rolls.push(r);
          n = r.total;
        }
        const before = actor.system.sanity.value;
        let cap = sanCap({ unnatural: actor.system.skills.unnatural.proficiency, maxBonus: actor.system.sanity.maxBonus ?? 0, pow: statValue(actor, "pow"), homeCap: fx.cap === "pow5" });
        if (n > 0 && before >= cap) cap = before;
        const after = Math.max(0, n > 0 ? Math.min(cap, before + n) : before + n);
        await update(actor, { "system.sanity.value": after }, { dgOpsSan: true });
        notes.push(`SAN ${n >= 0 ? "+" : ""}${n} (${before} → ${after})${n > 0 && before + n > cap ? ` — capped at ${cap}` : ""}`);
        break;
      }
      case "bond": {
        const targets = await bondTargets(actor, fx, ctx);
        if (!targets.length) {
          notes.push(fx.target.includes("NonDG") ? "No non-Delta Green Bonds to affect." : "No Bonds to affect.");
          break;
        }
        for (const [bond, amount] of targets) {
          const r = await adjustBondByFormula(actor, bond, amount, { reason: ctx.reason });
          notes.push(`${esc(bond.name)} ${r.amount >= 0 ? "+" : ""}${r.amount} (${r.before} → ${r.after})${r.broken ? " — <b>broken</b>" : ""}`);
        }
        break;
      }
      case "newBond": {
        const name = ctx.newBondName || "New Bond";
        const score = Math.ceil(maxBond(actor) / 2);
        await createBond(actor, { name, score, relationship: ctx.newBondRelationship ?? "" });
        notes.push(`New Bond: ${esc(name)} (${score})`);
        break;
      }
      case "therapistBond": {
        const name = ctx.therapistName || "Therapist";
        const existing = actor.itemTypes.bond.find((b) => b.name === name);
        if (existing) {
          const r = await adjustBondByFormula(actor, existing, "1d4");
          notes.push(`Bond with ${esc(name)} +${r.amount}`);
        } else {
          await createBond(actor, { name, score: Math.ceil(maxBond(actor) / 2), relationship: "Therapist" });
          notes.push(`New Bond with ${esc(name)} (${Math.ceil(maxBond(actor) / 2)})`);
        }
        break;
      }
      case "cureDisorder": {
        const ds = disordersOf(actor, { activeOnly: true });
        if (!ds.length) break;
        let d = ds[0];
        if (ds.length > 1) {
          const r = await prompt({ title: "Cure which disorder?", content: ds.map((x, i) => `<label class="dgops-radio"><input type="radio" name="d" value="${x.id}" ${i ? "" : "checked"}> ${esc(x.name)}</label>`).join("") });
          d = actor.items.get(r?.data?.d) ?? d;
        }
        await update(d, { "system.disorderCured": true, "system.acuteEpisode": false });
        notes.push(`<b>Cured:</b> ${esc(d.name)} (kept on the sheet; it may return with the next disorder)`);
        break;
      }
      case "skillUp":
      case "statUp": {
        const key = ctx.key;
        if (fx.kind === "statUp") {
          const cur = actor.system.statistics[key].value;
          const after = Math.min(18, cur + 1);
          await update(actor, { [`system.statistics.${key}.value`]: after });
          notes.push(`${key.toUpperCase()} ${cur} → ${after}`);
        } else {
          const r = await evalFormula(fx.amount);
          rolls.push(r);
          const path = actor.system.skills[key] ? `system.skills.${key}.proficiency` : `system.typedSkills.${key}.proficiency`;
          const cur = foundry.utils.getProperty(actor, path) ?? 0;
          const after = Math.min(99, cur + r.total);
          await update(actor, { [path]: after });
          notes.push(`${esc(labelFor(actor, key))} ${cur}% → ${after}%`);
        }
        break;
      }
      case "cash": {
        const r = await evalFormula(fx.amount);
        rolls.push(r);
        const cur = actor.getFlag(MODULE_ID, "illicitCash") ?? 0;
        await update(actor, { [`flags.${MODULE_ID}.illicitCash`]: cur + r.total });
        notes.push(`Illicit cash +${r.total} Standard purchases (now ${cur + r.total})`);
        break;
      }
      case "fired":
        notes.push(`<b>Job on the line.</b>`);
        await firedFlow(actor);
        break;
      case "prosecute":
        notes.push(`<b>Prosecution.</b>`);
        await prosecutionFlow(actor);
        break;
      case "note":
        if (fx.handlerOnly) await postCard({ actor, title: "Handler note", body: `<p>${esc(fx.text)}</p>`, whisper: gmWhisper() });
        else notes.push(esc(fx.text));
        break;
      default:
        break;
    }
  }
  return { notes, rolls };
}

async function bondTargets(actor, fx, ctx) {
  const nonDG = fx.target.includes("NonDG");
  const pool = bonds(actor, { nonDG });
  if (!pool.length) return [];
  const amount = fx.amount;
  switch (fx.target) {
    case "chosen":
    case "chosenNonDG": {
      if (ctx.bond && pool.some((b) => b.id === ctx.bond.id) && !fx.other) return [[ctx.bond, amount]];
      const b = await chooseBond(actor, { nonDG, title: `${ctx.reason ?? "Bond"}: ${typeof amount === "number" ? (amount > 0 ? `+${amount}` : amount) : amount}`, reason: ctx.reason });
      return b ? [[b, amount]] : [];
    }
    case "eachNonDG":
    case "eachAll":
      return pool.map((b) => [b, amount]);
    case "handlerNonDG": {
      const r = await prompt({ title: "Handler: which Bond takes the brunt?", content: pool.map((b, i) => `<label class="dgops-radio"><input type="radio" name="b" value="${b.id}" ${i ? "" : "checked"}> ${esc(b.name)}</label>`).join("") });
      const main = actor.items.get(r?.data?.b) ?? pool[0];
      return pool.map((b) => [b, b.id === main.id ? amount : fx.othersAmount ?? -1]);
    }
    default:
      return [];
  }
}

function labelFor(actor, key) {
  const s = actor.system.skills?.[key];
  if (s) return s.label ?? key;
  const t = actor.system.typedSkills?.[key];
  return t ? `${t.group} (${t.label})` : key;
}

function skillOptions(actor, { stats = true, excludeUnnatural = true } = {}) {
  const out = {};
  if (stats) for (const k of ["str", "con", "dex", "int", "pow", "cha"]) out[`stat:${k}`] = `${k.toUpperCase()} (${actor.system.statistics[k].value})`;
  for (const [k, s] of Object.entries(actor.system.skills)) if (!(excludeUnnatural && k === "unnatural")) out[`skill:${k}`] = `${s.label ?? k} (${s.proficiency}%)`;
  for (const [k, s] of Object.entries(actor.system.typedSkills ?? {})) out[`skill:${k}`] = `${s.group} (${s.label}) (${s.proficiency}%)`;
  return out;
}

/* ------------------------------------------------------------------------ */
/*  Pursuits                                                                 */
/* ------------------------------------------------------------------------ */

export async function runPursuit(actor, id, { handOver = true } = {}) {
  // A Home scene is the player's to play: if the Handler starts one for a connected player's Agent,
  // the player gets a card to run it themselves.
  if (handOver && game.user.isGM && playerMustRoll(actor)) {
    await requestAction(actor, {
      title: `${actor.name}: ${H.PURSUITS[id]?.label ?? id}`,
      reason: `<p>The Handler has started this Home scene pursuit. Click to play it out (rolls, Bond choices and all).</p>`,
      choices: [{ label: `Play ${H.PURSUITS[id]?.label ?? id}`, icon: "fas fa-house", run: "homePursuit", args: { id } }],
      blocking: false,
      direct: null,
      kind: "home",
    });
    return;
  }
  const notes = [];
  const rolls = [];
  const title = H.PURSUITS[id]?.label ?? id;
  const ctx = { notes, reason: title };
  let fx = [];
  let outcomeLine = "";
  switch (id) {
    case "fulfill": {
      ctx.bond = await chooseBond(actor, { nonDG: true, title: "Which Bond does the Agent support?" });
      if (!ctx.bond) return ui.notifications.warn("Fulfill Responsibilities needs a non-Delta Green Bond.");
      const { outcome } = await sanTestFor(actor);
      outcomeLine = `Supporting ${esc(ctx.bond.name)}: ${outcomeBadge(outcome)}`;
      fx = H.fulfillEffects(outcome);
      break;
    }
    case "nature":
    case "motivation": {
      const { outcome } = await sanTestFor(actor);
      outcomeLine = outcomeBadge(outcome);
      fx = id === "nature" ? H.natureEffects(outcome) : H.motivationEffects(outcome);
      break;
    }
    case "newBond": {
      const r = await prompt({ title: "Establish a new Bond", content: `${field("Person or small group", `<input type="text" name="n" placeholder="e.g. My sister Ana">`)}${field("Relationship", `<input type="text" name="rel">`)}` });
      if (!r?.data?.n) return;
      ctx.newBondName = r.data.n;
      ctx.newBondRelationship = r.data.rel;
      const { outcome } = await systemTest(actor, { type: "stat", key: "cha", context: { home: true } });
      outcomeLine = `CHA×5 to bond with ${esc(r.data.n)}: ${outcomeBadge(outcome)}`;
      fx = H.newBondEffects(outcome);
      break;
    }
    case "therapy": {
      const r = await prompt({
        title: "Go to Therapy",
        content: `${field("Tell the truth about the SAN loss?", `<select name="truth"><option value="yes">Yes (risky)</option><option value="no">No (operational security)</option></select>`)}
          ${field("Therapist", `<input type="text" name="name" value="Therapist">`)}
          ${field("Roll", `<select name="how"><option value="luck">Luck roll</option><option value="skill">Therapist's Psychotherapy</option></select> <input type="number" name="skill" value="50" style="width:5em">`)}
          <label class="dgops-radio"><input type="checkbox" name="disbelief"> The therapist thinks the stories are lies or delusions (−20%)</label>`,
      });
      if (!r) return;
      const truthful = r.data.truth === "yes";
      const mod = truthful && r.data.disbelief ? -20 : 0;
      const res = r.data.how === "skill" ? await rawTest({ target: r.data.skill, modifier: mod, label: `${r.data.name}: Psychotherapy`, actor }) : await luckTest(actor, { modifier: mod, context: { home: true } });
      outcomeLine = `${truthful ? "Honest" : "Guarded"} therapy: ${outcomeBadge(res.outcome)}`;
      ctx.therapistName = r.data.name;
      fx = H.therapyEffects(res.outcome, { truthful, hasDisorder: disordersOf(actor, { activeOnly: true }).length > 0 });
      if (truthful) notes.push("If the trauma was unnatural, the Handler decides whether the therapist believes it — and whether they lose SAN. Talk of imminent illegal violence may be reported.");
      break;
    }
    case "specialTraining": {
      const r = await prompt({ title: "Special Training", content: `${field("Training", `<input type="text" name="n" placeholder="e.g. Lockpicks, Parachuting">`)}${field("Rolled with", `<select name="a">${options(skillOptions(actor))}</select>`)}` });
      if (!r?.data?.n) return;
      const [, key] = r.data.a.split(":");
      const list2 = foundry.utils.duplicate(actor.system.specialTraining ?? []);
      list2.push({ attribute: key, id: foundry.utils.randomID(), name: r.data.n });
      await update(actor, { "system.specialTraining": list2 });
      outcomeLine = `Gains special training: ${esc(r.data.n)} (${esc(key)})`;
      fx = [{ kind: "bond", target: "chosenNonDG", amount: -1 }];
      break;
    }
    case "stayOnCase": {
      const crim = skillValue(actor, "criminology");
      const occ = skillValue(actor, "occult");
      const useOcc = occ > crim;
      const res = await rawTest({ target: useOcc ? occ : crim, label: `${actor.name} — Stay on the Case (${useOcc ? "Occult" : "Criminology"})`, whisper: gmWhisper() });
      outcomeLine = "The Handler rolls in secret.";
      fx = H.stayOnCaseEffects(res.outcome);
      break;
    }
    case "improve": {
      const opts = skillOptions(actor);
      const r = await prompt({
        title: "Improve Skills or Stats",
        content: `<p>Two separate skills or stats, or one of each. Each test that <b>fails</b> improves: +3D6% to a skill (max 99%) or +1 to a stat (max 18). Each increase costs a non-Delta Green Bond 1.</p>${field("First", `<select name="a">${options(opts)}</select>`)}${field("Second", `<select name="b"><option value="">—</option>${options(opts)}</select>`)}`,
      });
      if (!r) return;
      const picks = [r.data.a, r.data.b].filter(Boolean);
      if (picks.filter((p) => p.startsWith("stat:")).length > 1) return ui.notifications.warn("At most one stat per vignette.");
      const lines = [];
      for (const p of picks) {
        const [kind, key] = p.split(":");
        const target = kind === "stat" ? statValue(actor, key) * 5 : skillValue(actor, key);
        const t = await quietTest(target);
        rolls.push(t.roll);
        lines.push(`${esc(kind === "stat" ? key.toUpperCase() : labelFor(actor, key))}: ${t.roll.total} vs ${t.target} ${outcomeBadge(t.outcome)}`);
        const out = await applyEffects(actor, H.improveEffects(t.outcome, { kind }), { ...ctx, key, notes: [] });
        notes.push(...out.notes);
        rolls.push(...out.rolls);
      }
      outcomeLine = lines.join("<br>");
      fx = [];
      break;
    }
    case "studyUnnatural": {
      const tomes = actor.itemTypes.tome ?? [];
      const r = await prompt({
        title: "Study the Unnatural",
        content: `${field("Source", `<select name="t"><option value="">Other (case files, data…)</option>${tomes.map((t) => `<option value="${t.id}">${esc(t.name)} (+${t.system.unnaturalSkillIncrease}% Unnatural)</option>`).join("")}</select>`)}${field("Unnatural gain %", `<input type="number" name="n" value="${tomes[0]?.system.unnaturalSkillIncrease ?? 1}" style="width:5em">`)}<p class="hint">The Handler describes the results. One Bond loses 1D4.</p>`,
      });
      if (!r) return;
      const tome = r.data.t ? actor.items.get(r.data.t) : null;
      const gain = Number(r.data.n) || tome?.system.unnaturalSkillIncrease || 1;
      const un = Math.min(99, actor.system.skills.unnatural.proficiency + gain);
      const data = { "system.skills.unnatural.proficiency": un };
      const cap = sanCap({ unnatural: un, maxBonus: actor.system.sanity.maxBonus ?? 0 });
      if (actor.system.sanity.value > cap) data["system.sanity.value"] = cap;
      await update(actor, data, { dgOpsSan: true });
      outcomeLine = `Unnatural +${gain}% (now ${un}%; max SAN ${cap})`;
      if (tome) notes.push(`The tome's own SAN cost (${tome.system.sanity.successLoss}/${tome.system.sanity.failedLoss}) applies when the Handler says so.`);
      fx = [{ kind: "bond", target: "chosen", amount: "-1d4" }];
      break;
    }
    case "raiseCash": {
      const r = await prompt({ title: "Raise Illicit Cash", content: field("Method", `<select name="s"><option value="accounting">Accounting (embezzlement)</option><option value="bureaucracy">Bureaucracy (misappropriation)</option><option value="criminology">Criminology (theft, black market)</option></select>`) });
      if (!r) return;
      const { outcome } = await systemTest(actor, { type: "skill", key: r.data.s, context: { home: true } });
      outcomeLine = outcomeBadge(outcome);
      fx = H.raiseCashEffects(outcome);
      break;
    }
    case "squander": {
      const r = await prompt({ title: "Squander Illicit Cash", content: `${field("Level", `<select name="l"><option value="major">Major expense</option><option value="extreme">Extreme expense</option></select>`)}${field("Roll", `<select name="how"><option value="accounting">Accounting</option><option value="luck">Luck</option></select>`)}` });
      if (!r) return;
      const mod = r.data.l === "extreme" ? -20 : 0;
      const res = r.data.how === "luck" ? await luckTest(actor, { modifier: mod }) : await systemTest(actor, { type: "skill", key: "accounting", modifier: mod });
      const units = r.data.l === "extreme" ? 125 : 25;
      const cur = actor.getFlag(MODULE_ID, "illicitCash") ?? 0;
      await update(actor, { [`flags.${MODULE_ID}.illicitCash`]: Math.max(0, cur - units) });
      outcomeLine = `${outcomeBadge(res.outcome)} — ${cur < units ? "<b>more than the stash holds</b>; " : ""}${units} Standard units spent`;
      fx = H.squanderEffects(res.outcome, { level: r.data.l });
      break;
    }
    default:
      return;
  }
  const out = await applyEffects(actor, fx, ctx);
  rolls.push(...out.rolls);
  await update(actor, { [`flags.${MODULE_ID}.homePursuit`]: { id, t: game.time.worldTime } });
  await postCard({ actor, title: `Home: ${esc(title)}`, body: `<p>${outcomeLine}</p>${list(notes)}`, rolls });
}

/* ------------------------------------------------------------------------ */
/*  Fired / prosecuted (p.80)                                                */
/* ------------------------------------------------------------------------ */

async function bondChaTests(actor, { colleagueIds = [], convicted = false } = {}) {
  const cha = statValue(actor, "cha") * 5;
  const lines = [];
  const rolls = [];
  for (const b of bonds(actor)) {
    const t = await quietTest(cha, colleagueIds.includes(b.id) ? -20 : 0);
    rolls.push(t.roll);
    const amount = convicted ? H.bondStressConvicted(t.outcome) : H.bondStressAfter(t.outcome);
    if (!amount) {
      lines.push(`${esc(b.name)}: ${t.roll.total}/${t.target} — holds`);
      continue;
    }
    const n = typeof amount === "number" ? amount : (await evalFormula(amount)).total;
    const r = await adjustBond(actor, b, -n, { reason: convicted ? "conviction" : "stress" });
    lines.push(`${esc(b.name)}: ${t.roll.total}/${t.target} — −${n} (${r.before} → ${r.after})`);
  }
  return { lines, rolls };
}

async function colleaguePick(actor) {
  const bs = bonds(actor);
  if (!bs.length) return [];
  const r = await prompt({ title: "Colleagues from the job", content: `<p>Bonds with colleagues from the job test at −20%.</p>${bs.map((b) => `<label class="dgops-radio"><input type="checkbox" data-multi name="c" value="${b.id}" ${b.getFlag(MODULE_ID, "colleague") ? "checked" : ""}> ${esc(b.name)}</label>`).join("")}` });
  return r?.data?.c ?? [];
}

export async function firedFlow(actor) {
  const r = await prompt({
    title: `Job on the line — ${actor.name}`,
    content: `${field("Situation", `<select name="how"><option value="cha">Win back the supervisor: CHA×5</option><option value="persuade">Little hope: Persuade for mere suspension</option><option value="bureaucracy">Little hope: Bureaucracy for mere suspension</option><option value="fired">Fired outright</option></select>`)}${field("Modifier", `<input type="number" name="m" value="0" step="10" style="width:5em">`)}`,
  });
  if (!r) return;
  if (r.data.how !== "fired") {
    const res = r.data.how === "cha" ? await systemTest(actor, { type: "stat", key: "cha", modifier: r.data.m }) : await systemTest(actor, { type: "skill", key: r.data.how, modifier: r.data.m });
    if (res.outcome.success) {
      await postCard({ actor, title: "Kept the job", body: `<p>${esc(actor.name)} ${r.data.how === "cha" ? "gets back into the supervisor's good graces" : "gets off with a suspension or disciplinary action"}.</p>` });
      return;
    }
  }
  const colleagueIds = await colleaguePick(actor);
  await update(actor, { [`flags.${MODULE_ID}.fired`]: game.time.worldTime });
  await runForActor(actor, { successLoss: "0", failureLoss: "1", category: "helplessness", source: "Fired" });
  const { lines, rolls } = await bondChaTests(actor, { colleagueIds });
  await postCard({ actor, title: "Fired", body: `<p>Less access to official resources — but Delta Green will still call.</p>${list(lines)}`, rolls });
}

export async function prosecutionFlow(actor) {
  const r = await prompt({
    title: `Prosecution — ${actor.name}`,
    content: `${field("Case", `<select name="case"><option value="0">Ordinary</option><option value="-20">Especially strong (−20%)</option><option value="20">Especially weak, or Delta Green pulls strings (+20%)</option></select>`)}
      <label class="dgops-radio"><input type="checkbox" name="law" ${skillValue(actor, "law") ? "checked" : ""}> Work the system first with Law (${skillValue(actor, "law")}%): success +20 (crit +40), failure −20 (fumble −40)</label>`,
  });
  if (!r) return;
  let mod = Number(r.data.case) || 0;
  if (r.data.law && skillValue(actor, "law") > 0) {
    const { outcome } = await systemTest(actor, { type: "skill", key: "law", context: { prosecution: true } });
    mod += H.lawPrepModifier(outcome);
  }
  const { outcome } = await luckTest(actor, { modifier: mod, context: { prosecution: true } });
  const colleagueIds = [];
  if (outcome.success) {
    const { lines, rolls } = await bondChaTests(actor, { colleagueIds });
    await postCard({ actor, title: "Acquitted", body: `<p>The case is dropped or ends in acquittal — but the stress is terrible.</p>${list(lines)}`, rolls });
    return;
  }
  await update(actor, { [`flags.${MODULE_ID}.fired`]: game.time.worldTime, [`flags.${MODULE_ID}.convicted`]: game.time.worldTime });
  await runForActor(actor, { successLoss: "0", failureLoss: "1D4", category: "helplessness", source: "Convicted" });
  const { lines, rolls } = await bondChaTests(actor, { colleagueIds, convicted: true });
  await postCard({ actor, title: "Convicted", body: `<p>Convicted at trial or pleads guilty, and loses their job. Prison, probation and/or catastrophic fines: the Handler decides.</p>${list(lines)}`, rolls });
}

/* ------------------------------------------------------------------------ */
/*  Summary and closing the Home scene                                       */
/* ------------------------------------------------------------------------ */

export function whatChanged(actor) {
  const since = actor.getFlag(MODULE_ID, "lastHome")?.t ?? -Infinity;
  const sanLog = (actor.getFlag(MODULE_ID, "sanLog") ?? []).filter((e) => e.t >= since);
  const damaged = actor.itemTypes.bond.filter((b) => b.system.hasBeenDamagedSinceLastHomeScene);
  const broken = actor.itemTypes.bond.filter((b) => b.getFlag(MODULE_ID, "broken"));
  const pending = actor.getFlag(MODULE_ID, "pendingDisorders") ?? [];
  const injuries = (actor.getFlag(MODULE_ID, "injuries") ?? []).filter((e) => e.t >= since);
  return { sanLog, damaged, broken, pending, injuries, fired: actor.getFlag(MODULE_ID, "fired") };
}

export async function endHome(actors) {
  // A copy of everyone as they were, before the slate is wiped.
  if (setting("backups") && game.user.isGM) {
    const { backupActor } = await import("./qol.mjs");
    for (const a of actors) await backupActor(a, { reason: "before the Home scene ended" }).catch(() => null);
  }
  for (const a of actors) {
    const dmg = a.itemTypes.bond.filter((b) => b.system.hasBeenDamagedSinceLastHomeScene).map((b) => ({ _id: b.id, "system.hasBeenDamagedSinceLastHomeScene": false }));
    if (dmg.length) {
      const { updateEmbedded } = await import("../core/ops.mjs");
      await updateEmbedded(a, "Item", dmg);
    }
    await update(a, { [`flags.${MODULE_ID}.lastHome`]: { t: game.time.worldTime, d: Date.now() }, [`flags.${MODULE_ID}.-=fightIncidents`]: null, [`flags.${MODULE_ID}.-=homePursuit`]: null });
  }
  await postCard({ title: "Home scene ends", body: `<p>Damaged-Bond marks cleared for ${actors.map((a) => esc(a.name)).join(", ")}. The next operation awaits.</p>` });
}

export { setting, isDGBond };
