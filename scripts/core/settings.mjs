import { MODULE_ID } from "./constants.mjs";

/**
 * Settings, grouped into categories for the Ops Settings window.
 * label: short name · hint: what it does in plain words · page: Agent's Handbook page.
 */
export const CATEGORIES = {
  team: { label: "Team", icon: "fas fa-users", blurb: "Which Agents are the players' team. The module uses this for SAN cards, Home scenes, the Delta Green Bond queue, team status and the setup checklist." },
  sanity: { label: "Sanity & Bonds", icon: "fas fa-brain", blurb: "SAN loss, projection onto Bonds, insanity, disorders, adaptation and Willpower." },
  tests: { label: "Rolls & tests", icon: "fas fa-dice-d20", blurb: "Who rolls what, opposed tests and fumbles. By default players roll their own dice: when the automation needs a roll from an Agent, a Roll button appears in chat." },
  combat: { label: "Combat", icon: "fas fa-crosshairs", blurb: "Defence prompts, Lethality, kill radius, suppression, injuries and ammo." },
  medical: { label: "Medical & hazards", icon: "fas fa-kit-medical", blurb: "Healing, complications and temporary stat loss." },
  downtime: { label: "Downtime", icon: "fas fa-house", blurb: "Home scenes, money and requisition." },
  records: { label: "Records", icon: "fas fa-box-archive", blurb: "Backups of Agents, so a bad night can be undone." },
  interface: { label: "Interface", icon: "fas fa-display", blurb: "How much the module shows, and to whom." },
};

