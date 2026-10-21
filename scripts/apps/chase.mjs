/**
 * Pursuit (pp.45–46), run in chat.
 *
 * The Handler sets the chase up once (who, which skill, vehicle speed, help, how many wins). That
 * posts a Pursuit card. Each round, both sides choose on the card: roll the chase skill, seek an
 * edge with another skill, or attack instead. Players roll their own side; NPC sides roll
 * themselves (or wait for the Handler, per the "NPC rolls" setting). When both sides have rolled,
 * the exchange resolves, the meter moves, and the next round opens.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { esc, options } from "../core/ui.mjs";
import { postCard, outcomeBadge, registerAction } from "../core/chat.mjs";
import { gm, registerHandler } from "../core/socket.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, skillValue, activeTokenDoc } from "../core/system.mjs";
import { isPlayerActor, ownerNames, asRoller } from "../core/requests.mjs";
import { newChase, chaseExchange } from "../rules/chase.mjs";
import { VEHICLE_SPEED_MODS } from "../rules/hazards.mjs";
import { DGOpsApp, btn } from "./base.mjs";
import { activeAgents } from "../core/team.mjs";

const CHASE_SKILLS = { athletics: "Athletics (on foot)", drive: "Drive", pilot: "Pilot", heavy_machinery: "Heavy Machinery", swim: "Swim", ride: "Ride" };
const EDGE_SKILLS = { alertness: "Alertness", navigate: "Navigate", stealth: "Stealth", survival: "Survival" };
const SPEEDS = { fast: "Fast (+20%)", normal: "Normal", slow: "Slow (−20%)", junk: "Junk (−20% if thoroughly shoddy, p.93)", air: "Aircraft vs ground" };
const AID = { 0: "None", 20: "Coordination, air support, faster (+20%)", 40: "Overwhelming advantages (+40%)" };
const SIDES = ["pursuer", "quarry"];

function sceneActors() {
  const list = canvas.scene?.tokens.map((t) => t.actor).filter((a) => a && a.type !== "vehicle") ?? [];
  const extra = activeAgents();
  return [...new Map([...list, ...extra].map((a) => [a.uuid, a])).values()];
}

/** Skill key on this actor for a chase skill (Pilot, Ride and Heavy Machinery are typed or optional). */
function skillKeyFor(actor, key) {
  if (actor?.system?.skills?.[key]) return key;
  const typed = Object.entries(actor?.system?.typedSkills ?? {}).find(([, s]) => new RegExp(key.replace(/_/g, " "), "i").test(`${s.group} ${s.label}`));
  if (typed) return typed[0];
  return actor?.system?.skills?.drive ? "drive" : "athletics";
}

function skillName(actor, key) {
  const s = actor?.system?.skills?.[key] ?? actor?.system?.typedSkills?.[key];
  return s ? `${s.group ? `${s.group} ` : ""}${s.label ?? key}`.trim() : key.replace(/_/g, " ");
}

/* ------------------------------------------------------------------------ */
/*  Setup window                                                            */
/* ------------------------------------------------------------------------ */

export class ChaseSetup extends DGOpsApp {
  static BANNER = "Form DD-46";

  static DEFAULT_OPTIONS = {
    id: "dgops-chase",
    window: { title: "Start a pursuit", icon: "fas fa-person-running" },
    position: { width: 600 },
  };

  constructor(options = {}) {
    super(options);
    const sel = canvas.tokens?.controlled?.[0]?.actor;
    const tgt = [...(game.user.targets ?? [])][0]?.actor;
    this.s = { pursuer: sel?.uuid ?? "", quarry: tgt?.uuid ?? "", pSkill: "drive", qSkill: "drive", pSpeed: "normal", qSpeed: "normal", pAid: 0, qAid: 0, required: 2 };
  }

