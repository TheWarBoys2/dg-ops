/**
 * Pure rules for environmental threats, healing and vehicles (pp.55, 60–63, 95).
 */

/** Sample poisons (p.61). speed is a Foundry formula; unit "hours" | "turns". */
export const POISONS = {
  spider: { label: "Spider venom", speed: "1d6", unit: "hours", lethality: 5, antidote: true },
  badDrug: { label: "Dangerous drug (failed Pharmacy)", speed: "1d6", unit: "hours", lethality: 5, antidote: true },
  arsenic: { label: "Arsenic", speed: "1d6", unit: "hours", lethality: 10, antidote: false },
  venom: { label: "Scorpion or rattlesnake venom", speed: "1d6", unit: "hours", lethality: 10, antidote: true },
  phosgene: { label: "Phosgene gas", speed: "2d6", unit: "hours", lethality: 15, antidote: false },
  cyanide: { label: "Hydrogen cyanide gas", speed: "1d6", unit: "turns", lethality: 20, antidote: true },
  sarin: { label: "Sarin gas", speed: "2d6", unit: "turns", lethality: 20, antidote: true },
  ricin: { label: "Ricin", speed: "2d6", unit: "hours", lethality: 20, antidote: false },
  truthDrug: { label: "Botched interrogation drug", speed: "1d6", unit: "hours", lethality: 5, antidote: true },
};

/** Sample diseases (p.61). penalty applies to the CON test. */
export const DISEASES = {
  meningitis: { label: "Bacterial meningitis", speed: "1d6", unit: "days", penalty: -40, damage: "1d4", cure: "Antibiotics" },
  pneumonia: { label: "Bacterial pneumonia", speed: "1d6", unit: "days", penalty: 0, damage: "1d6", cure: "Antibiotics" },
  gangrene: { label: "Gangrene", speed: "1d6", unit: "days", penalty: -20, damage: "1d4", cure: "Antibiotics, excision or amputation" },
  plague: { label: "Plague", speed: "1d6", unit: "days", penalty: 0, damage: "1d6", cure: "Antibiotics" },
  hiv: { label: "HIV/AIDS", speed: "1d6", unit: "months", penalty: 0, damage: "1d6", cure: "None (antivirals)", persistent: true },
  ebola: { label: "Ebola virus", speed: "1d6", unit: "days", penalty: -40, damage: "1d6", cure: "None" },
};

export const TIME_UNITS = {
  turns: 6,
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
  months: 2592000,
};

/**
 * Poison after onset (p.60): Lethality first; if it fails, CON×5 to withstand.
 * Success: half damage. Critical: 1 HP. Fumble: double. Antidote after onset halves rating and damage.
 */
export function resolvePoison({ lethality, lethalityTotal, dice, conOutcome, antidoteAfterOnset = false }) {
  const rating = antidoteAfterOnset ? Math.floor(lethality / 2) : lethality;
  if (lethalityTotal <= rating) return { killed: true, damage: Infinity, rating };
  let dmg = dice[0] + dice[1];
  if (antidoteAfterOnset) dmg = Math.ceil(dmg / 2);
  if (conOutcome.critical && conOutcome.success) dmg = 1;
  else if (conOutcome.success) dmg = Math.ceil(dmg / 2);
  else if (conOutcome.fumble) dmg *= 2;
  return { killed: false, damage: dmg, rating };
}

/**
 * Disease interval (p.60): CON×5. Success: half damage and recovers; critical: no damage and recovers.
 * Failure: full damage, test again next interval. Fumble: double damage.
 */
export function resolveDiseaseInterval({ rolledDamage, conOutcome }) {
  if (conOutcome.success && conOutcome.critical) return { damage: 0, recovered: true };
  if (conOutcome.success) return { damage: Math.ceil(rolledDamage / 2), recovered: true };
  if (conOutcome.fumble) return { damage: rolledDamage * 2, recovered: false };
  return { damage: rolledDamage, recovered: false };
}

/** Falling (p.62): 1–3 m does 1D6 (2D6 uncontrolled); beyond, Lethality 1% per metre. */
export function fallProfile({ metres, uncontrolled = false }) {
  if (metres <= 3) return { kind: "damage", formula: uncontrolled ? "2d6" : "1d6" };
  return { kind: "lethality", rating: Math.round(metres) };
}

/** Impact (p.62): Lethality 10% per 40 km/h (25 mph); doubled into a wall with nowhere to tumble. */
export function impactRating({ kph, wall = false }) {
  const base = Math.floor(kph / 40) * 10;
  return wall ? base * 2 : base;
}

/** Fire intensities (p.62). */
export const FIRE = {
  minor: { label: "Minor (candle)", damage: "1" },
  moderate: { label: "Moderate (flaming brand, brief exposure to a larger fire)", damage: "1d6" },
  large: { label: "Large (campfire)", damage: "2d6" },
  major: { label: "Major (scalding steam, bonfire, furnace)", lethality: 10 },
};

/** Cold endurance before CON tests start (p.63). Returns seconds. */
export function coldEndurance({ con, preparation }) {
  if (preparation === "full") return con * 3600;
  if (preparation === "partial") return con * 5 * 60;
  return con * 60;
}

/** Suffocation (p.62): CON×5 turns with a breath; then each turn CON×5 — fail 1D6, success 1 HP. */
export function suffocationTurns({ con, tookBreath }) {
  return tookBreath ? con * 5 : 0;
}

/* ---------- Healing (p.55) ---------- */

/** First Aid / stabilization result. */
export function firstAidResult(outcome) {
  if (outcome.success && outcome.critical) return { heal: "2d4x", damage: null };
  if (outcome.success) return { heal: "1d4", damage: null };
  if (outcome.fumble) return { heal: null, damage: "1d4" };
  return { heal: null, damage: null };
}

/** Recuperation: CON×5 once per day. */
export function recuperationResult(outcome) {
  if (outcome.success && outcome.critical) return { heal: "1d4", damage: null };
  if (outcome.success) return { heal: "1", damage: null };
  if (outcome.fumble) return { heal: null, damage: "1" };
  return { heal: null, damage: null };
}

/* ---------- Vehicles (p.95) ---------- */

/** Ramming damage to the target. */
export function rammingProfile({ speed, vehicleMaxHp }) {
  if (speed === "low") return { kind: "damage", formula: "1d6" };
  if (speed === "lowHeavy") return { kind: "damage", formula: "2d6" };
  if (speed === "moderate") return { kind: "lethality", rating: Math.floor(vehicleMaxHp / 2) };
  return { kind: "lethality", rating: Math.min(30, vehicleMaxHp) };
}

/** Passenger damage in a collision. */
export function passengerDamageFormula({ rammed, seatbelt, targetIsHuge = true }) {
  if (!rammed && !targetIsHuge) return null;
  const f = rammed ? "2d6" : "1d6";
  return seatbelt ? `floor(${f}/2)` : f;
}

export const VEHICLE_SPEED_MODS = { fast: 20, normal: 0, slow: -20, junk: -20 };
