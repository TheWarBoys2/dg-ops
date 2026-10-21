/**
 * Pure combat rules (Agent's Handbook pp.50–63).
 */
import { d10sFromD100, lowestD10 } from "./dice.mjs";

export const PROTECTION = ["fragile", "exposed", "cover", "huge", "transcendent"];

/** Selective fire (p.56). Lethality uses the weapon's own rating when it has one. */
export const FIRE_MODES = {
  single: { label: "Single shot", ammo: 1, lethality: 0, killRadius: 0 },
  shortBurst: { label: "Short burst", ammo: 3, lethality: 10, killRadius: 0 },
  longBurst: { label: "Long burst", ammo: 5, lethality: 10, killRadius: 1 },
  shortSpray: { label: "Short spray", ammo: 10, lethality: 10, killRadius: 2 },
  longSpray: { label: "Long spray", ammo: 20, lethality: 10, killRadius: 3 },
  suppressive: { label: "Suppressive fire (optional rule, 1 m)", ammo: 3, lethality: 0, killRadius: 1, suppressOnly: true },
};

/** Called shots (p.50) and optional called shots (p.52). */
export const CALLED_SHOTS = {
  none: { label: "No called shot", mod: 0 },
  partial: { label: "Target partly covered (−20%)", mod: -20 },
  mostly: { label: "Target mostly covered (−40%)", mod: -40 },
  stun: { label: "Optional: Stun (−20%)", mod: -20, effect: "stun" },
  fleshWound: { label: "Optional: Flesh wound (−40%), half damage", mod: -40, effect: "fleshWound" },
  headShot: { label: "Optional: Head shot (−40%), hit is critical", mod: -40, effect: "headShot" },
};

/** Combat modifier table (p.51). Values only; the UI groups them. */
export const COMBAT_MODIFIERS = {
  range: {
    normal: { label: "Within base range", mod: 0 },
    pointBlank: { label: "Point-blank, 3 m or less (+20%)", mod: 20 },
    beyond: { label: "Beyond base range, up to 2× (−20%)", mod: -20 },
    beyond2: { label: "Beyond 2× base range, up to 5× (−40%)", mod: -40 },
  },
  visibility: {
    normal: { label: "Normal visibility", mod: 0 },
    laser: { label: "Laser sight (+20%)", mod: 20 },
    poor: { label: "Smoke / terrible visibility (−20%)", mod: -20 },
    none: { label: "Little to no visibility (−40%)", mod: -40 },
  },
  targetRanged: {
    normal: { label: "Target moving normally", mod: 0 },
    still: { label: "Target standing totally still (+20%)", mod: 20 },
    proneRunning: { label: "Target prone or running (−20%)", mod: -20 },
    fast: { label: "Target as fast as a speeding car (−40%)", mod: -40 },
  },
  targetMelee: {
    normal: { label: "Target moving normally", mod: 0 },
    pinned: { label: "Target pinned or standing still (+20%)", mod: 20 },
    vehicle: { label: "Target in a vehicle or running (−20%)", mod: -20 },
    fast: { label: "Target as fast as a speeding car (−40%)", mod: -40 },
  },
  attacker: {
    normal: { label: "No attacker condition", mod: 0 },
    pepper: { label: "Pepper spray / stun gun / exhausted (−20%)", mod: -20 },
    gas: { label: "Tear gas / stun grenade (−40%)", mod: -40 },
  },
};

export const MELEE_SKILLS = new Set(["melee_weapons", "unarmed_combat"]);

