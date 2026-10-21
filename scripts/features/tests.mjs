/**
 * Test helpers: opposed tests (p.45), "who rolls?" group tests (p.43), fumble consequences (p.44).
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, statValue, skillValue, evalFormula, isAgent } from "../core/system.mjs";
import { update, setStatus, hasStatus } from "../core/ops.mjs";
import { postCard, button, registerAction, outcomeBadge, gmWhisper, list } from "../core/chat.mjs";
import { prompt, esc, field } from "../core/ui.mjs";
import { testFor, createGroupCard, registerContinuation } from "../core/requests.mjs";
import { resolveOpposed } from "../rules/dice.mjs";
import { tempStatLoss } from "./hazards.mjs";
import { applyDamage } from "./injury.mjs";

const STAT_LABEL = { str: "STR", con: "CON", dex: "DEX", int: "INT", pow: "POW", cha: "CHA" };

export function testChoices(actor) {
  const out = {};
  for (const k of Object.keys(STAT_LABEL)) out[`stat:${k}`] = `${STAT_LABEL[k]}×5 (${statValue(actor, k) * 5}%)`;
  for (const [k, s] of Object.entries(actor?.system?.skills ?? {})) out[`skill:${k}`] = `${s.label ?? k} (${s.proficiency}%)`;
  for (const [k, s] of Object.entries(actor?.system?.typedSkills ?? {})) out[`skill:${k}`] = `${s.group ?? ""} ${s.label ?? k} (${s.proficiency}%)`;
  out["sanity:sanity"] = "SAN";
  out["luck:luck"] = "Luck (50%)";
  return out;
}

function selectFor(actor, name, selected = "skill:alertness") {
  return `<select name="${name}">${Object.entries(testChoices(actor))
    .map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${esc(l)}</option>`)
    .join("")}</select>`;
}

function spec(choice) {
  const [type, key] = String(choice).split(":");
  return { type, key };
}

/**
 * A test for an actor, rolled by whoever should roll it: here if this user rolls for the actor,
 * otherwise a Roll card in chat for its player (or the Handler). Resolves to the outcome, or null.
 */
export async function remoteTest(actor, s, modifier = 0, { title = null, reason = "", messageMode } = {}) {
  return testFor(actor, { ...s, modifier, messageMode, context: { opposed: true, ...(s.context ?? {}) } }, { title, reason });
}

/** Group-card row: roll one test. Returns pass/fail for the card and the number for the Handler. */
registerContinuation("testRow", async ({ spec: sp, modifier = 0, messageMode }, ctx) => {
  const { outcome } = await systemTest(ctx.actor, { type: sp.type, key: sp.key, modifier, messageMode, context: { opposed: true } });
  return { pass: outcome.success, outcome, label: "Rolled", gm: esc(`${outcome.total} vs ${outcome.target}%: ${outcome.critical ? "critical " : ""}${outcome.success ? "success" : outcome.fumble ? "fumble" : "failure"}`) };
});

registerContinuation("opposedFinalize", async ({ messageId, names }) => {
  const message = game.messages.get(messageId);
  const g = message?.getFlag(MODULE_ID, "group");
  if (!g) return;
  const [ra, rb] = g.order.map((id) => g.rows[id]);
  const oa = ra?.outcome;
  const ob = rb?.outcome;
  let verdict;
  if (!oa || !ob) verdict = !oa && !ob ? "Nobody rolled." : `${esc(oa ? names[0] : names[1])} wins (the other side didn't roll).`;
  else {
    const w = resolveOpposed(oa, ob, { bothFail: setting("opposedBothFail") });
    verdict = w === "a" ? `${esc(names[0])} wins` : w === "b" ? `${esc(names[1])} wins` : w === "none" ? "Nobody succeeds" : "Both fail: Handler's call (nobody, or the lower roll)";
  }
  await postCard({
    title: "Opposed test: result",
    kind: "roll",
    body: `<p>${esc(names[0])}: ${oa?.total ?? "—"} ${oa ? outcomeBadge(oa) : ""}<br>${esc(names[1])}: ${ob?.total ?? "—"} ${ob ? outcomeBadge(ob) : ""}</p><p><b>${verdict}</b></p><p class="dgops-quiet">Only you can see this. Tell the table what happens.</p>`,
    whisper: gmWhisper(),
  });
});

/**
 * Opposed test (p.45). Both sides get a Roll button on one card. The rolls are private (the roller
 * and the Handler see their own number); the verdict is whispered to the Handler.
 */
