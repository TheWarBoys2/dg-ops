/**
 * Gear, money and requisition (pp.84–91), and interrogation (p.168).
 */
import { MODULE_ID } from "../core/constants.mjs";
import { systemTest, luckTest, statValue, skillValue, evalFormula } from "../core/system.mjs";
import { update } from "../core/ops.mjs";
import { postCard, list, outcomeBadge, gmWhisper, button, registerAction } from "../core/chat.mjs";
import { prompt, askOwner, esc, options, field } from "../core/ui.mjs";
import { chooseBond, adjustBondByFormula, bonds } from "../core/bonds.mjs";
import * as H from "../rules/home.mjs";
import { applyEffects, prosecutionFlow, firedFlow } from "./downtime.mjs";
import { runForActor } from "./sanity.mjs";
import { applyDamage } from "./injury.mjs";
import { startPoison } from "./hazards.mjs";
import { remoteTest } from "./tests.mjs";
import { resolveOpposed } from "../rules/dice.mjs";

const METHODS = {
  have: "Do we have it? (INT×5 or Luck)",
  requisition: "Official requisition (Bureaucracy / Military Science)",
  own: "Pay with own money",
  bond: "Ask a Bond to get it",
  black: "Black market",
  cash: "Illicit cash",
  craft: "Craft it yourself",
  review: "Official review (after the operation)",
};

function typedKey(actor, re) {
  return Object.entries(actor.system.typedSkills ?? {}).find(([, s]) => re.test(`${s.group} ${s.label}`))?.[0] ?? null;
}

