/**
 * Pure dice helpers for Delta Green percentile resolution.
 * No Foundry globals here, so everything is unit-testable in Node.
 * Page references are to the Delta Green Agent's Handbook (2024 printing).
 */

/** Matching digits (11, 22 … 99), 01 or 00 (100). */
export function isMatchingOrExtreme(total) {
  const t = Number(total);
  if (!Number.isInteger(t) || t < 1 || t > 100) return false;
  return t === 1 || t === 100 || t % 11 === 0;
}

/**
 * Resolve a d100 test (p.44).
 * Critical success: 01 or a success where the dice match.
 * Fumble: 00 (100) or a failure where the dice match.
 * Targets above 99 (inhuman creatures) succeed on anything but 100.
 * @param {number} total
 * @param {number} target
 * @param {{forceFail?: boolean}} [opts]
 */
export function percentileOutcome(total, target, { forceFail = false } = {}) {
  const t = Number(total);
  const tgt = Number(target);
  let success = t !== 100 && t <= tgt;
  if (forceFail) success = false;
  const special = isMatchingOrExtreme(t);
  let critical = success && special;
  const fumble = !success && special;
  return { total: t, target: tgt, success, critical, fumble };
}

/** Clamp a percentile target the way the book does: 1% to 99% (p.43). */
export function clampTarget(value, { allowOver99 = false } = {}) {
  let v = Math.round(Number(value) || 0);
  v = Math.max(1, v);
  if (!allowOver99) v = Math.min(99, v);
  return v;
}

/**
 * Combat attack modifiers: bonuses stack to a maximum of +40, penalties are unlimited (p.52).
 * @param {number[]} mods
 */
export function capAttackModifiers(mods) {
  let bonus = 0;
  let penalty = 0;
  for (const m of mods) {
    const n = Number(m) || 0;
    if (n > 0) bonus += n;
    else penalty += n;
  }
  return Math.min(bonus, 40) + penalty;
}

/**
 * Opposed test resolution (p.45 table).
 * @param {{success:boolean, critical:boolean, total:number}} a
 * @param {{success:boolean, critical:boolean, total:number}} b
 * @param {{bothFail?: "lower"|"none"|"handler"}} [opts]
 * @returns {"a"|"b"|"none"|"handler"}
 */
export function resolveOpposed(a, b, { bothFail = "handler" } = {}) {
  if (a.success && b.success) {
    if (a.critical && !b.critical) return "a";
    if (b.critical && !a.critical) return "b";
    if (a.total > b.total) return "a";
    if (b.total > a.total) return "b";
    return "none";
  }
  if (a.success) return "a";
  if (b.success) return "b";
  if (bothFail === "lower") {
    if (a.total < b.total) return "a";
    if (b.total < a.total) return "b";
    return "none";
  }
  return bothFail;
}

/**
 * Read a d100 result as two d10s, 0 counting as 10 (p.57, Lethality).
 * 100 → [10,10]; 7 → [10,7]; 45 → [4,5]; 70 → [7,10].
 */
export function d10sFromD100(total) {
  const t = Number(total);
  if (t === 100) return [10, 10];
  const tens = Math.floor(t / 10);
  const ones = t % 10;
  return [tens || 10, ones || 10];
}

/** "The number on the lowest ten-sided die" of a d100 roll (p.55 permanent injury). */
export function lowestD10(total) {
  const [a, b] = d10sFromD100(total);
  return Math.min(a, b);
}

/**
 * Parse a simple loss/damage formula like "1D6", "2d4+1", "1", "0" into min/max.
 * Returns null for anything more exotic (Foundry evaluates those).
 */
export function formulaRange(formula) {
  const f = String(formula ?? "").replace(/\s+/g, "").toLowerCase();
  if (f === "") return { min: 0, max: 0, isDice: false };
  if (/^-?\d+$/.test(f)) {
    const n = parseInt(f, 10);
    return { min: n, max: n, isDice: false };
  }
  const m = f.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  const n = m[1] === "" ? 1 : parseInt(m[1], 10);
  const faces = parseInt(m[2], 10);
  const k = m[3] ? parseInt(m[3], 10) : 0;
  return { min: n + k, max: n * faces + k, isDice: true };
}