/** Parse a kill radius string such as "10 m", "3m", "1–3 m", "N/A" → metres (upper bound). */
export function parseKillRadius(value) {
  const s = String(value ?? "").toLowerCase();
  if (!s || s.includes("n/a") || s.includes("none")) return 0;
  const nums = s.match(/\d+(\.\d+)?/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

/** Parse a magazine capacity from the weapon's ammo string ("15", "10 or 30", "6"). */
export function parseCapacity(value) {
  const nums = String(value ?? "").match(/\d+/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

/**
 * Effective armor after armor piercing and special ammo (p.60, p.95).
 * Hollow points: armor counts double. AP ammo replaces the weapon's AP with 5.
 */
export function effectiveArmor({ armor = 0, ap = 0, hollowPoint = false, apAmmo = false }) {
  const pierce = apAmmo ? 5 : ap;
  let a = Math.max(0, armor - pierce);
  if (hollowPoint) a *= 2;
  return a;
}

/**
 * Ordinary damage against a protection category (p.59 summary).
 * @returns {{damage:number, killed:boolean, note:string}}
 */
export function resolveNormalDamage({
  rolled,
  protection = "exposed",
  bodyArmor = 0,
  cover = 0,
  ap = 0,
  hollowPoint = false,
  apAmmo = false,
  fleshWound = false,
}) {
  let dmg = Number(rolled) || 0;
  if (apAmmo) dmg = Math.max(1, dmg - 1);
  if (hollowPoint) dmg += 1;
  if (fleshWound) dmg = Math.ceil(dmg / 2);
  if (protection === "transcendent") return { damage: 0, killed: false, note: "Transcendent: immune" };
  if (protection === "fragile") return { damage: Infinity, killed: true, note: "Fragile: reduced to 0 HP" };
  const armor = effectiveArmor({ armor: bodyArmor + (protection === "cover" ? cover : 0), ap, hollowPoint, apAmmo });
  return { damage: Math.max(0, dmg - armor), killed: false, note: armor ? `Armor ${armor}` : "" };
}

/**
 * Lethality against a protection category (pp.57–60).
 * Critical attack: Lethality rating doubled, failed-Lethality damage doubled.
 * @returns {{lethalSuccess:boolean, killed:boolean, damage:number, rating:number, dice:number[], note:string}}
 */
export function resolveLethality({
  rating,
  total,
  attackCritical = false,
  protection = "exposed",
  bodyArmor = 0,
  cover = 0,
  ap = 0,
}) {
  const eff = attackCritical ? rating * 2 : rating;
  const dice = d10sFromD100(total);
  let sum = dice[0] + dice[1];
  if (attackCritical) sum *= 2;
  const lethalSuccess = total <= eff;
  const base = { rating: eff, dice, lethalSuccess };

  if (protection === "transcendent") return { ...base, killed: false, damage: 0, note: "Transcendent: immune" };
  if (protection === "fragile") return { ...base, killed: true, damage: Infinity, note: "Fragile: reduced to 0 HP" };
  if (protection === "huge") {
    const armor = Math.max(0, bodyArmor - ap);
    return { ...base, killed: false, damage: Math.max(0, eff - armor), note: `Huge: takes the Lethality rating as damage${armor ? `, armor ${armor}` : ""}` };
  }
  if (protection === "cover" && cover > 0) {
    const armor = Math.max(0, bodyArmor + cover - ap);
    return { ...base, lethalSuccess: false, killed: false, damage: Math.max(0, sum - armor), note: `Behind cover: Lethality fails automatically, armor ${armor}` };
  }
  if (lethalSuccess) return { ...base, killed: true, damage: Infinity, note: "Lethal: body armor doesn't help" };
  const armor = Math.max(0, bodyArmor - ap);
  return { ...base, killed: false, damage: Math.max(0, sum - armor), note: armor ? `Armor ${armor}` : "" };
}

/**
 * Damage outcome on an Agent or NPC (p.55).
 * @returns {{hpAfter:number, stunned:boolean, unconscious:boolean, dead:boolean, permanentInjuryCheck:boolean}}
 */
export function damageOutcome({ hpBefore, damage }) {
  const dmg = damage === Infinity ? hpBefore : Math.max(0, Number(damage) || 0);
  const hpAfter = Math.max(0, hpBefore - dmg);
  const dead = hpAfter <= 0 && hpBefore > 0;
  const stunned = dmg > 0 && !dead && dmg >= hpBefore / 2;
  const unconscious = !dead && hpAfter <= 2 && dmg > 0;
  const permanentInjuryCheck = dmg > 0 && hpAfter <= 2 && !dead;
  return { hpAfter, applied: dmg, stunned, unconscious, dead, permanentInjuryCheck };
}

/** Permanent injury stat reduction (p.55): lowest d10 of the failed CON×5 roll, minimum stat 3. */
export function permanentInjuryReduction({ conRollTotal, statValue }) {
  const by = lowestD10(conRollTotal);
  return { by, newValue: Math.max(3, statValue - by) };
}

/** Optional permanent injuries (p.55 sidebar). */
export const PERMANENT_INJURY_EFFECTS = {
  stat: "Stat loss (default)",
  blinded: "Partially blinded: −20% to tests needing good eyesight",
  deafened: "Partially deafened: −20% to tests needing good hearing",
  arm: "Arm crippled or severed: −20% to tests needing two hands",
  leg: "Leg crippled or severed: −20% to tests needing movement",
};

/** Optional critical hit alternatives (p.52 sidebar). */
export const OPTIONAL_CRIT_EFFECTS = {
  double: "Double damage (standard)",
  stun: "Normal damage + target stunned",
  disarm: "Normal damage + disarm",
  prone: "Normal damage + knock prone",
  called: "Normal damage + treat as a called shot",
  second: "Normal damage + immediate second attack",
};

/** Surprise attacks (p.53). */
export function surpriseOutcome({ success }) {
  return { critical: !!success };
}

/** Is a kill-radius victim's tactical position adequate to dodge to cover? Rule text only: the UI asks. */
export function distanceMetres(ax, ay, bx, by, gridSizePx, gridDistance) {
  const px = Math.hypot(ax - bx, ay - by);
  return (px / gridSizePx) * gridDistance;
}

/** Base range in metres from a weapon's range field ("15M", "75 m"); null for melee/unknown. */
export function parseRange(value) {
  const s = String(value ?? "").toLowerCase();
  if (!s || /n\/?a|touch|melee|none/.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Range band for a shot (p.51): point-blank at 3 m or less, normal to base range,
 * −20% to 2× base, −40% to 5× base, out of range beyond that.
 */
export function rangeBand(distance, base) {
  if (!Number.isFinite(distance)) return "normal";
  if (distance <= 3) return "pointBlank";
  if (!base) return "normal";
  if (distance <= base) return "normal";
  if (distance <= base * 2) return "beyond";
  if (distance <= base * 5) return "beyond2";
  return "out";
}

/** Can this defender oppose an incoming attack at all? Returns a reason string if not. */
export function cannotDefendReason({ surprise, helpless, dead, unconscious, stunned, pinned, unaware, pinning, actedThisRound }) {
  if (dead) return "dead";
  if (helpless) return "helpless";
  if (unconscious) return "unconscious";
  if (surprise) return "taken by surprise";
  if (unaware) return "unaware of the attack";
  if (stunned) return "stunned";
  if (pinned) return "pinned";
  if (pinning) return "busy pinning someone";
  if (actedThisRound) return "already acted this round";
  return null;
}