export async function requisitionDialog(actor = null) {
  actor ??= canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor || actor.type !== "agent") return ui.notifications.warn("Select an Agent.");
  const priority = game.settings.get(MODULE_ID, "opPriority");
  const r = await prompt({
    title: `Gear & money — ${actor.name}`,
    width: 540,
    content: `${field("Item or service", `<input type="text" name="item" placeholder="e.g. Night-vision goggles">`)}
      ${field("Expense", `<select name="exp">${options(H.EXPENSE_LABELS, "standard")}</select>`)}
      ${field("Method", `<select name="m">${options(METHODS)}</select>`)}
      ${field("Operation priority", `<select name="prio">${options({ low: "Low (−20%)", normal: "Normal", high: "High (+20%)" }, priority)}</select>`)}
      <label class="dgops-radio"><input type="checkbox" name="restricted"> Restricted item</label>
      <label class="dgops-radio"><input type="checkbox" name="wealthy"> Wealthy Agent (treat expenses one category lower; +20% on money tests)</label>
      <label class="dgops-radio"><input type="checkbox" name="accelerate"> Badger officials to speed delivery (CHA×5 to avoid review)</label>
      <p class="hint">Illicit cash: ${actor.getFlag(MODULE_ID, "illicitCash") ?? 0} Standard purchases.</p>`,
  });
  if (!r) return;
  const d = r.data;
  const level = d.exp;
  const item = d.item || "the item";
  const notes = [];
  const rolls = [];
  let got = null;
  switch (d.m) {
    case "have": {
      const useLuck = statValue(actor, "int") * 5 < 50;
      const res = useLuck ? await luckTest(actor, { modifier: H.expensePenalty(level) }) : await systemTest(actor, { type: "stat", key: "int", modifier: H.expensePenalty(level) });
      got = res.outcome.success;
      notes.push(`${useLuck ? "Luck" : "INT×5"}${H.expensePenalty(level) ? ` (${H.expensePenalty(level)}%)` : ""}: ${outcomeBadge(res.outcome)}`);
      if (level === "extreme") notes.push("Extreme-expense items are never in the starting kit unless the operation is exceptionally well funded.");
      break;
    }
    case "requisition": {
      const mil = typedKey(actor, /military/i);
      const useMil = mil && skillValue(actor, mil) > skillValue(actor, "bureaucracy");
      const mod = H.expensePenalty(level) + (H.PRIORITY_MODS[d.prio] ?? 0);
      const res = await systemTest(actor, { type: "skill", key: useMil ? mil : "bureaucracy", modifier: mod });
      got = res.outcome.success;
      notes.push(`${useMil ? "Military Science" : "Bureaucracy"} (${mod >= 0 ? "+" : ""}${mod}%): ${outcomeBadge(res.outcome)}`);
      const times = { incidental: "now", standard: d.accelerate ? "a few hours" : "a day or two", unusual: d.accelerate ? "a day or two" : "a few days", major: d.prio === "high" ? "a few days" : "a few weeks", extreme: d.prio === "high" ? "a few days" : "a few months" };
      if (got) notes.push(`Delivery: ${times[level]}. It's on loan and must be returned.`);
      let review = d.restricted || level === "major" || level === "extreme";
      if (d.accelerate && ["standard", "unusual"].includes(level)) {
        const c = await systemTest(actor, { type: "stat", key: "cha" });
        if (!c.outcome.success) review = true;
      }
      if (review && got) {
        const list2 = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "reviews") ?? []);
        list2.push({ item, level, t: game.time.worldTime, priority: d.prio });
        await update(actor, { [`flags.${MODULE_ID}.reviews`]: list2 });
        notes.push("<b>Draws official review</b> after the operation (resolve from the Home scene).");
      }
      break;
    }
    case "own": {
      const rules = H.ownMoneyRules(level, { wealthy: d.wealthy });
      let effects = [...rules.always];
      if (rules.test) {
        const acc = skillValue(actor, "accounting");
        const int5 = statValue(actor, "int") * 5;
        const res = acc > int5 ? await systemTest(actor, { type: "skill", key: "accounting", modifier: rules.bonus }) : await systemTest(actor, { type: "stat", key: "int", modifier: rules.bonus });
        notes.push(`${acc > int5 ? "Accounting" : "INT×5"}: ${outcomeBadge(res.outcome)}`);
        effects = effects.concat(res.outcome.success ? rules.onSuccess : rules.onFailure);
      }
      got = true;
      const out = await applyEffects(actor, effects, { reason: `Paying for ${item}` });
      notes.push(...out.notes);
      rolls.push(...out.rolls);
      break;
    }
    case "bond": {
      const bond = await chooseBond(actor, { title: "Ask which Bond?" });
      if (!bond) return ui.notifications.warn("No Bonds to ask.");
      const res = await systemTest(actor, { type: "stat", key: "cha", modifier: level === "extreme" ? -20 : 0 });
      const rule = H.askBondRules(level, res.outcome);
      got = rule.gets;
      notes.push(`Asking ${esc(bond.name)}: ${outcomeBadge(res.outcome)}`);
      if (rule.bond) {
        const b = await adjustBondByFormula(actor, bond, rule.bond, { reason: "asking a favour" });
        notes.push(`${esc(bond.name)} ${b.amount} (${b.before} → ${b.after})`);
      }
      notes.push("They'll want to know why. Lying may harm the Bond further; the truth may be worse.");
      break;
    }
    case "black": {
      const cs = skillValue(actor, "computer_science");
      const cr = skillValue(actor, "criminology");
      const res = await systemTest(actor, { type: "skill", key: cs > cr ? "computer_science" : "criminology" });
      notes.push(`${cs > cr ? "Dark Web (Computer Science)" : "Street dealer (Criminology)"}: ${outcomeBadge(res.outcome)}`);
      if (res.outcome.fumble) {
        notes.push("<b>Caught making the buy.</b>");
        await postCard({ actor, title: "Caught", body: `<p>${esc(actor.name)} is caught buying ${esc(item)}.</p>${button("prosecute", "Prosecution", { args: { actorUuid: actor.uuid }, once: "pros" })}`, whisper: gmWhisper() });
      } else if (!res.outcome.success) notes.push("Can't get it without getting caught.");
      else {
        const luck = await luckTest(actor);
        const price = luck.outcome.success ? level : H.expenseShift(level, 1);
        notes.push(`Price: ${H.EXPENSE_LABELS[price]}${price !== level ? " (gouged)" : ""}. Now pay for it (own money or illicit cash).`);
        got = true;
      }
      break;
    }
    case "cash": {
      const units = H.cashUnits(level);
      if (units == null) return ui.notifications.warn("Illicit cash can't cover an Extreme expense.");
      const cur = actor.getFlag(MODULE_ID, "illicitCash") ?? 0;
      if (cur < units) return ui.notifications.warn(`Needs ${units} Standard purchases; the stash holds ${cur}.`);
      await update(actor, { [`flags.${MODULE_ID}.illicitCash`]: cur - units });
      got = true;
      notes.push(`Spent ${units} (stash now ${cur - units}). Illicit cash can't buy assets only an official operation can get.`);
      break;
    }
    case "craft": {
      const craft = Object.entries(actor.system.typedSkills ?? {}).filter(([, s]) => /craft/i.test(s.group));
      if (!craft.length) return ui.notifications.warn("No Craft skills.");
      const c = await prompt({ title: "Craft it yourself", content: field("Craft", `<select name="k">${craft.map(([k, s]) => `<option value="${k}">${esc(s.label)} (${s.proficiency}%)</option>`).join("")}</select>`) });
      if (!c) return;
      const res = await systemTest(actor, { type: "skill", key: c.data.k });
      got = res.outcome.success;
      notes.push(`${outcomeBadge(res.outcome)}${got ? ` — built for ${H.EXPENSE_LABELS[H.expenseShift(level, -1)]} in a day or two.` : ""}`);
      if (["major", "extreme"].includes(level)) notes.push("Anything pricier than Unusual is beyond the workshop.");
      break;
    }
    case "review":
      return officialReview(actor);
    default:
      return;
  }
  await postCard({ actor, title: `${METHODS[d.m].split(" (")[0]}: ${esc(item)}`, subtitle: H.EXPENSE_LABELS[level], body: `${got === true ? "<p><b>Gets it.</b></p>" : got === false ? "<p><b>Doesn't get it.</b></p>" : ""}${list(notes)}`, rolls });
}

