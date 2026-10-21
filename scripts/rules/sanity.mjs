/**
 * Pure Sanity rules (Agent's Handbook pp.66–75).
 */
import { formulaRange } from "./dice.mjs";

export const SAN_CATEGORIES = ["violence", "helplessness", "unnatural", "other"];

/**
 * Work out SAN loss from a resolved SAN test.
 * - Critical success: least possible loss of the success formula (p.66).
 * - Fumble: most possible loss of the failure formula (p.66).
 * - Violence with several victims: +1 per victim beyond the first on a failed roll,
 *   up to the maximum possible (p.67 footnote).
 * @param {object} p
 * @param {{success:boolean, critical:boolean, fumble:boolean}} p.outcome
 * @param {string} p.successFormula
 * @param {string} p.failureFormula
 * @param {number} p.rolledSuccess   Rolled value of the success formula (ignored on crit).
 * @param {number} p.rolledFailure   Rolled value of the failure formula (ignored on fumble).
 * @param {number} [p.victims=1]
 * @param {boolean} [p.perVictim=false]  Whether the trauma uses the per-victim rule.
 */
export function computeSanLoss({
  outcome,
  successFormula,
  failureFormula,
  rolledSuccess,
  rolledFailure,
  victims = 1,
  perVictim = false,
}) {
  const sRange = formulaRange(successFormula) ?? { min: rolledSuccess, max: rolledSuccess };
  const fRange = formulaRange(failureFormula) ?? { min: rolledFailure, max: rolledFailure };
  if (outcome.success) {
    if (outcome.critical) return Math.max(0, sRange.min);
    return Math.max(0, Number(rolledSuccess) || 0);
  }
  if (outcome.fumble) return Math.max(0, fRange.max);
  let loss = Math.max(0, Number(rolledFailure) || 0);
  if (perVictim && victims > 1) loss = Math.min(loss + (victims - 1), fRange.max);
  return loss;
}

/**
 * Projecting onto a Bond (p.74): spend 1D4 WP. If the Agent still has at least 1 WP,
 * reduce the SAN loss by the amount rolled (min 0) and reduce a Bond by the same amount.
 * @returns {{wpAfter:number, applies:boolean, sanReduction:number, bondLoss:number}}
 */
export function resolveProjection({ wpCurrent, wpRoll, loss }) {
  const wpAfter = Math.max(0, wpCurrent - wpRoll);
  const applies = wpAfter >= 1;
  return {
    wpAfter,
    applies,
    sanReduction: applies ? Math.min(wpRoll, loss) : 0,
    bondLoss: applies ? wpRoll : 0,
  };
}

/**
 * Thresholds after a loss (pp.68–73).
 * @param {object} p
 * @param {number} p.sanBefore
 * @param {number} p.loss              Loss actually applied (after projection).
 * @param {number} p.rawLoss           Loss before projection.
 * @param {number} p.breakingPoint
 * @param {number} p.pow
 * @param {"after"|"before"} [p.insanityCheck="after"]  Whether the 5+ test uses the projected loss.
 */
export function evaluateSanThresholds({
  sanBefore,
  loss,
  rawLoss = loss,
  breakingPoint,
  pow,
  insanityCheck = "after",
}) {
  const sanAfter = Math.max(0, sanBefore - loss);
  const insanityBasis = insanityCheck === "before" ? rawLoss : loss;
  const tempInsanity = insanityBasis >= 5;
  const breakingPointHit = loss > 0 && sanAfter <= breakingPoint && sanAfter > 0;
  const newBreakingPoint = breakingPointHit ? Math.max(0, sanAfter - pow) : breakingPoint;
  const permanentInsanity = sanAfter <= 0 && sanBefore > 0;
  const acuteTrigger2 = loss >= 2;
  return {
    sanAfter,
    tempInsanity: tempInsanity && !permanentInsanity,
    breakingPointHit,
    newBreakingPoint,
    permanentInsanity,
    acuteTrigger2,
  };
}

/**
 * Adaptation progress (p.73). Mark a box each time violence/helplessness reduces SAN by 1+.
 * Insanity from that type resets the boxes. The book's worked example also resets on reaching
 * the Breaking Point, which is configurable here.
 * @param {{incident1:boolean, incident2:boolean, incident3:boolean}} state
 * @returns {{state:object, becameAdapted:boolean, reset:boolean, marked:boolean}}
 */
export function stepAdaptation(state, { lossApplied, tempInsanity, breakingPointHit, resetOnBreakingPoint = true }) {
  const s = { incident1: !!state.incident1, incident2: !!state.incident2, incident3: !!state.incident3 };
  const already = s.incident1 && s.incident2 && s.incident3;
  if (already) return { state: s, becameAdapted: false, reset: false, marked: false };
  if (!(lossApplied >= 1)) return { state: s, becameAdapted: false, reset: false, marked: false };
  if (tempInsanity || (breakingPointHit && resetOnBreakingPoint)) {
    return { state: { incident1: false, incident2: false, incident3: false }, becameAdapted: false, reset: true, marked: false };
  }
  if (!s.incident1) s.incident1 = true;
  else if (!s.incident2) s.incident2 = true;
  else s.incident3 = true;
  const becameAdapted = s.incident1 && s.incident2 && s.incident3;
  return { state: s, becameAdapted, reset: false, marked: true };
}

