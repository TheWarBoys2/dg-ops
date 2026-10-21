/**
 * Mock-Foundry scenarios: the module's real code running against test/mock-foundry.mjs.
 * Run: node test/scenarios.mjs
 */
import assert from "node:assert/strict";
import { dice, dialogs, makeAgent, chat, preset, hooks, settingDefs, asPlayer, asGM } from "./mock-foundry.mjs";

preset("welcomed", "1.6.0");
preset("backups", false);

const main = await import("../scripts/main.mjs");
const { extensionCount, filterDamage } = await import("../scripts/core/extensions.mjs");
const { sanTest } = await import("../scripts/features/sanity.mjs");
const { resolveNormalDamage, resolveLethality } = await import("../scripts/rules/combat.mjs");
const { processDue, events } = await import("../scripts/core/scheduler.mjs");
const IL = await import("../scripts/campaigns/il/index.mjs");
const { sanDialogHtml, sanDialogParams } = await import("../scripts/core/extensions.mjs");
const clock = await import("../scripts/features/clock.mjs");
void main;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const flagsOf = (a) => a.flags?.["dg-ops"]?.il ?? {};
const gmOnly = (m) => Array.isArray(m.whisper) && m.whisper.length === 1 && m.whisper[0] === "gm";
const fresh = () => {
  chat().length = 0;
  dice.queue.length = 0;
  dialogs.length = 0;
  ui.notifications.warns.length = 0;
  asGM();
};

// Foundry's lifecycle, with the campaign setting OFF (the default).
for (const fn of hooks.init ?? []) fn();
for (const fn of hooks.ready ?? []) await fn();

/* ---------------- Setting off ---------------- */

test("IL off: nothing registered, no API, no extensions", () => {
  assert.equal(settingDefs.has("dg-ops.ilCampaign"), true);
  assert.equal(settingDefs.get("dg-ops.ilCampaign").config, true);
  assert.equal(settingDefs.get("dg-ops.ilCampaign").requiresReload, true);
  assert.equal(settingDefs.has("dg-ops.ilOperation"), false);
  assert.equal(game.modules.get("dg-ops").api.il, undefined);
  assert.equal(extensionCount(), 0);
  assert.equal(sanDialogHtml(), "", "no Night World tickbox");
});

test("IL off: SAN tests and damage ignore IL flags", async () => {
  fresh();
  const a = makeAgent({ name: "Off", san: 50, bp: 10, owners: ["p1"], flags: { "dg-ops": { il: { corruption: 10, bottleDestroyed: true, yellowSign: { failed: true } } } } });
  dice.push(90, 2); // fail, 1D6 → 2
  const r = await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "x", tags: ["il:yellowSign"] });
  assert.equal(r.loss, 2);
  assert.equal(r.skipped, undefined);
  assert.equal(a.system.sanity.value, 48);
  const npc = makeAgent({ name: "Doll", type: "npc", flags: { "dg-ops": { il: { metalPorcelain: true } } } });
  const res = filterDamage({ actor: npc, kind: "damage", rolled: 7, res: resolveNormalDamage({ rolled: 7 }) });
  assert.equal(res.damage, 7);
});

/* ---------------- Setting on ---------------- */

test("IL on: init registers the operation setting and the API", () => {
  IL.init();
  game.modules.get("dg-ops").api.il = IL.api();
  assert.equal(settingDefs.get("dg-ops.ilOperation").config, true);
  assert.ok(extensionCount() > 0);
  assert.equal(typeof game.modules.get("dg-ops").api.il.adjust, "function");
});

const il = () => game.modules.get("dg-ops").api.il;

test("Corruption cap: The Night Floors allows +3 a session; New session resets", async () => {
  fresh();
  await game.settings.set("dg-ops", "ilOperation", "night-floors");
  const a = makeAgent({ name: "Doug", owners: ["p1"] });
  for (let i = 0; i < 4; i++) await il().adjust(a, 1, { quiet: true, reason: "Investigated" });
  assert.equal(il().corruption(a), 3);
  assert.ok(ui.notifications.warns.some((w) => /cap/i.test(w)));
  await il().adjust(a, 2, { correction: true, quiet: true });
  assert.equal(il().corruption(a), 5, "corrections aren't capped");
  await il().newSession({ confirm: false });
  await il().adjust(a, 1, { quiet: true });
  assert.equal(il().corruption(a), 6);
  await game.settings.set("dg-ops", "ilOperation", "end-of-world");
  for (let i = 0; i < 7; i++) await il().adjust(a, -1, { quiet: true });
  assert.equal(il().corruption(a), 0, "losses capped at 6 for the last part");
  assert.equal(flagsOf(a).session.lost, 6);
});