export async function officialReview(actor) {
  const reviews = actor.getFlag(MODULE_ID, "reviews") ?? [];
  const r = await prompt({
    title: `Official review — ${actor.name}`,
    content: `${reviews.length ? list(reviews.map((x) => `${esc(x.item)} (${x.level})`)) : "<p>No logged reviews.</p>"}
      ${field("Skill", `<select name="s">${options({ bureaucracy: "Bureaucracy", accounting: "Accounting", law: "Law", persuade: "Persuade", criminology: "Criminology (egregious cover-ups)" })}</select>`)}
      ${field("Circumstances", `<select name="m"><option value="20">Prepared (+20%)</option><option value="40">Especially favourable (+40%)</option><option value="0">Damning (±0)</option><option value="-20">Very damning (−20%)</option></select>`)}
      ${field("Worst expense involved", `<select name="l">${options(H.EXPENSE_LABELS, reviews.at(-1)?.level ?? "standard")}</select>`)}`,
  });
  if (!r) return;
  const res = await systemTest(actor, { type: "skill", key: r.data.s, modifier: Number(r.data.m) || 0 });
  await update(actor, { [`flags.${MODULE_ID}.reviews`]: [] });
  if (res.outcome.success) return postCard({ actor, title: "Review cleared", body: `<p>Nothing sticks.</p>` });
  const lvl = r.data.l;
  const rep = { incidental: "An official reprimand.", standard: "An official reprimand.", unusual: "An official reprimand.", major: "Severe discipline: unpaid leave, fines and/or transfer.", extreme: "Firing and criminal prosecution." }[lvl];
  await postCard({ actor, title: "Found to have misused assets", body: `<p>${esc(rep)}</p>${lvl === "extreme" ? `${button("fired", "Getting fired", { args: { actorUuid: actor.uuid }, once: "fired" })} ${button("prosecute", "Prosecution", { args: { actorUuid: actor.uuid }, once: "pros" })}` : ""}` });
}

registerAction("prosecute", async ({ args }) => {
  await prosecutionFlow(await fromUuid(args.actorUuid));
  return "Done";
});
registerAction("fired", async ({ args }) => {
  await firedFlow(await fromUuid(args.actorUuid));
  return "Done";
});

/* ------------------------------------------------------------------------ */
/*  Interrogation (p.168)                                                    */
/* ------------------------------------------------------------------------ */

