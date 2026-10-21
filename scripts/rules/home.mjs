/**
 * Home scenes and between-operation consequences (pp.78–81, 87–91).
 * Functions return effect descriptors; the Foundry layer evaluates formulas and applies them.
 *
 * Effect kinds:
 *  { kind: "san", amount: number|string, cap: "pow5" }       SAN change (string = dice formula, may be negative)
 *  { kind: "bond", target, amount }                           target: "chosen" | "chosenNonDG" | "eachNonDG" | "eachAll" | "handlerNonDG"
 *  { kind: "newBond", score: "halfCha" }
 *  { kind: "therapistBond" }
 *  { kind: "cureDisorder" }
 *  { kind: "note", text }
 */

export const PURSUITS = {
  fulfill: { label: "Fulfill Responsibilities", roll: "san", needsBond: "nonDG" },
  nature: { label: "Back to Nature", roll: "san" },
  newBond: { label: "Establish a New Bond", roll: "cha" },
  therapy: { label: "Go to Therapy", roll: "luckOrTherapist" },
  motivation: { label: "Personal Motivation", roll: "san" },
  specialTraining: { label: "Special Training", roll: null },
  stayOnCase: { label: "Stay on the Case", roll: "handlerSkill" },
  improve: { label: "Improve Skills or Stats", roll: "custom" },
  studyUnnatural: { label: "Study the Unnatural", roll: null },
  raiseCash: { label: "Optional: Raise Illicit Cash", roll: "skill", optional: true },
  squander: { label: "Optional: Squander Illicit Cash", roll: "accountingOrLuck", optional: true },
};

const o = (x) => x || { success: false, critical: false, fumble: false };

export function fulfillEffects(outcome) {
  const r = o(outcome);
  if (r.success) {
    const fx = [{ kind: "bond", target: "chosenNonDG", amount: "1d6", capCha: true }];
    if (r.critical) fx.push({ kind: "san", amount: 1, cap: "pow5" });
    return fx;
  }
  if (r.fumble) return [{ kind: "bond", target: "chosenNonDG", amount: "-1d4" }, { kind: "san", amount: -1 }];
  return [{ kind: "bond", target: "chosenNonDG", amount: 1, capCha: true }];
}

export function natureEffects(outcome) {
  const r = o(outcome);
  const fx = [{ kind: "bond", target: "chosenNonDG", amount: -1 }];
  if (r.success) fx.push({ kind: "san", amount: r.critical ? 4 : "1d4", cap: "pow5" });
  else if (r.fumble) fx.push({ kind: "san", amount: "-1d4" });
  else fx.push({ kind: "san", amount: 1, cap: "pow5" });
  return fx;
}

export function newBondEffects(outcome) {
  const r = o(outcome);
  if (!r.success) return [{ kind: "note", text: "The relationship doesn't take hold yet." }];
  return [{ kind: "newBond", score: "halfCha" }, { kind: "bond", target: "chosenNonDG", amount: -1 }];
}

/**
 * @param {object} outcome Luck or therapist Psychotherapy result.
 * @param {{truthful:boolean, hasDisorder:boolean}} p
 */
export function therapyEffects(outcome, { truthful, hasDisorder }) {
  const r = o(outcome);
  const fx = [{ kind: "bond", target: "chosenNonDG", amount: -1 }];
  if (truthful) {
    if (r.success) fx.push({ kind: "san", amount: r.critical ? 6 : "1d6", cap: "pow5" });
    else if (r.fumble) fx.push({ kind: "san", amount: -1 });
    else fx.push({ kind: "san", amount: 1, cap: "pow5" });
  } else {
    if (r.success) fx.push({ kind: "san", amount: r.critical ? 4 : "1d4", cap: "pow5" });
    else if (r.fumble) fx.push({ kind: "san", amount: -1 });
  }
  if (r.success && r.critical && hasDisorder) {
    fx.push({ kind: "cureDisorder" }, { kind: "therapistBond" }, { kind: "bond", target: "chosenNonDG", amount: "-1d4" });
  }
  return fx;
}

export function motivationEffects(outcome) {
  const r = o(outcome);
  if (r.success) return [{ kind: "san", amount: r.critical ? "1d4" : 1, cap: "pow5" }, { kind: "bond", target: "chosenNonDG", amount: -1 }];
  if (r.fumble) return [{ kind: "san", amount: -1 }];
  return [];
}

export function stayOnCaseEffects(outcome) {
  const r = o(outcome);
  const fx = [{ kind: "bond", target: "chosenNonDG", amount: -1 }, { kind: "san", amount: "1d6-3", cap: "pow5" }];
  let text = "Nothing new turns up.";
  if (r.success && r.critical) text = "An especially valuable clue (Handler's choice).";
  else if (r.success) text = "A pertinent clue (Handler's choice).";
  else if (r.fumble) text = "A 'valuable clue' that will prove dangerously wrong (Handler's secret).";
  fx.push({ kind: "note", text, handlerOnly: true });
  return fx;
}

/** Improve: test fails → +3D6% skill (max 99) or +1 stat (max 18); each increase costs a non-DG Bond 1. */
export function improveEffects(outcome, { kind }) {
  const r = o(outcome);
  if (r.success) return [{ kind: "note", text: "Already as good as practice can make it: no gain." }];
  return [
    { kind: kind === "stat" ? "statUp" : "skillUp", amount: kind === "stat" ? 1 : "3d6" },
    { kind: "bond", target: "chosenNonDG", amount: -1 },
  ];
}

