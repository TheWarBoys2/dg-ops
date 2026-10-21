/**
 * Pure rules tests (no Foundry). Run: node test/rules.test.mjs
 */
import assert from "node:assert/strict";
import { computeSanLoss } from "../scripts/rules/sanity.mjs";
import * as IL from "../scripts/campaigns/il/rules.mjs";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("SAN: failure with maxOnFail takes the formula's maximum", () => {
  const fail = { success: false, critical: false, fumble: false };
  assert.equal(computeSanLoss({ outcome: fail, successFormula: "0", failureFormula: "1D6", rolledSuccess: 0, rolledFailure: 2 }), 2);
  assert.equal(computeSanLoss({ outcome: fail, successFormula: "0", failureFormula: "1D6", rolledSuccess: 0, rolledFailure: 2, maxOnFail: true }), 6);
  assert.equal(computeSanLoss({ outcome: { success: true }, successFormula: "1", failureFormula: "1D6", rolledSuccess: 1, rolledFailure: 0, maxOnFail: true }), 1);
});

test("IL: starting Corruption counts adaptation checks and Art skills at 20%+", () => {
  const sys = {
    sanity: { adaptations: { violence: { incident1: true, incident2: true, incident3: false }, helplessness: { incident1: true } } },
    typedSkills: { a: { group: "Art", label: "Painting", proficiency: 20 }, b: { group: "Art", label: "Poetry", proficiency: 19 }, c: { group: "Craft", label: "Mechanics", proficiency: 60 } },
  };
  const s = IL.startingCorruption(sys);
  assert.deepEqual([s.checks, s.arts, s.total], [3, 1, 4]);
});

test("IL: session caps per operation", () => {
  assert.deepEqual(Object.values(IL.OPERATIONS).map((o) => o.cap), [3, 4, 5, 6]);
  assert.equal(IL.sessionCap("map-of-skin"), 5);
});

test("IL: gains and losses are capped separately per session", () => {
  let r = IL.applyCorruption({ value: 2, delta: 2, session: { gained: 2, lost: 0 }, cap: 3 });
  assert.deepEqual([r.value, r.applied, r.capped], [3, 1, true]);
  r = IL.applyCorruption({ value: 3, delta: -2, session: { gained: 3, lost: 0 }, cap: 3 });
  assert.deepEqual([r.value, r.applied, r.capped], [1, -2, false]);
  r = IL.applyCorruption({ value: 3, delta: 1, session: { gained: 3, lost: 0 }, cap: 3, ignoreCap: true });
  assert.deepEqual([r.value, r.capped, r.session.gained], [4, true, 4]);
});

test("IL: Corruption stays within 0–10 and above the bottle floor", () => {
  assert.equal(IL.applyCorruption({ value: 9, delta: 5, cap: 6 }).value, 10);
  assert.equal(IL.applyCorruption({ value: 1, delta: -4, cap: 6 }).value, 0);
  assert.equal(IL.applyCorruption({ value: 6, delta: -3, cap: 6, floor: 5 }).value, 5);
});

test("IL: who does it pick? highest Corruption, ties to the lowest SAN", () => {
  const r = IL.rankTargets([{ id: "a", corruption: 3, san: 40 }, { id: "b", corruption: 5, san: 60 }, { id: "c", corruption: 5, san: 30 }]);
  assert.deepEqual(r.map((x) => x.id), ["c", "b", "a"]);
});

test("IL: threshold opens for the whole group and pulls the others up", () => {
  const r = IL.thresholdCheck([{ id: "doug", corruption: 8 }, { id: "dina", corruption: 3 }], 5);
  assert.equal(r.open, true);
  assert.deepEqual(r.pulled, [{ id: "dina", from: 3, to: 5 }]);
  assert.equal(IL.thresholdCheck([{ id: "x", corruption: 2 }], 5).open, false);
});

test("IL: Gifts bands and uniqueness", () => {
  assert.deepEqual([1, 10, 11, 90, 91, 140].map(IL.bandFor), [0, 0, 1, 8, 9, 9]);
  const r = IL.assignGiftsInsights([
    { id: "a", giftRoll: 5, insightRoll: 95, corruption: 0 },
    { id: "b", giftRoll: 7, insightRoll: 99, corruption: 0 },
    { id: "c", giftRoll: 2, insightRoll: 92, corruption: 0 },
  ]);
  assert.equal(new Set(r.map((x) => x.gift)).size, 3);
  assert.equal(new Set(r.map((x) => x.insight)).size, 3);
  assert.deepEqual(r.map((x) => x.gift), [0, 1, 2]);
  assert.deepEqual(r.map((x) => x.insight), [9, 8, 7]);
  assert.equal(IL.GIFTS.length, 10);
  assert.equal(IL.INSIGHTS.length, 10);
});

test("IL: interference by Corruption", () => {
  assert.deepEqual([0, 2, 3, 4, 7, 8, 10].map((c) => IL.interferenceFor(c).key), ["accident", "accident", "illness", "violence", "violence", "bizarre", "bizarre"]);
  assert.equal(IL.interferenceFor(8).lethality, 15);
  assert.equal(IL.interferenceFor(3).damage, "1D8");
});

test("IL: Soul Bottle search table", () => {
  assert.deepEqual([1, 93, 94, 98, 99, 100, 110].map((t) => IL.bottleSearch(t).key), ["manifestation", "manifestation", "known", "known", "bond", "own", "own"]);
});

test("IL: metal and porcelain", () => {
  const res = { damage: 7, killed: false, note: "" };
  assert.equal(IL.metalAndPorcelain({ kind: "damage", rolled: 7, res }).damage, 1);
  assert.equal(IL.metalAndPorcelain({ kind: "damage", rolled: 8, res }), null);
  const lethal = IL.metalAndPorcelain({ kind: "lethality", rolled: 9, res: { damage: Infinity, killed: true } });
  assert.deepEqual([lethal.damage, lethal.killed], [1, false]);
});

test("IL: tome presets have page references", () => {
  for (const t of IL.TOMES) assert.ok(t.page >= 348 && t.page <= 350, t.id);
  assert.match(IL.tomeSummary(IL.TOMES.find((t) => t.id === "redBook")), /SAN −1D4\+2/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
console.log(`rules: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