  async renderBody() {
    const actors = sceneActors();
    const s = this.s;
    const actorOpts = (cur) => `<option value="">—</option>${actors.map((a) => `<option value="${a.uuid}" ${a.uuid === cur ? "selected" : ""}>${esc(a.name)}</option>`).join("")}`;
    const side = (k, label, tip) => `
      <fieldset><legend>${label}</legend>
        <div class="form-group"><label>Who</label><select name="${k}">${actorOpts(s[k])}</select></div>
        <div class="form-group"><label>Skill</label><select name="${k[0]}Skill">${options(CHASE_SKILLS, s[`${k[0]}Skill`])}</select></div>
        <div class="form-group"><label>Speed</label><select name="${k[0]}Speed">${options(SPEEDS, s[`${k[0]}Speed`])}</select></div>
        <div class="form-group"><label>Help</label><select name="${k[0]}Aid">${options(AID, s[`${k[0]}Aid`])}</select></div>
        <p class="hint">${tip}</p>
      </fieldset>`;
    return `<form class="dgops-form">
      <div class="dgops-two">${side("pursuer", "Pursuer", "Trying to catch up.")}${side("quarry", "Quarry", "Trying to get away.")}</div>
      <div class="form-group"><label>Wins needed</label><select name="required">${options({ 1: "1 — a short dash", 2: "2 — a prolonged chase", 3: "3 — wide open country" }, s.required)}</select></div>
      <p class="hint">Posts a Pursuit card. Each round, both sides choose and roll on the card: their players roll their own; NPCs ${setting("npcRolls") === "auto" ? "roll themselves" : "wait for your click"}. One round is one combat turn.</p>
      <div class="dgops-buttons">${btn("start", "Start the pursuit", {}, "primary")}</div>
    </form>`;
  }

  async on_start() {
    const d = this.formData();
    const p = d.pursuer ? await fromUuid(d.pursuer) : null;
    const q = d.quarry ? await fromUuid(d.quarry) : null;
    if (!p || !q) return ui.notifications.warn("Pick the pursuer and the quarry.");
    if (p === q) return ui.notifications.warn("Pick two different sides.");
    this.close();
    await startChase({
      pursuer: { actor: p, skill: d.pSkill, speed: d.pSpeed, aid: Number(d.pAid) || 0 },
      quarry: { actor: q, skill: d.qSkill, speed: d.qSpeed, aid: Number(d.qAid) || 0 },
      required: Number(d.required) || 2,
    });
  }
}

export function openChase() {
  const existing = foundry.applications.instances.get("dgops-chase");
  if (existing) return existing.render({ force: true });
  return new ChaseSetup().render({ force: true });
}

/* ------------------------------------------------------------------------ */
/*  The card                                                                */
/* ------------------------------------------------------------------------ */

export async function startChase({ pursuer, quarry, required = 2 }) {
  const sides = {};
  for (const [k, v] of [
    ["pursuer", pursuer],
    ["quarry", quarry],
  ]) {
    const token = activeTokenDoc(v.actor);
    sides[k] = { actorUuid: v.actor.uuid, name: token?.name ?? v.actor.name, img: token?.texture?.src ?? v.actor.img, skill: skillKeyFor(v.actor, v.skill), speed: v.speed, aid: v.aid, player: isPlayerActor(v.actor) };
  }
  const state = newChase({ required });
  // An aircraft automatically outruns anything on the ground (p.46).
  const pAir = pursuer.speed === "air";
  const qAir = quarry.speed === "air";
  if (pAir !== qAir) {
    state.over = true;
    state.winner = pAir ? "pursuer" : "quarry";
    state.log.push({ round: 0, winner: state.winner, wins: 0, note: "An aircraft automatically outruns the ground" });
  }
  const message = await postCard({
    title: "Pursuit",
    subtitle: `${esc(sides.pursuer.name)} chasing ${esc(sides.quarry.name)}`,
    kind: "combat",
    body: `<div class="dgops-chase"></div>`,
    flags: { [MODULE_ID]: { chase: { state, sides, pending: { pursuer: null, quarry: null } } } },
  });
  await autoNpcSides(message);
  return message;
}

function sideTarget(actor, side, act) {
  const base = skillValue(actor, act.key);
  return Math.max(1, Math.min(99, base + act.mod));
}

/** What a side's roll would be, from its choice on the card. */
function actionFor(chase, sideKey, actor, choice) {
  const side = chase.sides[sideKey];
  const edge = chase.state.edge?.[sideKey] || 0;
  if (choice === "attack") return { kind: "attack" };
  if (choice?.startsWith("edge:")) return { kind: "edge", key: choice.slice(5), mod: edge };
  return { kind: "chase", key: side.skill, mod: (VEHICLE_SPEED_MODS[side.speed] ?? 0) + (Number(side.aid) || 0) + edge };
}