test("Corruption threshold pulls the lower Agent up", async () => {
  fresh();
  const doug = makeAgent({ name: "Doug", owners: ["p1"], flags: { "dg-ops": { il: { corruption: 8 } } } });
  const dina = makeAgent({ name: "Dina", owners: ["p1"], flags: { "dg-ops": { il: { corruption: 3 } } } });
  const r = await il().threshold([doug, dina], 5);
  assert.equal(r.open, true);
  assert.equal(il().corruption(dina), 5);
  assert.equal(il().corruption(doug), 8);
  assert.ok(chat().every(gmOnly), "threshold cards are Handler-only");
});

test("Who does it pick? and the starting dialog", async () => {
  fresh();
  const a = makeAgent({ name: "A", san: 40, owners: ["p1"], adapt: { violence: 2, helplessness: 1 }, arts: { Painting: 30 } });
  const b = makeAgent({ name: "B", san: 30, owners: ["p1"] });
  dialogs.push((spec) => ({ action: "ok", data: { [`c-${a.id}`]: 4, [`use-${a.id}`]: true, [`c-${b.id}`]: 4, [`use-${b.id}`]: true } }));
  await il().startingDialog([a, b]);
  assert.equal(il().corruption(a), 4);
  assert.equal(flagsOf(a).started, true);
  const top = await il().whoDoesItPick([a, b]);
  assert.equal(top.name, "B", "tie on Corruption goes to the lower SAN");
});

test("Gifts and Insights are unique across the team", async () => {
  fresh();
  const team = ["G1", "G2", "G3"].map((n) => makeAgent({ name: n, owners: ["p1"] }));
  dice.push(5, 5, 6, 6, 7, 7); // every roll lands in band 01–10
  await il().assignGifts(team, { team });
  const g = team.map((a) => flagsOf(a).gift);
  const i = team.map((a) => flagsOf(a).insight);
  assert.equal(new Set(g).size, 3);
  assert.equal(new Set(i).size, 3);
  assert.ok(chat().every(gmOnly));
  await il().revealGift(team[0]);
  assert.deepEqual(chat().at(-1).whisper.sort(), ["gm", "p1"]);
  assert.equal(flagsOf(team[0]).giftsRevealed, true);
});

test("Yellow Sign: a failure costs Corruption once; afterwards it no longer applies", async () => {
  fresh();
  await il().newSession({ confirm: false });
  const a = makeAgent({ name: "Sign", san: 50, bp: 10, owners: ["p1"] });
  dice.push(90, 3); // fail, 1D4 → 3
  const [r] = await il().yellowSign([a]);
  assert.equal(r.loss, 3);
  assert.equal(il().corruption(a), 1);
  assert.equal(flagsOf(a).yellowSign.failed, true);
  assert.ok(chat().some((m) => /mark/i.test(m.content) && m.whisper.includes("p1")), "compulsion whispered to the player");
  const [again] = await il().yellowSign([a]);
  assert.equal(again.skipped, true);
  assert.equal(a.system.sanity.value, 47);
  assert.equal(il().corruption(a), 1);
});

test("Destroyed Soul Bottle: every failed SAN roll takes the maximum", async () => {
  fresh();
  const a = makeAgent({ name: "Hollow", san: 60, bp: 10, owners: ["p1"] });
  await il().destroyBottle(a);
  dice.push(95, 1); // fail; the 1D6 shows 1, but the loss is the maximum
  const r = await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural" });
  assert.equal(r.loss, 6);
  dice.push(10); // success: unaffected
  const ok = await sanTest({ actor: a, successLoss: "1", failureLoss: "1D6", category: "unnatural" });
  assert.equal(ok.loss, 1);
});

test("Opening a Soul Bottle: survivor gains SAN, +5 Corruption and a floor of 5", async () => {
  fresh();
  await il().newSession({ confirm: false });
  const a = makeAgent({ name: "Opener", san: 60, bp: 5, owners: ["p1"] });
  dice.push(10, 4, 12); // success, 1D10 → 4, then 1D20 → 12
  await il().openBottle(a);
  assert.equal(a.system.sanity.value, 68);
  assert.equal(il().corruption(a), 5);
  assert.equal(flagsOf(a).corruptionFloor, true);
  await il().newSession({ confirm: false });
  await il().adjust(a, -2, { quiet: true });
  assert.equal(il().corruption(a), 5, "can't drop below 5");
});