export async function opposedDialog(a = null, b = null) {
  const sel = canvas.tokens.controlled.map((t) => t.actor).filter(Boolean);
  const tgt = [...game.user.targets].map((t) => t.actor).filter(Boolean);
  a ??= sel[0] ?? game.user.character;
  b ??= tgt[0] ?? sel[1];
  if (!a || !b) return ui.notifications.warn("Select one token and target another.");
  const r = await prompt({
    title: "Opposed test",
    width: 520,
    content: `${field(a.name, selectFor(a, "sa", "skill:stealth"))}${field(`${a.name} modifier`, `<input type="number" name="ma" value="0" step="10" style="width:5em">`)}
      ${field(b.name, selectFor(b, "sb", "skill:alertness"))}${field(`${b.name} modifier`, `<input type="number" name="mb" value="0" step="10" style="width:5em">`)}
      ${field("Rolls", `<select name="mode"><option value="roll">Both roll</option><option value="ratings">Nobody rolls: higher rating wins</option></select>`)}
      <p class="hint">Each side rolls from a chat card. Only you see the numbers and who won.</p>`,
  });
  if (!r) return;
  if (r.data.mode === "ratings") {
    const va = valueOf(a, spec(r.data.sa)) + (r.data.ma || 0);
    const vb = valueOf(b, spec(r.data.sb)) + (r.data.mb || 0);
    return postCard({ title: "Opposed (no roll)", body: `<p>${esc(a.name)} ${va}% vs ${esc(b.name)} ${vb}% — <b>${va === vb ? "tie (Handler decides)" : esc(va > vb ? a.name : b.name)}</b> wins.</p>`, whisper: gmWhisper() });
  }
  return createGroupCard({
    title: "Opposed test",
    subtitle: `${esc(a.name)} vs ${esc(b.name)}`,
    kind: "roll",
    reveal: "none",
    rows: [
      { actor: a, run: "testRow", args: { spec: spec(r.data.sa), modifier: r.data.ma || 0 }, button: testChoices(a)[r.data.sa]?.replace(/\s*\(.*$/, "") ?? "Roll" },
      { actor: b, run: "testRow", args: { spec: spec(r.data.sb), modifier: r.data.mb || 0 }, button: testChoices(b)[r.data.sb]?.replace(/\s*\(.*$/, "") ?? "Roll" },
    ],
    finalize: "opposedFinalize",
    finalizeArgs: { names: [a.name, b.name] },
  });
}

function valueOf(actor, s) {
  if (s.type === "stat") return statValue(actor, s.key) * 5;
  if (s.type === "luck") return 50;
  if (s.type === "sanity") return actor.system.sanity?.value ?? 0;
  return skillValue(actor, s.key);
}

/** "Who rolls?" (p.43). Everyone rolls from one card, or the best/worst rolls for the group. */
export async function groupDialog(actors) {
  if (!actors.length) return ui.notifications.warn("Select the tokens of everyone involved.");
  const r = await prompt({
    title: "Group test",
    content: `<p>${actors.map((a) => esc(a.name)).join(", ")}</p>
      ${field("Test", selectFor(actors[0], "s", "skill:alertness"))}
      ${field("Who rolls?", `<select name="mode"><option value="best">Help is useful: highest rating rolls</option><option value="worst">Crowd is a hindrance: lowest rating rolls</option><option value="each">Everyone rolls</option></select>`)}
      ${field("Modifier", `<input type="number" name="m" value="0" step="10" style="width:5em">`)}`,
  });
  if (!r) return;
  const s = spec(r.data.s);
  const label = testChoices(actors[0])[r.data.s]?.replace(/\s*\(.*$/, "") ?? "Roll";
  let who = actors;
  let intro = "";
  if (r.data.mode !== "each") {
    const sorted = [...actors].sort((x, y) => valueOf(y, s) - valueOf(x, s));
    const one = r.data.mode === "best" ? sorted[0] : sorted[sorted.length - 1];
    who = [one];
    intro = `<p>${esc(one.name)} rolls for the group (${r.data.mode === "best" ? "highest" : "lowest"} rating: ${valueOf(one, s)}%).</p>`;
  }
  return createGroupCard({
    title: `Group test: ${esc(label)}`,
    intro,
    kind: "roll",
    reveal: "passfail",
    rows: who.map((actor) => ({ actor, run: "testRow", args: { spec: s, modifier: r.data.m || 0 }, button: `Roll ${label}` })),
  });
}

/* ---------------- Fumbles (p.44) ---------------- */

export async function fumbleHook(roll, message) {
  if (!setting("fumblePrompt")) return;
  const info = message.getFlag(MODULE_ID, "roll");
  if (!info?.percentile || !info.fumble || !roll.actor || !["agent", "npc"].includes(roll.actor.type)) return;
  if (["sanity", "luck"].includes(roll.type)) return;
  const a = roll.actor.uuid;
  const weapon = roll.type === "weapon";
  const btns = [
    button("fumbleFx", "Physical strain", { args: { actorUuid: a, fx: "physical" }, once: "f" }),
    button("fumbleFx", "Emotional burnout", { args: { actorUuid: a, fx: "emotional" }, once: "f" }),
    button("fumbleFx", "Alienation", { args: { actorUuid: a, fx: "alienation" }, once: "f" }),
    button("fumbleFx", "Exhaustion", { args: { actorUuid: a, fx: "exhaustion" }, once: "f" }),
    button("fumbleFx", "Distraction (−20% next test)", { args: { actorUuid: a, fx: "distraction" }, once: "f" }),
    button("fumbleFx", "Confusion (false information)", { args: { actorUuid: a, fx: "confusion" }, once: "f" }),
  ];
  if (weapon) {
    btns.push(
      button("fumbleFx", "Misfire (1D4 turns to clear)", { args: { actorUuid: a, fx: "misfire" }, once: "f" }),
      button("fumbleFx", "Dropped weapon", { args: { actorUuid: a, fx: "drop" }, once: "f" }),
      button("fumbleFx", "Hit a friend/bystander/self", { args: { actorUuid: a, fx: "friendly" }, once: "f" }),
      button("fumbleFx", "Stumbles and falls", { args: { actorUuid: a, fx: "fall" }, once: "f" }),
    );
  }
  await postCard({ actor: roll.actor, title: `Fumble: ${esc(roll.actor.name)}`, body: `<p>The failure comes with catastrophic consequences. Pick one, or narrate your own.</p><div class="dgops-buttons">${btns.join("")}</div>`, whisper: gmWhisper() });
}

registerAction("fumbleFx", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  switch (args.fx) {
    case "physical": {
      const r = await prompt({ title: "Physical strain", content: field("Cost", `<select name="c"><option value="hp">Lose 1D6 HP</option><option value="str">Lose 1D4 STR (temporary)</option><option value="con">Lose 1D4 CON (temporary)</option><option value="dex">Lose 1D4 DEX (temporary)</option></select>`) });
      if (!r) return false;
      if (r.data.c === "hp") {
        const d = await evalFormula("1d6");
        await applyDamage(actor, d.total, { source: "Physical strain" });
        return `−${d.total} HP`;
      }
      const d = await evalFormula("1d4");
      await tempStatLoss(actor, r.data.c, d.total, { source: "Physical strain" });
      await postCard({ actor, title: "Physical strain", body: `<p>${r.data.c.toUpperCase()} −${d.total} (returns 1 per day).</p>`, rolls: [d] });
      return `${r.data.c.toUpperCase()} −${d.total}`;
    }
    case "emotional": {
      const r = await prompt({ title: "Emotional burnout", content: field("Cost", `<select name="c"><option value="wp">Lose 1D6 WP</option><option value="int">Lose 1D4 INT (temporary)</option><option value="pow">Lose 1D4 POW (temporary)</option><option value="cha">Lose 1D4 CHA (temporary)</option></select>`) });
      if (!r) return false;
      if (r.data.c === "wp") {
        const d = await evalFormula("1d6");
        await update(actor, { "system.wp.value": Math.max(0, actor.system.wp.value - d.total) });
        await postCard({ actor, title: "Emotional burnout", body: `<p>−${d.total} WP.</p>`, rolls: [d] });
        return `−${d.total} WP`;
      }
      const d = await evalFormula("1d4");
      await tempStatLoss(actor, r.data.c, d.total, { source: "Emotional burnout" });
      await postCard({ actor, title: "Emotional burnout", body: `<p>${r.data.c.toUpperCase()} −${d.total} (returns 1 per day).</p>`, rolls: [d] });
      return `${r.data.c.toUpperCase()} −${d.total}`;
    }
    case "alienation":
      await postCard({ actor, title: "Alienation", body: `<p>${esc(actor.name)} offends an important NPC: every CHA or Persuade test with them automatically fails until the end of the operation.</p>` });
      return "Alienation";
    case "exhaustion": {
      const d = await evalFormula("1d6");
      await update(actor, { "system.physical.exhausted": true, "system.wp.value": Math.max(0, actor.system.wp.value - d.total) });
      await postCard({ actor, title: "Exhaustion", body: `<p>${esc(actor.name)} is exhausted (−${d.total} WP).</p>`, rolls: [d] });
      return "Exhausted";
    }
    case "distraction":
      await setStatus(actor, STATUS.distracted, true);
      return "Distracted: −20% next test";
    case "confusion":
      await postCard({ actor, title: "Confusion", body: `<p>A major error: the Handler feeds ${esc(actor.name)} false information.</p>`, whisper: gmWhisper() });
      return "Confused";
    case "misfire": {
      const d = await evalFormula("1d4");
      await postCard({ actor, title: "Misfire", body: `<p>The gun jams: ${d.total} turn(s) to clear it.</p>`, rolls: [d] });
      return `Jammed ${d.total}`;
    }
    case "drop":
      await postCard({ actor, title: "Dropped", body: `<p>${esc(actor.name)} drops the weapon: a turn to pick it up.</p>` });
      return "Dropped";
    case "friendly":
      await postCard({ actor, title: "Friendly fire", body: `<p>${esc(actor.name)} hits a friend, a bystander, or themselves. Target them and roll damage.</p>` });
      return "Friendly fire";
    case "fall": {
      const { setStatus } = await import("../core/ops.mjs");
      await setStatus(actor, STATUS.prone, true);
      return "Prone";
    }
    default:
      return false;
  }
});

/** Distracted lasts for one test: clear it once that test is rolled. */
export async function consumeDistraction(roll) {
  const actor = roll.actor;
  if (!actor || !hasStatus(actor, STATUS.distracted)) return;
  if (!["stat", "skill", "sanity", "weapon", "special-training"].includes(roll.type)) return;
  await setStatus(actor, STATUS.distracted, false);
}

export { isAgent, list };