/** Maximum SAN: 99 − Unnatural (+ AE bonus). Home/therapy gains also cap at POW×5. */
export function sanCap({ unnatural = 0, maxBonus = 0, pow = null, homeCap = false }) {
  let cap = 99 - unnatural + maxBonus;
  if (homeCap && pow != null) cap = Math.min(cap, pow * 5);
  return Math.max(0, cap);
}

/** Destroying the unnatural restores the lowest amount that could be lost (p.75). */
export function destroyedRestoreFormula(successLoss) {
  const r = formulaRange(successLoss);
  if (!r) return String(successLoss || "0");
  if (!r.isDice) return String(r.min);
  return String(successLoss);
}

/** Repressing insanity (p.75): spend 1D4 WP; if still ≥1 WP, a Bond takes the same, then roll SAN. */
export function resolveRepression({ wpCurrent, wpRoll }) {
  const wpAfter = Math.max(0, wpCurrent - wpRoll);
  return { wpAfter, canAttempt: wpAfter >= 1, bondLoss: wpAfter >= 1 ? wpRoll : 0 };
}

/**
 * Sample SAN threats from pp.67–68, with category and per-victim flag.
 * Labels are short paraphrases for the picker.
 */
export const SAN_PRESETS = [
  // Helplessness
  { id: "fired", label: "Fired from one's job", category: "helplessness", success: "0", failure: "1" },
  { id: "bondNearlyHurt", label: "Nearly get a Bond hurt or killed", category: "helplessness", success: "0", failure: "1" },
  { id: "bankruptcy", label: "Unexpected bankruptcy", category: "helplessness", success: "0", failure: "1" },
  { id: "friendHarmed", label: "A friend is permanently harmed or gains a disorder", category: "helplessness", success: "0", failure: "1" },
  { id: "bondZero", label: "A Bond's score is reduced to 0", category: "helplessness", success: "0", failure: "1D4" },
  { id: "prison", label: "Sentenced to a prison term", category: "helplessness", success: "0", failure: "1D4" },
  { id: "wakeParalyzed", label: "Waking paralyzed or blind", category: "helplessness", success: "0", failure: "1D4" },
  { id: "friendRemains", label: "Find a friend's remains", category: "helplessness", success: "0", failure: "1D4" },
  { id: "bondPermHarm", label: "A Bond is permanently harmed or gains a disorder", category: "helplessness", success: "1", failure: "1D4" },
  { id: "corpsePit", label: "Flung into a pit of corpses", category: "helplessness", success: "0", failure: "1D4" },
  { id: "friendGruesome", label: "See or hear a friend gruesomely killed", category: "helplessness", success: "0", failure: "1D6" },
  { id: "bondKilled", label: "Learn a Bond has been killed", category: "helplessness", success: "1", failure: "1D6" },
  { id: "bondGruesome", label: "See or hear a Bond gruesomely killed", category: "helplessness", success: "1", failure: "1D8" },
  // Suffering violence
  { id: "ambushed", label: "Ambushed by gunfire", category: "violence", success: "0", failure: "1" },
  { id: "corpse", label: "Find a corpse or mangled carcass", category: "violence", success: "0", failure: "1" },
  { id: "infantLovedOne", label: "Find the mutilated corpse of an infant or loved one", category: "violence", success: "0", failure: "1D4" },
  { id: "stabbedShot", label: "Stabbed, strangled or shot", category: "violence", success: "0", failure: "1D4" },
  { id: "permInjury", label: "Suffer a permanent injury", category: "violence", success: "0", failure: "1D6" },
  { id: "setOnFire", label: "Set on fire", category: "violence", success: "0", failure: "1D6" },
  { id: "twoHP", label: "Reduced to 2 HP or fewer", category: "violence", success: "0", failure: "1D6" },
  { id: "tortured", label: "Tortured", category: "violence", success: "0", failure: "1D8" },
  // Inflicting violence
  { id: "crippleInnocent", label: "Incapacitate or cripple an innocent", category: "violence", success: "0", failure: "1D4" },
  { id: "incinerator", label: "Dispose of teammates' bodies to thwart an investigation", category: "violence", success: "0", failure: "1D4" },
  { id: "killDefense", label: "Kill in defence of oneself or another", category: "violence", success: "0", failure: "1D4", perVictim: true },
  { id: "killColdEnemy", label: "Kill a murderous enemy in cold blood", category: "violence", success: "0", failure: "1D6", perVictim: true },
  { id: "tortureVictim", label: "Torture a victim", category: "violence", success: "0", failure: "1D8" },
  { id: "accidentInnocent", label: "Accidentally kill an innocent", category: "violence", success: "0", failure: "1D8" },
  { id: "killInnocentCold", label: "Kill an innocent in cold blood", category: "violence", success: "1", failure: "1D10", perVictim: true },
  // Unnatural
  { id: "therapyUnnatural", label: "Attempt Psychotherapy on someone who lost SAN to the Unnatural", category: "unnatural", success: "0", failure: "1" },
  { id: "benignEffect", label: "Witness an apparently benign supernatural effect", category: "unnatural", success: "0", failure: "1" },
  { id: "violentEffect", label: "Witness a violent supernatural effect", category: "unnatural", success: "0", failure: "1D6" },
  { id: "corpseWalk", label: "See a corpse walk", category: "unnatural", success: "0", failure: "1D6" },
  { id: "subjected", label: "Subjected to an overtly supernatural effect", category: "unnatural", success: "0", failure: "1D6" },
  { id: "violentAssault", label: "Suffer a violent supernatural assault", category: "unnatural", success: "1", failure: "1D8" },
];