test("Repeater: 0 SAN at Corruption 10", async () => {
  fresh();
  const a = makeAgent({ name: "Lost", san: 4, bp: 0, owners: ["p1"], flags: { "dg-ops": { il: { corruption: 10, beacon: true } } } });
  await sanTest({ actor: a, fixedLoss: 4, category: "unnatural", source: "x" });
  assert.equal(flagsOf(a).repeater, true);
  assert.ok(chat().some((m) => /Repeater/.test(m.content) && gmOnly(m)));
});

test("Metal and porcelain: an odd roll inflicts only 1", () => {
  const npc = makeAgent({ name: "Marionette", type: "npc", flags: { "dg-ops": { il: { metalPorcelain: true } } } });
  assert.equal(filterDamage({ actor: npc, kind: "damage", rolled: 7, res: resolveNormalDamage({ rolled: 7 }) }).damage, 1);
  assert.equal(filterDamage({ actor: npc, kind: "damage", rolled: 8, res: resolveNormalDamage({ rolled: 8 }) }).damage, 8);
  const lethal = filterDamage({ actor: npc, kind: "lethality", rolled: 9, res: resolveLethality({ rating: 10, total: 9 }) });
  assert.deepEqual([lethal.killed, lethal.damage], [false, 1]);
  const even = filterDamage({ actor: npc, kind: "lethality", rolled: 8, res: resolveLethality({ rating: 10, total: 8 }) });
  assert.equal(even.killed, true);
  const plain = makeAgent({ name: "Thug", type: "npc" });
  assert.equal(filterDamage({ actor: plain, kind: "damage", rolled: 7, res: resolveNormalDamage({ rolled: 7 }) }).damage, 7);
});

test("Interference: misfortune lands 4D6 hours later, by Corruption", async () => {
  fresh();
  const a = makeAgent({ name: "Operator", hp: 12, owners: ["p1"], flags: { "dg-ops": { il: { corruption: 4 } } } });
  dice.push(1, 1, 1, 2); // 4D6 → 5 hours
  await il().interference(a);
  const evt = events().find((e) => e.type === "ilMisfortune");
  assert.equal(evt.due, 5 * 3600);
  dice.push(6); // violence 1D10 → 6
  await processDue(5 * 3600);
  assert.equal(a.system.health.value, 6);
});

test("Read a tome: Unnatural, Art, SAN and Corruption in one step", async () => {
  fresh();
  await il().newSession({ confirm: false });
  const a = makeAgent({ name: "Reader", san: 60, bp: 10, unnatural: 2, owners: ["p1"], arts: { Theatre: 30 } });
  dice.push(3); // 1D4+2 → 5
  await il().readTome(a, "redBook");
  assert.equal(a.system.skills.unnatural.proficiency, 7);
  assert.equal(a.system.typedSkills.art0.proficiency, 35);
  assert.equal(a.system.sanity.value, 55);
  assert.equal(il().corruption(a), 2);
  assert.ok(chat().filter((m) => /Corruption/.test(m.content)).every(gmOnly), "Corruption is only ever whispered to the Handler");
});

test("A player's client routes Corruption through the Handler", async () => {
  fresh();
  const a = makeAgent({ name: "Remote", owners: ["p1"] });
  asPlayer();
  await il().adjust(a, 1, { reason: "Investigated" });
  asGM();
  assert.equal(il().corruption(a), 1);
  const card = chat().at(-1);
  assert.equal(card.author.id, "gm", "the card is posted by the Handler's client");
  assert.ok(gmOnly(card));
});

test("Yellow Sign rolled on the player's client never shows them Corruption", async () => {
  fresh();
  await il().newSession({ confirm: false });
  const a = makeAgent({ name: "Mine", san: 50, bp: 10, owners: ["p1"] });
  asPlayer();
  dice.push(90, 2);
  await il().yellowSign([a]);
  await new Promise((r) => setTimeout(r, 20));
  asGM();
  assert.equal(il().corruption(a), 1);
  const seenByPlayer = chat().filter((m) => m.author.id === "p1" || !m.whisper?.length || m.whisper.includes("p1"));
  assert.ok(seenByPlayer.length > 0);
  assert.ok(seenByPlayer.every((m) => !/Corruption/.test(m.content)), "no card the player can see mentions Corruption");
});

