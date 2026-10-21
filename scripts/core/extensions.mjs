/**
 * Extension points for optional rule sets (campaign modules). The core code calls these and stays
 * campaign-agnostic: with nothing registered, every call is a no-op.
 *
 *  - SAN pre-checks:  fn({ actor, params }) → { skip?: string, maxOnFail?: boolean, notes?: string[] } | null
 *                     Runs before a SAN test is rolled. `skip` cancels the test (the string says why).
 *  - SAN results:     fn({ actor, params, result }) after the loss has landed and the card is posted.
 *  - Damage filters:  fn({ actor, kind: "damage" | "lethality", rolled, res }) → res | null
 *                     Runs on an attack's resolved damage, before it's applied. Return a changed copy.
 *  - Study sources:   { id, label, group, run(actor, ctx) → { line, notes, rolls } } offered in Study the Unnatural.
 */
import { warn } from "./constants.mjs";

const sanPreChecks = [];
const sanResults = [];
const damageFilters = [];
const studySources = [];

export function addSanPreCheck(fn) {
  sanPreChecks.push(fn);
}

export function onSanResult(fn) {
  sanResults.push(fn);
}

export function addDamageFilter(fn) {
  damageFilters.push(fn);
}

export function addStudySource(source) {
  studySources.push(source);
}

export function getStudySources() {
  return [...studySources];
}

export async function runSanPreChecks(ctx) {
  const out = { skip: null, maxOnFail: false, notes: [] };
  for (const fn of sanPreChecks) {
    try {
      const r = await fn(ctx);
      if (!r) continue;
      if (r.skip && !out.skip) out.skip = r.skip;
      if (r.maxOnFail) out.maxOnFail = true;
      if (r.notes?.length) out.notes.push(...r.notes);
    } catch (e) {
      warn("SAN pre-check failed", e);
    }
  }
  return out;
}

export async function runSanResults(ctx) {
  for (const fn of sanResults) {
    try {
      await fn(ctx);
    } catch (e) {
      warn("SAN result hook failed", e);
    }
  }
}

/** Synchronous so the damage maths stays in one place. */
export function filterDamage({ actor, kind, rolled, res }) {
  let cur = res;
  for (const fn of damageFilters) {
    try {
      cur = fn({ actor, kind, rolled, res: cur }) ?? cur;
    } catch (e) {
      warn("damage filter failed", e);
    }
  }
  return cur;
}

/** Number of registered extensions of every kind (for tests and the setup guide). */
export function extensionCount() {
  return sanPreChecks.length + sanResults.length + damageFilters.length + studySources.length;
}