export const DEFS = {
  // Sanity
  projectionPrompt: { cat: "sanity", label: "Ask players to project SAN loss onto a Bond", hint: "Before a loss lands, the player sees what it will do (insanity? Breaking Point?) and can spend 1D4 WP to reduce it at a Bond's expense.", page: 74, type: Boolean, default: true },
  autoAcute: { cat: "sanity", label: "Start acute episodes automatically", hint: "When a disorder's trigger fires (2+ SAN lost, temporary insanity, Breaking Point), switch its acute episode on and offer Repress.", page: 69, type: Boolean, default: true },
  dgBonds: { cat: "sanity", label: "Queue Delta Green Bond tests after a team catastrophe", hint: "Insanity, new disorders, incapacitation and deaths add an entry to the Console queue. Roll it once the crisis is over.", page: 37, type: Boolean, default: true },
  manualSan: { cat: "sanity", label: "Lowering SAN by hand runs it as a SAN loss", hint: "Typing a lower SAN on an Agent's sheet (or the token bar) runs it as a SAN loss, so projection, temporary insanity, the Breaking Point and adaptation all happen. Undo on the card puts it back.", type: Boolean, default: true },
  zeroWpAutoFail: { cat: "sanity", label: "0 WP: every test fails", hint: "Including SAN tests, until WP recovers.", page: 47, type: Boolean, default: true },
  lowWpPenalty: { cat: "sanity", label: "1–2 WP: emotional breakdown (−20% to all tests)", hint: "Applied and removed automatically as WP changes.", page: 47, type: Boolean, default: true },
  depressionWp: { cat: "sanity", label: "Depressive episodes cost 1D4 WP per test", page: 70, type: Boolean, default: true },
  sleepRules: { cat: "sanity", label: "Sleep rules on the Rest button", hint: "One full night per 24 game hours. A SAN test to sleep after insanity, a new disorder, or with a sleep disorder.", page: 47, type: Boolean, default: true },
  addictionClock: { cat: "sanity", label: "Addiction clock", hint: "Every 24 game hours without feeding an addiction costs 1D6 WP and blocks WP recovery.", page: 70, type: Boolean, default: true },
  insanityBasis: {
    cat: "sanity",
    label: "Temporary insanity checks the loss…",
    hint: "The 5+ SAN rule: count the loss after projecting onto a Bond (projection can stop it) or before.",
    page: 68,
    type: String,
    choices: { after: "after projection", before: "before projection" },
    default: "after",
  },
  adaptResetOnBP: { cat: "sanity", label: "Reaching the Breaking Point resets adaptation progress", hint: "Adaptation needs three losses in a row without temporary insanity or the Breaking Point. Off: only temporary insanity resets the boxes.", page: 73, type: Boolean, default: true },
  insight: { cat: "sanity", label: "Optional rule: Insight", hint: "Temporary insanity from the Unnatural offers +1D6% Unnatural.", page: 69, type: Boolean, default: false, optional: true },

  // Tests
  playersRoll: { cat: "tests", label: "Players roll their own dice", hint: "When the automation needs a roll from an Agent and someone else set it off (you, or another player), a Roll card goes to chat for that Agent's player. You can click it too. If the player isn't connected, it rolls straight away.", type: Boolean, default: true },
  npcRolls: {
    cat: "tests",
    label: "NPC rolls the automation needs",
    hint: "Defences, CON checks, opposed rolls and so on for NPCs. Automatic is faster; a Roll button lets you roll them yourself.",
    type: String,
    choices: { auto: "roll automatically", prompt: "post a Roll button for the Handler" },
    default: "auto",
  },
  opposedBothFail: {
    cat: "tests",
    label: "When both sides fail an opposed test",
    page: 45,
    type: String,
    choices: { handler: "the Handler decides", lower: "the lower roll wins", none: "nobody succeeds" },
    default: "handler",
  },
  fumblePrompt: { cat: "tests", label: "Offer the Handler fumble consequences", hint: "Whispered one-click options: strain, burnout, alienation, exhaustion, distraction, confusion, misfires…", page: 44, type: Boolean, default: true },

  // Combat
  attackWizard: { cat: "combat", label: "Clicking a weapon opens the attack wizard", hint: "Walks through the action (attack, pin, disarm, called shot) and the situation, step by step. Shift-click a weapon to skip it and roll the system's way.", type: Boolean, default: true },
  wizardForNpcs: { cat: "combat", label: "…for NPC weapons too", type: Boolean, default: true },
  defensePrompts: { cat: "combat", label: "Let targets defend", hint: "When an attack hits, the target gets a Defend card in chat: Dodge, fight back, or take it. NPCs follow the NPC rolls setting.", page: 53, type: Boolean, default: true },
  suppression: { cat: "combat", label: "Suppression prompts in a kill radius", hint: "Agents choose cover, prone, or act anyway for 1 SAN.", page: 57, type: Boolean, default: true },
  injurySan: { cat: "combat", label: "Offer SAN tests for injuries", hint: "Shot/stabbed 0/1D4, ≤2 HP 0/1D6, permanent injury 0/1D6 — once per type per fight.", page: 67, type: Boolean, default: true },
  stunPrompt: { cat: "combat", label: "Stun recovery reminder on the stunned combatant's turn", page: 55, type: Boolean, default: true },
  attackCap: { cat: "combat", label: "Cap attack bonuses at +40%", hint: "Bonuses cap before penalties apply.", page: 52, type: Boolean, default: true },
  ammo: { cat: "combat", label: "Track ammunition", hint: "Counts rounds from the weapon's capacity; bursts and sprays use more.", type: Boolean, default: true },
  promptTimeout: { cat: "combat", label: "Seconds to wait for a player's answer in pop-ups", hint: "For pop-up questions such as projecting onto a Bond. After this the safe default is used. Roll buttons in chat never time out.", type: Number, default: 60, range: { min: 10, max: 600, step: 5 } },
  initiativeTiebreak: {
    cat: "combat",
    label: "Initiative ties on equal DEX",
    page: 50,
    type: String,
    choices: { none: "act simultaneously", random: "random", agents: "Agents first", npcs: "NPCs first" },
    default: "none",
  },
  optionalCritEffects: { cat: "combat", label: "Optional rules: other called shots and critical hits", hint: "Stun, flesh-wound and head-shot called shots; criticals that stun, disarm, knock prone or grant a second attack instead of double damage.", page: 52, type: Boolean, default: false, optional: true },
  optionalInjuries: { cat: "combat", label: "Optional rule: alternative permanent injuries", hint: "Crippled limbs, partial blindness or deafness instead of stat loss.", page: 55, type: Boolean, default: false, optional: true },
  npcMooks: { cat: "combat", label: "Shortcut: unlinked NPCs in a kill radius just die", page: 57, type: Boolean, default: false, optional: true },

  // Medical
  complications: { cat: "medical", label: "Post-treatment complications", hint: "Strenuous tests deal 1D4 damage until every HP is healed.", page: 55, type: Boolean, default: true },
  tempStatRestore: { cat: "medical", label: "Temporary stat loss heals 1 point per game day", page: 55, type: Boolean, default: true },
  autoRecuperation: { cat: "medical", label: "Daily recuperation rolls for patients marked as resting", page: 55, type: Boolean, default: true },

  // Downtime
  illicitCash: { cat: "downtime", label: "Optional illicit-cash pursuits in Home scenes", page: 91, type: Boolean, default: true, optional: true },

  // Interface
  kitButton: { cat: "interface", label: "Ops Kit button on sheets", hint: "The colour-coded title-bar button that shows what's automated and fixes it.", type: Boolean, default: true },
  playersSeeKit: { cat: "interface", label: "Players can open the Ops Kit on their own Agents", type: Boolean, default: true },
  tips: { cat: "interface", label: "Show rule tips on cards and prompts", hint: "Short explanations and page references. Turn off once the table knows the rules.", type: Boolean, default: true, client: true },
  compactCards: { cat: "interface", label: "Compact chat cards", hint: "Fold the dice details away behind 'Details'.", type: Boolean, default: false, client: true },
  undo: { cat: "interface", label: "Undo buttons on damage and SAN cards (Handler)", type: Boolean, default: true },
  systemCards: { cat: "interface", label: "Chat cards match the Delta Green system's cards", hint: "Dark header with the speaker's portrait, the system's paper and typeface (it follows the system's Program / Cowboys / Outlaws sheet style). Off: Foundry's usual message header.", type: Boolean, default: true, client: true },
  caseFile: { cat: "interface", label: "Case-file touches", hint: "Classification line across Ops windows, rubber-stamp results.", type: Boolean, default: true, client: true },
  pingPlayers: { cat: "interface", label: "Tell players when a roll is waiting for them", hint: "A notice and a highlighted card when a Roll or Defend card is theirs to click. The Handler gets a Nudge button on waiting rows.", type: Boolean, default: true, client: true },
  consoleButton: { cat: "interface", label: "Handler Console button in the token controls", hint: "Everything in it is also in the Delta Green Ops macro compendium.", type: Boolean, default: true },
  combatMarks: { cat: "interface", label: "Combat tracker marks", hint: "Shows who has acted this round and whose melee roll still stands (Handler sees the number).", type: Boolean, default: true },
  backups: { cat: "records", label: "Back up Agents automatically", hint: "A copy of every Agent goes into the world compendium 'Ops: Agent backups' when the Handler logs in (once a day) and before each Home scene ends. Restore from the Ops Kit's Case log.", type: Boolean, default: true },
  backupsKept: { cat: "records", label: "Backups kept per Agent", type: Number, default: 5, range: { min: 1, max: 20, step: 1 } },
};