test("Night World tickbox: the loss is rolled but held, and only the Handler sees the number", async () => {
  fresh();
  assert.match(sanDialogHtml(), /Night World/);
  const tags = sanDialogParams({ ilNightWorld: true }).tags;
  assert.deepEqual(tags, ["il:nightWorld"]);
  assert.deepEqual(sanDialogParams({ ilNightWorld: false }), {});
  const a = makeAgent({ name: "Dreamer", san: 50, bp: 10, owners: ["p1"] });
  dice.push(90, 5); // fail, 1D6 → 5
  const r = await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "The Night Floors", tags });
  assert.equal(r.deferred, true);
  assert.equal(r.rawLoss, 5);
  assert.equal(a.system.sanity.value, 50, "nothing comes off the sheet");
  assert.equal(il().nightWorld.of(a).held, 5);
  assert.ok(chat().filter((m) => /held/i.test(m.content)).every(gmOnly));
  dice.push(10, 1); // pass, 1D… success loss "1"
  await sanTest({ actor: a, successLoss: "1", failureLoss: "1D6", category: "violence", source: "Again", tags });
  assert.equal(il().nightWorld.of(a).held, 6);
  assert.equal(a.system.sanity.value, 50);
});

test("Night World: correct the tally by hand, then apply it as one loss when they leave", async () => {
  fresh();
  const a = makeAgent({ name: "Walker", san: 50, bp: 30, owners: ["p1"] });
  await il().nightWorld.setInside(a, true);
  dice.push(90, 4);
  await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "No tickbox, but inside" });
  assert.equal(il().nightWorld.of(a).held, 4, "inside: every SAN test is held");
  await il().nightWorld.hold(a, 2, { source: "Handler's correction" });
  await il().nightWorld.hold(a, -1, { source: "Handler's correction" });
  await il().nightWorld.hold(a, -50);
  assert.equal(il().nightWorld.of(a).held, 0, "never below 0");
  await il().nightWorld.hold(a, 6);
  await il().nightWorld.apply(a);
  assert.equal(a.system.sanity.value, 44);
  assert.deepEqual([il().nightWorld.of(a).held, il().nightWorld.of(a).inside], [0, false]);
  dice.push(90, 3);
  await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "Back home" });
  assert.equal(a.system.sanity.value, 41, "out again: losses land as normal");
});

test("Night World: the dialog saves corrections and applies", async () => {
  fresh();
  const a = makeAgent({ name: "Dlg", san: 50, bp: 10, owners: ["p1"] });
  await il().nightWorld.hold(a, 3);
  dialogs.push({ action: "save", data: { [`h-${a.id}`]: 7, [`c-${a.id}`]: "unnatural" } });
  await il().nightWorld.dialog([a]);
  assert.equal(il().nightWorld.of(a).held, 7);
  dialogs.push({ action: "apply", data: { [`h-${a.id}`]: 7, [`c-${a.id}`]: "unnatural" } });
  dialogs.push(null, null, null); // anything the 7-point loss asks (projection, disorder) is declined
  await il().nightWorld.dialog([a]);
  assert.equal(a.system.sanity.value, 43);
  assert.equal(il().nightWorld.of(a).held, 0);
});

test("Night World rolled on the player's client: held via the Handler, number never shown", async () => {
  fresh();
  const a = makeAgent({ name: "Mine2", san: 50, bp: 10, owners: ["p1"] });
  asPlayer();
  dice.push(90, 3);
  const r = await sanTest({ actor: a, successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "x", tags: ["il:nightWorld"] });
  await new Promise((res) => setTimeout(res, 20));
  asGM();
  assert.equal(r.deferred, true);
  assert.equal(il().nightWorld.of(a).held, 3);
  assert.equal(a.system.sanity.value, 50);
  const seen = chat().filter((m) => !m.whisper?.length || m.whisper.includes("p1"));
  assert.ok(seen.every((m) => !/held/i.test(m.content)));
});

test("Night World console strip: Handler only, shown while inside or holding", async () => {
  const { consoleStrip } = await import("../scripts/campaigns/il/nightworld.mjs");
  const a = makeAgent({ name: "Strip", owners: ["p1"] });
  assert.equal(consoleStrip(a), "");
  await il().nightWorld.hold(a, 2);
  assert.match(consoleStrip(a), /Night World/);
  asPlayer();
  assert.equal(consoleStrip(a), "");
  asGM();
});

