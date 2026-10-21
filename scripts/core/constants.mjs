export const MODULE_ID = "dg-ops";
export const SYSTEM_ID = "deltagreen";
export const SOCKET = `module.${MODULE_ID}`;

export const STATUS = {
  pinned: "dgops-pinned",
  suppressed: "dgops-suppressed",
  onFire: "dgops-onfire",
  tempInsane: "dgops-tempinsane",
  breakdown: "dgops-breakdown",
  lostControl: "dgops-lostcontrol",
  aiming: "dgops-aiming",
  unaware: "dgops-unaware",
  cover: "dgops-cover",
  suffocating: "dgops-suffocating",
  distracted: "dgops-distracted",
  guard: "dgops-guard",
  helpless: "dgops-helpless",
  stun: "stun",
  prone: "prone",
  unconscious: "unconscious",
  dead: "dead",
};

export const ROLL_TARGET_KEYS = ["system.rollTarget.allSkills", "system.rollTarget.sanity", "system.rollTarget.statistics"];

export const STAT_KEYS = ["str", "con", "dex", "int", "pow", "cha"];
export const PHYSICAL_STATS = ["str", "con", "dex"];
export const MENTAL_STATS = ["int", "pow", "cha"];

/** Skills that count as strenuous for treatment complications (p.55). */
export const STRENUOUS_SKILLS = new Set(["athletics", "dodge", "melee_weapons", "unarmed_combat", "swim", "ride", "stealth", "heavy_machiner"]);

export const ICON = "modules/dg-ops/assets/icon.svg";

/** Flag helpers. */
export function getFlag(doc, key, fallback = undefined) {
  const v = doc?.getFlag?.(MODULE_ID, key);
  return v === undefined ? fallback : v;
}

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);
export const warn = (...args) => console.warn(`${MODULE_ID} |`, ...args);