/** One-click presets for the settings window. */
export const PRESETS = {
  book: {
    label: "By the book",
    blurb: "Every core rule automated with prompts; optional rules off. Recommended.",
    values: Object.fromEntries(Object.entries(DEFS).filter(([, d]) => d.cat !== "interface").map(([k, d]) => [k, d.default])),
  },
  light: {
    label: "Light touch",
    blurb: "The maths runs automatically, with fewer interruptions: no attack wizard and no defence, suppression, injury-SAN, fumble, sleep or manual-SAN prompts.",
    values: { defensePrompts: false, suppression: false, injurySan: false, fumblePrompt: false, sleepRules: false, addictionClock: false, complications: false, stunPrompt: false, attackWizard: false, manualSan: false },
  },
  everything: {
    label: "Everything",
    blurb: "By the book plus every optional rule: Insight, alternative crits and injuries, NPC kill-radius shortcut.",
    values: { insight: true, optionalCritEffects: true, optionalInjuries: true, npcMooks: true, illicitCash: true },
  },
};

export function registerSettings() {
  for (const [key, def] of Object.entries(DEFS)) {
    const { cat, label, hint, page, optional, client, ...rest } = def;
    game.settings.register(MODULE_ID, key, {
      ...rest,
      name: label,
      hint: [hint, page ? `(p.${page})` : ""].filter(Boolean).join(" "),
      scope: client ? "client" : "world",
      config: false,
    });
  }
  game.settings.register(MODULE_ID, "queue", { scope: "world", config: false, type: Object, default: { catastrophes: [] } });
  game.settings.register(MODULE_ID, "schedule", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "clock", { scope: "world", config: false, type: Object, default: { mode: "auto", offset: 0 } });
  game.settings.register(MODULE_ID, "chases", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "opPriority", { scope: "world", config: false, type: String, default: "normal" });
  game.settings.register(MODULE_ID, "activeTeam", { scope: "world", config: false, type: Object, default: { mode: "auto", folder: "", ids: [] } });
  game.settings.register(MODULE_ID, "npcTemplates", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(MODULE_ID, "lastBackup", { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, "welcomed", { scope: "world", config: false, type: String, default: "" });
}

/**
 * Campaign switches, registered apart from DEFS: they show in Foundry's own Configure Settings
 * under the module and need a reload, because they decide what code loads at all.
 */
export function registerCampaignSettings() {
  game.settings.register(MODULE_ID, "ilCampaign", {
    name: "Impossible Landscapes campaign features",
    hint: "Hidden Corruption, Gifts and Insights, the Yellow Sign, Interference, Soul Bottles, campaign tomes, and metal-and-porcelain damage. Everything is kept on the Agents, so switching this off and on again loses nothing.",
    scope: "world",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: false,
  });
}

export const setting = (key) => {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return DEFS[key]?.default;
  }
};