/** Render-time: meter, log and one row per side. */
export function renderChase(message, element) {
  const chase = message.getFlag(MODULE_ID, "chase");
  const host = element.querySelector(".dgops-chase");
  if (!chase || !host) return;
  const { state, sides, pending } = chase;
  const req = state.required;
  const meter = `<div class="dgops-meter" data-tooltip="Q = quarry escapes · P = pursuer catches up">${Array.from({ length: req * 2 + 1 }, (_, i) => {
    const pos = i - req;
    return `<span class="${pos === state.lead ? "on" : ""} ${pos === 0 ? "mid" : ""}">${pos === -req ? "Q" : pos === req ? "P" : ""}</span>`;
  }).join("")}</div>`;
  const status = state.over
    ? `<b>${state.winner === "pursuer" ? `${esc(sides.pursuer.name)} catches ${esc(sides.quarry.name)}.` : `${esc(sides.quarry.name)} gets away.`}</b>`
    : state.lead > 0
      ? `${esc(sides.pursuer.name)} is gaining (${state.lead}/${req}).`
      : state.lead < 0
        ? `${esc(sides.quarry.name)} is pulling away (${-state.lead}/${req}).`
        : "Neck and neck.";
  const rows = SIDES.map((k) => {
    const side = sides[k];
    const actor = fromUuidSync(side.actorUuid, { strict: false });
    const mine = game.user.isGM || actor?.isOwner;
    const p = pending?.[k];
    let right;
    if (state.over) right = "";
    else if (p) right = `<span class="dgops-quiet">${p.kind === "attack" ? "Attacks instead" : `${p.kind === "edge" ? "Seeking an edge: " : ""}${game.user.isGM || mine ? `${p.total} ` : ""}`}</span>${p.kind === "attack" ? "" : `<span class="dgops-badge ${p.success ? "success" : "fail"}">${p.critical ? "Critical" : p.fumble ? "Fumble" : p.success ? "Success" : "Failure"}</span>`}`;
    else if (mine) {
      const chaseAct = actionFor(chase, k, actor, "chase");
      const opts = [`<option value="chase">${esc(skillName(actor, chaseAct.key))} (${sideTarget(actor, k, chaseAct)}%)</option>`]
        .concat(Object.entries(EDGE_SKILLS).map(([key, l]) => `<option value="edge:${key}">Seek an edge: ${esc(l)} (${skillValue(actor, key)}%)</option>`))
        .concat(`<option value="attack">Attack instead (the other side wins this round)</option>`)
        .join("");
      right = `<select name="act">${opts}</select><button type="button" class="dgops-btn primary" data-dgops="chaseRoll" data-args='${esc(JSON.stringify({ side: k }))}'><i class="fas fa-dice-d20"></i> Roll</button>`;
    } else right = `<span class="dgops-quiet">Waiting for ${esc(side.player ? ownerNames(actor) : "the Handler")}…</span>`;
    const edge = state.edge?.[k] ? `<small>Edge: +${state.edge[k]}%</small>` : "";
    const wide = right.includes("<select") ? " wide" : "";
    return `<div class="dgops-trow"><img src="${esc(side.img)}" alt=""><span class="dgops-trow__name">${esc(side.name)}<small>${k === "pursuer" ? "Pursuer" : "Quarry"}</small>${edge}</span><span class="dgops-trow__act${wide}">${right}</span></div>`;
  }).join("");
  const log = state.log
    .slice(-6)
    .map((l) => `<li>${l.round ? `Round ${l.round}: ` : ""}${l.winner ? `${esc(sides[l.winner].name)} ${l.note ? esc(l.note.replace(/^(pursuer|quarry)\s*/, "")) : `+${l.wins}`}` : "no ground gained"}</li>`)
    .join("");
  const gmBtns = game.user.isGM && !state.over ? `<div class="dgops-buttons">${`<button type="button" class="dgops-btn subtle" data-dgops="chaseEnd" data-tooltip="Handler: end the pursuit here.">End</button>`}</div>` : "";
  host.innerHTML = `${meter}<p class="dgops-chase__status">${status}</p>${rows}${log ? `<ul class="dgops-chase__log">${log}</ul>` : ""}${gmBtns}`;
}

registerAction("chaseRoll", async ({ message, args, button }) => {
  const chase = message.getFlag(MODULE_ID, "chase");
  if (!chase || chase.state.over || chase.pending?.[args.side]) return false;
  const actor = await fromUuid(chase.sides[args.side].actorUuid);
  if (!game.user.isGM && !actor?.isOwner) return false;
  const choice = button.closest(".dgops-trow")?.querySelector("select[name=act]")?.value ?? "chase";
  await rollSide(message, args.side, actor, choice);
  return false;
});