export function raiseCashEffects(outcome) {
  const r = o(outcome);
  const fx = [{ kind: "bond", target: "eachNonDG", amount: -1 }];
  if (r.success) fx.push({ kind: "cash", amount: r.critical ? "2*(3d6)" : "3d6" });
  else if (r.fumble) fx.push({ kind: "note", text: "The misdeed is detected: the Agent faces firing (then prosecution if fired)." }, { kind: "fired" });
  return fx;
}

export function squanderEffects(outcome, { level }) {
  const r = o(outcome);
  if (r.success) {
    return level === "extreme"
      ? [{ kind: "bond", target: "eachNonDG", amount: "1d4", capCha: true }]
      : [{ kind: "bond", target: "chosenNonDG", amount: "1d4", capCha: true }];
  }
  const fx = [{ kind: "bond", target: "chosen", amount: "-1d6" }];
  if (r.fumble) fx.push({ kind: "prosecute" });
  return fx;
}

/* ---------- Getting fired / prosecution (p.80) ---------- */

/** Bond test after firing or acquittal: CHA test per Bond (−20% for job colleagues) or lose 1D4. */
export function bondStressAfter(outcome) {
  return o(outcome).success ? 0 : "1d4";
}

/** Conviction: CHA test per Bond: success −1, failure −1D6. */
export function bondStressConvicted(outcome) {
  return o(outcome).success ? 1 : "1d6";
}

/** Law roll before the Luck roll. */
export function lawPrepModifier(outcome) {
  const r = o(outcome);
  if (r.success) return r.critical ? 40 : 20;
  return r.fumble ? -40 : -20;
}

/* ---------- Money (pp.84–91) ---------- */

export const EXPENSE = ["incidental", "standard", "unusual", "major", "extreme"];
export const EXPENSE_LABELS = {
  incidental: "Incidental (up to $150)",
  standard: "Standard ($200–$800)",
  unusual: "Unusual ($1,000–$5,000)",
  major: "Major ($6,000–$30,000)",
  extreme: "Extreme ($36,000+)",
};

export function normalizeExpense(value) {
  const v = String(value ?? "").toLowerCase();
  return EXPENSE.find((e) => v.startsWith(e)) ?? "standard";
}

export function expenseShift(level, delta) {
  const i = Math.max(0, Math.min(EXPENSE.length - 1, EXPENSE.indexOf(level) + delta));
  return EXPENSE[i];
}

/** "Do we have it?" penalty and requisition penalty (pp.86–87). */
export function expensePenalty(level) {
  if (level === "major") return -20;
  if (level === "extreme") return -40;
  return 0;
}

export const PRIORITY_MODS = { low: -20, normal: 0, high: 20 };

/** Illicit cash in Standard-purchase units (p.91). */
export function cashUnits(level) {
  return { incidental: 0, standard: 1, unusual: 5, major: 25 }[level] ?? null;
}

/**
 * Spending your own money (p.89). Wealthy Agents treat each expense as one category lower.
 * @returns {{test:boolean, bonus:number, onSuccess:object[], onFailure:object[], always:object[]}}
 */
export function ownMoneyRules(level, { wealthy = false } = {}) {
  const lvl = wealthy ? expenseShift(level, -1) : level;
  const bonus = wealthy ? 20 : 0;
  switch (lvl) {
    case "incidental":
      return { test: false, bonus, always: [], onSuccess: [], onFailure: [] };
    case "standard":
      return { test: true, bonus, always: [], onSuccess: [], onFailure: [{ kind: "bond", target: "chosenNonDG", amount: -1 }] };
    case "unusual":
      if (wealthy) return { test: true, bonus, always: [], onSuccess: [], onFailure: [{ kind: "bond", target: "chosenNonDG", amount: -1 }] };
      return { test: false, bonus, always: [{ kind: "bond", target: "chosenNonDG", amount: -1 }], onSuccess: [], onFailure: [] };
    case "major":
      return {
        test: true,
        bonus,
        always: [],
        onSuccess: [{ kind: "bond", target: "eachNonDG", amount: -1 }],
        onFailure: [{ kind: "bond", target: "handlerNonDG", amount: "-1d4", othersAmount: -1 }],
      };
    default:
      return { test: false, bonus, always: [{ kind: "bond", target: "eachNonDG", amount: "-1d4" }], onSuccess: [], onFailure: [] };
  }
}

/** Asking a Bond to obtain something (p.89). CHA×5 test; returns {gets, bond}. */
export function askBondRules(level, outcome) {
  const r = o(outcome);
  switch (level) {
    case "incidental":
    case "standard":
      return r.success ? { gets: true, bond: 0 } : { gets: false, bond: -1 };
    case "unusual":
      return { gets: r.success, bond: -1 };
    case "major":
      return r.success ? { gets: true, bond: -1 } : { gets: false, bond: "-1d4" };
    default:
      return r.success ? { gets: true, bond: "-1d4" } : { gets: false, bond: "-1d6" };
  }
}

/* ---------- Delta Green Bonds after a team catastrophe (p.37) ---------- */

/**
 * Failed SAN test after a team catastrophe.
 * @param {{existingDGBondIds:string[], teammateIds:string[]}} p
 */
export function dgBondPlan({ teammates, existingBondsByTeammate }) {
  const create = [];
  const deepen = [];
  for (const t of teammates.slice(0, 5)) {
    if (existingBondsByTeammate[t]) deepen.push(t);
    else create.push(t);
  }
  return { create, deepen };
}
