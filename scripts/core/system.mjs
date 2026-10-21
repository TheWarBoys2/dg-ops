/**
 * Bridge to the Delta Green system's roll classes (taken from CONFIG.Dice.rolls so we use the
 * exact class instances the system registered).
 */
import { MODULE_ID } from "./constants.mjs";
import { percentileOutcome } from "../rules/dice.mjs";
import { rollFormula, waitForMessageDice } from "./dice.mjs";

let _classes = null;
export function rollClasses() {
  if (_classes) return _classes;
  _classes = {};
  for (const cls of CONFIG.Dice.rolls) {
    if (["DGRoll", "DGPercentileRoll", "DGLethalityRoll", "DGDamageRoll", "DGSanityDamageRoll"].includes(cls.name)) _classes[cls.name] = cls;
  }
  return _classes;
}

export function hasSystemRolls() {
  const c = rollClasses();
  return !!(c.DGPercentileRoll && c.DGRoll);
}

export function activeTokenDoc(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token;
  const controlled = canvas?.tokens?.controlled?.find((t) => t.actor === actor);
  return controlled?.document ?? actor.getActiveTokens?.(true, true)?.[0] ?? null;
}

/** Outcome object from an evaluated DGPercentileRoll. */
export function outcomeOf(roll) {
  const success = !!roll.isSuccess;
  const critical = !!roll.isCritical;
  return { total: roll.total, target: roll.effectiveTarget ?? roll.target, success, critical: success && critical, fumble: !success && critical };
}

/**
 * Make (and post) a system percentile test.
 * @param {Actor} actor
 * @param {object} p
 * @param {"stat"|"skill"|"sanity"|"luck"|"weapon"|"special-training"} p.type
 * @param {string} p.key       stat key, skill key, typed skill key, "sanity", "luck"
 * @param {Item} [p.item]
 * @param {number} [p.modifier]
 * @param {string} [p.messageMode]
 * @param {object} [p.context] stored in the chat flags (flags.dg-ops.roll.context)
 * @param {boolean} [p.post=true]
 */
export async function systemTest(actor, { type, key, item = null, modifier = 0, messageMode, context = {}, post = true, token = null, title = null, reason = "" }) {
  // Players roll their own dice: ask for this roll in chat rather than rolling it for them.
  if (post && (await shouldRequest(actor))) {
    const { requestTest } = await import("./requests.mjs");
    const r = await requestTest(actor, { type, key, itemId: item?.id ?? null, modifier, messageMode, context }, { title, reason });
    const outcome = r?.outcome ?? { total: null, target: null, success: false, critical: false, fumble: false, skipped: true };
    return { roll: null, outcome, message: r?.messageId ? game.messages.get(r.messageId) : null, requested: true };
  }
  const { DGPercentileRoll } = rollClasses();
  const roll = new DGPercentileRoll("1D100", {}, { rollType: type, key, actor, item, token: token ?? activeTokenDoc(actor) });
  roll.modifier += Number(modifier) || 0;
  roll.options.dgOps = context;
  if (messageMode) roll.options.messageMode = messageMode;
  await roll.evaluate();
  let message = null;
  if (post) {
    message = await roll.toChat();
    // Nothing that depends on this roll happens until its dice have landed.
    await waitForMessageDice(message?.id);
  }
  return { roll, outcome: outcomeOf(roll), message };
}

/**
 * True when this roll belongs to a player who should make it: their Agent, someone else set it off,
 * and they're connected. Rolls made from a request card (or by the player themselves) go ahead.
 */
async function shouldRequest(actor) {
  if (!actor?.hasPlayerOwner) return false;
  const { playerMustRoll } = await import("./requests.mjs");
  try {
    return playerMustRoll(actor);
  } catch {
    return false;
  }
}

export const statTest = (actor, stat, opts = {}) => systemTest(actor, { type: "stat", key: stat, ...opts });
export const skillTest = (actor, skill, opts = {}) => systemTest(actor, { type: "skill", key: skill, ...opts });
export const luckTest = (actor, opts = {}) => systemTest(actor, { type: "luck", key: "luck", ...opts });

/** Plain d100 against an arbitrary target (therapist skill, requisition officer, vehicles…). */
export async function rawTest({ target, label, actor = null, modifier = 0, whisper = null, flavorNote = "" }) {
  const roll = await rollFormula("1d100", { whisper });
  const eff = Math.max(1, Math.min(99, (Number(target) || 0) + (Number(modifier) || 0)));
  const outcome = percentileOutcome(roll.total, eff);
  const { postCard, outcomeBadge } = await import("./chat.mjs");
  await postCard({
    actor,
    title: label,
    body: `<p>Target ${eff}%${modifier ? ` (${modifier > 0 ? "+" : ""}${modifier})` : ""} — rolled <b>${roll.total}</b>: ${outcomeBadge(outcome)}</p>${flavorNote}`,
    rolls: [roll],
    whisper,
  });
  return { roll, outcome };
}

/** Evaluate a formula and wait for its dice to land (see core/dice.mjs). */
export async function evalFormula(formula, data = {}, opts = {}) {
  return rollFormula(formula, { data, ...opts });
}

/** Numeric value of a formula or number. */
export async function amountOf(x) {
  if (typeof x === "number") return { value: x, roll: null };
  const roll = await evalFormula(x);
  return { value: roll.total, roll };
}

export function statValue(actor, key) {
  const s = actor?.system?.statistics?.[key];
  return s?.effectiveValue ?? s?.value ?? 0;
}

export function skillValue(actor, key) {
  const s = actor?.system?.skills?.[key] ?? actor?.system?.typedSkills?.[key];
  return s?.targetProficiency ?? s?.proficiency ?? 0;
}

export function isAgent(actor) {
  return actor?.type === "agent";
}

export function isHumanish(actor) {
  return actor?.type === "agent" || actor?.type === "npc";
}

export function moduleFlag(doc, key, fallback) {
  const v = doc?.flags?.[MODULE_ID]?.[key];
  return v === undefined ? fallback : v;
}
