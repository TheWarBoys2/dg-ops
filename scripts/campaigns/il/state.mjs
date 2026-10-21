/**
 * Impossible Landscapes: Corruption and the other per-Agent numbers, all kept in actor flags
 * (flags.dg-ops.il.*) so switching the campaign setting off and on loses nothing.
 *
 *  corruption        0–10, hidden from players (pp.17–18)
 *  started           starting Corruption has been confirmed
 *  session           { n, gained, lost }: movement in the current game session
 *  beacon            Corruption 10
 *  repeater          reached 0 SAN at Corruption 10
 *  corruptionFloor   opened their Soul Bottle and lived: never below 5
 *  bottleDestroyed   their unopened bottle was destroyed: every failed SAN roll takes the maximum
 *  vanished          opened their bottle and hit 0 SAN
 *  yellowSign        { failed, shared }
 *  gift, insight     band index 0–9; giftsRevealed
 *  metalPorcelain    (NPCs) odd damage rolls inflict only 1
 *  log               last few changes, for the Handler
 */
import { MODULE_ID } from "../../core/constants.mjs";
import { update } from "../../core/ops.mjs";
import { postCard, gmWhisper } from "../../core/chat.mjs";
import { gm, registerHandler } from "../../core/socket.mjs";
import { esc } from "../../core/ui.mjs";
import { applyCorruption, clampCorruption, sessionCap, BEACON, BOTTLE_FLOOR, OPERATIONS } from "./rules.mjs";

export const FLAG = "il";

export function il(actor) {
  return actor?.flags?.[MODULE_ID]?.[FLAG] ?? {};
}

export const corruptionOf = (actor) => Number(il(actor).corruption) || 0;
export const floorOf = (actor) => (il(actor).corruptionFloor ? BOTTLE_FLOOR : 0);

export function operation() {
  try {
    return game.settings.get(MODULE_ID, "ilOperation");
  } catch {
    return "night-floors";
  }
}

export function currentSession() {
  try {
    return Number(game.settings.get(MODULE_ID, "ilSession")) || 1;
  } catch {
    return 1;
  }
}

export const cap = () => sessionCap(operation());
export const operationLabel = () => OPERATIONS[operation()]?.label ?? "";

/** This session's movement for an Agent (zero if the stored figures are from an earlier session). */
export function sessionOf(actor) {
  const s = il(actor).session;
  if (!s || s.n !== currentSession()) return { n: currentSession(), gained: 0, lost: 0 };
  return { n: s.n, gained: Number(s.gained) || 0, lost: Number(s.lost) || 0 };
}

/** Write IL flags. Only changed keys are sent. */
export async function setIl(actor, patch) {
  const data = {};
  for (const [k, v] of Object.entries(patch)) data[`flags.${MODULE_ID}.${FLAG}.${k}`] = v;
  return update(actor, data);
}

function logEntry(actor, entry) {
  const log = foundry.utils.deepClone(il(actor).log ?? []);
  log.push({ t: game.time.worldTime, d: Date.now(), ...entry });
  return log.slice(-30);
}

/**
 * Change an Agent's Corruption.
 * @param {Actor} actor
 * @param {number} delta
 * @param {object} [o]
 * @param {string} [o.reason]
 * @param {boolean} [o.rule]        A rule sets it (tome, Yellow Sign, threshold, bottle): not capped, but counted.
 * @param {boolean} [o.correction]  The Handler fixing a number: not capped, not counted.
 * @param {boolean} [o.quiet]       No chat card (the Console shows the number).
 * @returns {Promise<{value:number, applied:number, capped:boolean}|null>}
 */