async function rollSide(message, sideKey, actor, choice) {
  const chase = message.getFlag(MODULE_ID, "chase");
  const act = actionFor(chase, sideKey, actor, choice);
  if (!(await gm("gmChaseClaim", message.id, sideKey))) return;
  let result;
  try {
    if (act.kind === "attack") result = { kind: "attack", success: false, critical: false, fumble: false, total: 100 };
    else {
      // Whoever clicks this side's Roll button rolls it (its player, or the Handler standing in).
      const { outcome } = await asRoller(actor, () => systemTest(actor, { type: "skill", key: act.key, modifier: act.mod, context: { chase: true } }));
      result = { kind: act.kind, ...outcome };
    }
  } catch (e) {
    await gm("gmChaseSubmit", message.id, sideKey, null);
    throw e;
  }
  await gm("gmChaseSubmit", message.id, sideKey, result);
}

registerAction("chaseEnd", async ({ message }) => {
  if (!game.user.isGM) return false;
  await message.update({ [`flags.${MODULE_ID}.chase.state.over`]: true, [`flags.${MODULE_ID}.chase.state.winner`]: null });
  return false;
});

/* ---- Handler side: claims, submissions, resolution ---- */

const locks = new Map();
function locked(id, fn) {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    id,
    next.catch(() => {}),
  );
  return next;
}

registerHandler("gmChaseClaim", (messageId, sideKey) =>
  locked(messageId, async () => {
    const message = game.messages.get(messageId);
    const chase = message?.getFlag(MODULE_ID, "chase");
    if (!chase || chase.state.over || chase.pending?.[sideKey]) return false;
    await message.update({ [`flags.${MODULE_ID}.chase.pending.${sideKey}`]: { rolling: true } });
    return true;
  }),
);

registerHandler("gmChaseSubmit", (messageId, sideKey, result) =>
  locked(messageId, async () => {
    if (result) result = { ...result, rolling: false };
    const message = game.messages.get(messageId);
    const chase = message?.getFlag(MODULE_ID, "chase");
    if (!chase) return false;
    const pending = { ...chase.pending, [sideKey]: result };
    const both = SIDES.every((k) => pending[k] && !pending[k].rolling);
    if (!both) {
      await message.update({ [`flags.${MODULE_ID}.chase.pending.${sideKey}`]: result });
      return true;
    }
    const p = pending.pursuer;
    const q = pending.quarry;
    const state = chaseExchange(chase.state, {
      pursuer: p,
      quarry: q,
      seekingEdge: { pursuer: p.kind === "edge", quarry: q.kind === "edge" },
      attacked: { pursuer: p.kind === "attack", quarry: q.kind === "attack" },
    });
    await message.update({ [`flags.${MODULE_ID}.chase.state`]: state, [`flags.${MODULE_ID}.chase.pending`]: { pursuer: null, quarry: null } });
    const last = state.log.at(-1);
    const line = (k, o) => `${esc(chase.sides[k].name)}: ${o.kind === "attack" ? "attacks instead" : `${o.kind === "edge" ? "seeks an edge, " : ""}${o.total} ${outcomeBadge(o)}`}`;
    await postCard({
      title: `Pursuit: round ${state.round}`,
      kind: "combat",
      body: `<p>${line("pursuer", p)}<br>${line("quarry", q)}</p><p>${last.winner ? `${esc(chase.sides[last.winner].name)} ${last.note ? esc(last.note.replace(/^(pursuer|quarry)\s*/, "")) : `gains ${last.wins} win${last.wins > 1 ? "s" : ""}`}` : "No ground gained."}${state.over ? ` — <b>${state.winner === "pursuer" ? `${esc(chase.sides.pursuer.name)} catches ${esc(chase.sides.quarry.name)}` : `${esc(chase.sides.quarry.name)} escapes`}</b>` : ""}</p>`,
    });
    if (!state.over) setTimeout(() => autoNpcSides(game.messages.get(messageId)), 0);
    return true;
  }),
);

/** NPC sides roll their chase skill by themselves when NPC rolls are automatic. */
async function autoNpcSides(message) {
  if (!message || !game.user.isActiveGM || setting("npcRolls") !== "auto") return;
  const chase = message.getFlag(MODULE_ID, "chase");
  if (!chase || chase.state.over) return;
  // Two NPCs chasing each other: the Handler clicks, so it doesn't play itself out unseen.
  if (!SIDES.some((k) => chase.sides[k].player)) return;
  for (const k of SIDES) {
    if (chase.sides[k].player || chase.pending?.[k]) continue;
    const actor = await fromUuid(chase.sides[k].actorUuid);
    if (actor) await rollSide(game.messages.get(message.id), k, actor, "chase");
  }
}

export { MODULE_ID };