test("Console Corruption strip: Handler only", async () => {
  const { consoleCard } = await import("../scripts/campaigns/il/corruption.mjs");
  const a = makeAgent({ name: "Card", owners: ["p1"], flags: { "dg-ops": { il: { corruption: 3 } } } });
  assert.match(consoleCard(a), /Corruption/);
  asPlayer();
  assert.equal(consoleCard(a), "");
  asGM();
});

/* ---------------- Clock (core) ---------------- */

test("Clock: relabel to a date without moving game time", async () => {
  fresh();
  const before = game.time.worldTime;
  const n = events().length;
  await clock.setClock({ to: clock.parseShown({ date: "2026-03-14", time: "23:00" }, "date"), mode: "date", move: false });
  assert.equal(game.time.worldTime, before);
  assert.equal(events().length, n);
  assert.equal(clock.clockText(), "Sat 14 Mar 2026, 23:00");
  assert.equal(clock.clockText(before + 2 * 3600), "Sun 15 Mar 2026, 01:00");
});

test("Clock: moving it runs what's due in between", async () => {
  fresh();
  const t0 = game.time.worldTime;
  await clock.addReminder({ title: "Cult moves the body", notes: "Warehouse 9", delay: 3600 });
  await clock.setClock({ to: clock.parseShown({ date: "2026-03-15", time: "01:00" }, "date"), mode: "date", move: true });
  assert.equal(game.time.worldTime, t0 + 7200);
  await processDue(game.time.worldTime);
  const card = chat().find((m) => /Cult moves the body/.test(m.content));
  assert.ok(card && gmOnly(card), "the reminder is whispered to the Handler");
  assert.match(card.content, /Warehouse 9/);
  assert.equal(events().some((e) => e.type === "manual"), false, "a one-off is gone once it fires");
});

test("Clock: Day numbers, and the dialogs", async () => {
  fresh();
  assert.equal(clock.formatShown(0, "day"), "Day 1, 00:00");
  assert.equal(clock.formatShown(86400 * 2 + 3600 * 9 + 60 * 5, "day"), "Day 3, 09:05");
  assert.equal(clock.parseShown({ day: 3, time: "09:05" }, "day"), 86400 * 2 + 3600 * 9 + 300);
  assert.equal(clock.parseShown({ date: "" }, "date"), null);
  const t0 = game.time.worldTime;
  dialogs.push({ action: "ok", data: { mode: "day", date: "", day: 2, time: "08:00", how: "move" } });
  await clock.setClockDialog();
  assert.equal(game.time.worldTime, t0, "switching to Day numbers only relabels");
  assert.equal(clock.clockText(), "Day 2, 08:00");
  dialogs.push({ action: "ok", data: { mode: "day", date: "", day: 2, time: "10:30", how: "move" } });
  await clock.setClockDialog();
  assert.equal(game.time.worldTime, t0 + 9000);
  assert.equal(clock.clockText(), "Day 2, 10:30");
});

test("Schedule by hand: at a time, repeating, posted to everyone", async () => {
  fresh();
  const a = makeAgent({ name: "Tagged", owners: ["p1"] });
  dialogs.push({ action: "ok", data: { title: "Phone call", notes: "", when: "at", day: 2, time: "12:00", rn: 1, runit: 86400, show: "all", actor: a.uuid } });
  await clock.reminderDialog();
  const evt = events().find((e) => e.type === "manual");
  assert.equal(clock.clockText(evt.due), "Day 2, 12:00");
  assert.equal(evt.actorUuid, a.uuid);
  await processDue(evt.due);
  const card = chat().find((m) => /Phone call/.test(m.content));
  assert.ok(card && !card.whisper?.length, "posted for everyone");
  const again = events().find((e) => e.type === "manual");
  assert.equal(again.due, evt.due + 86400, "repeats daily");
  dialogs.push({ action: "ok", data: { title: "Too late", when: "at", day: 1, time: "00:00", rn: 0, runit: 86400, show: "gm" } });
  await clock.reminderDialog();
  assert.ok(ui.notifications.warns.some((w) => /already passed/.test(w)));
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.stack?.split("\n").slice(0, 8).join("\n       ")}`);
  }
}
console.log(`scenarios: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