export async function adjustCorruption(actor, delta, o = {}) {
  if (!actor) return null;
  // Corruption is the Handler's secret: changes are made (and announced) on the Handler's client.
  if (!game.user.isGM) return gm("ilAdjust", actor.uuid, delta, o);
  const before = corruptionOf(actor);
  const floor = floorOf(actor);
  let res;
  if (o.correction) {
    const value = clampCorruption(before + (Number(delta) || 0), floor);
    res = { value, applied: value - before, capped: false, floored: false, session: sessionOf(actor) };
  } else {
    res = applyCorruption({ value: before, delta, session: sessionOf(actor), cap: cap(), floor, ignoreCap: !!o.rule });
  }
  const patch = {
    corruption: res.value,
    session: { n: currentSession(), gained: res.session.gained, lost: res.session.lost },
    beacon: res.value >= BEACON,
    log: logEntry(actor, { delta: res.applied, reason: o.reason ?? "", value: res.value }),
  };
  await setIl(actor, patch);
  const notes = [];
  if (res.capped && !o.rule) notes.push(`Session cap reached (${cap()} for ${operationLabel()}): only ${res.applied >= 0 ? "+" : ""}${res.applied} applied.`);
  if (res.capped && o.rule) notes.push(`That takes ${actor.name} past this session's cap of ${cap()}; the rule applies anyway.`);
  if (res.applied === 0 && !res.capped && delta < 0 && floor) notes.push(`Corruption can't drop below ${floor} after opening their Soul Bottle (p.344).`);
  for (const n of notes) ui.notifications.warn(`${n}`);
  if (before < BEACON && res.value >= BEACON) {
    await postCard({ actor, title: "Beacon", body: `<p><b>${esc(actor.name)}</b> reaches Corruption 10 and, without knowing it, shines like a beacon to the King's forces (p.18). Reaching 0 SAN now makes them a Repeater.</p>`, whisper: gmWhisper(), kind: "alert" });
  }
  if (!o.quiet && (res.applied || notes.length)) {
    const sign = res.applied > 0 ? `+${res.applied}` : `${res.applied}`;
    await postCard({
      actor,
      title: `Corruption ${sign}`,
      subtitle: "Handler only",
      body: `<p>${esc(actor.name)}: ${before} → <b>${res.value}</b>${o.reason ? ` (${esc(o.reason)})` : ""}.</p>${notes.map((n) => `<p class="dgops-quiet">${esc(n)}</p>`).join("")}`,
      whisper: gmWhisper(),
    });
  }
  return { value: res.value, applied: res.applied, capped: res.capped };
}

/** Set Corruption outright (starting values). Doesn't count toward the session. */
export async function setCorruption(actor, value, { reason = "Starting Corruption" } = {}) {
  const v = clampCorruption(value, floorOf(actor));
  await setIl(actor, { corruption: v, started: true, beacon: v >= BEACON, log: logEntry(actor, { delta: v - corruptionOf(actor), reason, value: v }) });
  return v;
}

export function registerStateHandlers() {
  registerHandler("ilAdjust", async (uuid, delta, o) => {
    const actor = await fromUuid(uuid);
    const r = await adjustCorruption(actor, delta, o ?? {});
    return r ? { value: r.value, applied: r.applied, capped: r.capped } : null;
  });
  registerHandler("ilGmCard", async (uuid, spec) => {
    const actor = uuid ? await fromUuid(uuid) : null;
    await gmCard(actor, spec);
    return true;
  });
  registerHandler("ilSetFlags", async (uuid, patch) => {
    const actor = await fromUuid(uuid);
    await setIl(actor, patch);
    return true;
  });
}

/** A Handler-only card. Posted from the Handler's client, so a player who set it off never sees it. */
export async function gmCard(actor, { title, body, kind = "info", rolls = [] }) {
  if (!game.user.isGM) return gm("ilGmCard", actor?.uuid ?? null, { title, body, kind });
  return postCard({ actor, title, subtitle: "Handler only", body, kind, rolls, whisper: gmWhisper() });
}

/** Flag writes that a player's client may need to make without seeing the result. */
export async function setIlQuietly(actor, patch) {
  if (game.user.isGM || actor?.isOwner) return setIl(actor, patch);
  return gm("ilSetFlags", actor.uuid, patch);
}