export async function interrogationDialog() {
  const sel = canvas.tokens.controlled.map((t) => t.actor).filter(Boolean);
  const tgt = [...game.user.targets].map((t) => t.actor).filter(Boolean);
  const interrogator = sel[0] ?? game.user.character;
  const subject = tgt[0] ?? sel[1];
  if (!interrogator || !subject) return ui.notifications.warn("Select the interrogator and target the subject.");
  const r = await prompt({
    title: `Interrogation: ${interrogator.name} → ${subject.name}`,
    width: 520,
    content: `<p>A few hours of interviews per attempt. The subject may resist with Persuade at a cost of 1D6 WP; at 0 WP they can't resist.</p>
      ${field("Approach", `<select name="a"><option value="rapport">Rapport (Persuade)</option><option value="enhanced">"Enhanced" (panic/humiliation): +20%, 0/1D4 SAN both</option><option value="torture">Torture: +20%, subject −20%, 1D4 damage, 0/1D8 SAN both</option><option value="drugs">"Truth" drugs (Pharmacy): subject −20%</option><option value="drink">Get them drunk: subject CON test or −20%</option></select>`)}
      ${field("Modifier", `<input type="number" name="m" value="0" step="10" style="width:5em">`)}`,
  });
  if (!r) return;
  const a = r.data.a;
  let iMod = Number(r.data.m) || 0;
  let sMod = 0;
  const notes = [];
  if (a === "enhanced" || a === "torture") iMod += 20;
  if (a === "torture") {
    sMod -= 20;
    await applyDamage(subject, (await evalFormula("1d4")).total, { source: "Torture", attack: true });
    await runForActor(subject, { successLoss: "0", failureLoss: "1D8", category: "violence", source: "Tortured" });
    await runForActor(interrogator, { successLoss: "0", failureLoss: "1D8", category: "violence", source: "Torturing a victim" });
  }
  if (a === "enhanced") {
    await runForActor(subject, { successLoss: "0", failureLoss: "1D4", category: "helplessness", source: "Enhanced interrogation" });
    await runForActor(interrogator, { successLoss: "0", failureLoss: "1D4", category: "violence", source: "Enhanced interrogation" });
  }
  if (a === "drugs") {
    const ph = skillValue(interrogator, "pharmacy");
    const ok = ph > 0 ? (await systemTest(interrogator, { type: "skill", key: "pharmacy" })).outcome.success : false;
    if (ok) sMod -= 20;
    else {
      notes.push("The drug acts as a poison (Lethality 5%).");
      await startPoison(subject, "truthDrug");
    }
    notes.push("Drug-induced confusion may make the information useless (Handler).");
  }
  if (a === "drink") {
    const res = await systemTest(subject, { type: "stat", key: "con" });
    if (!res.outcome.success) sMod -= 20;
  }
  const io = await remoteTest(interrogator, { type: "skill", key: "persuade" }, iMod);
  let resisted = null;
  if ((subject.system.wp?.value ?? 0) > 0) {
    const choice = await askOwner(subject, { title: "Resist interrogation?", content: `<p>Resist with Persuade${sMod ? ` (${sMod}%)` : ""} at a cost of 1D6 WP (WP ${subject.system.wp.value}).</p>`, buttons: [{ action: "resist", label: "Resist", default: true }, { action: "talk", label: "Talk" }] });
    if (choice?.action !== "talk") {
      const wp = await evalFormula("1d6");
      await update(subject, { "system.wp.value": Math.max(0, subject.system.wp.value - wp.total) });
      notes.push(`${esc(subject.name)} spends ${wp.total} WP resisting.`);
      resisted = await remoteTest(subject, { type: "skill", key: "persuade" }, sMod);
    }
  } else notes.push(`${esc(subject.name)} has no WP left and can't resist.`);
  const win = resisted ? resolveOpposed(io, resisted, { bothFail: "none" }) === "a" : io.success;
  notes.push(win ? `<b>${esc(subject.name)} gives up important information.</b>` : `${esc(subject.name)} holds out this time.`);
  if (a === "torture" || a === "enhanced") notes.push("Pain and panic blur truth and whatever lie makes it stop: the Handler decides what the information is worth.");
  await postCard({ actor: interrogator, title: "Interrogation", body: list(notes) });
}

export { bonds };
