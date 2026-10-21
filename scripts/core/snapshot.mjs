/**
 * Snapshots for Undo: everything a damage or SAN card can change on an actor.
 */
import { MODULE_ID, STATUS } from "./constants.mjs";
import { update, updateEmbedded, setStatus } from "./ops.mjs";
import { registerAction } from "./chat.mjs";

const FLAG_KEYS = ["pendingDisorders", "sanLog", "injuries", "deathTime", "sleepTest", "fightIncidents", "fleeTurns", "pinnedBy", "aim"];
const STATUSES = [...Object.values(STATUS)];

export function snapshot(actor) {
  const s = actor.system ?? {};
  const adapt = s.sanity?.adaptations
    ? Object.fromEntries(["violence", "helplessness"].map((k) => [k, { incident1: !!s.sanity.adaptations[k]?.incident1, incident2: !!s.sanity.adaptations[k]?.incident2, incident3: !!s.sanity.adaptations[k]?.incident3 }]))
    : null;
  const flags = actor.flags?.[MODULE_ID] ?? {};
  return {
    hp: s.health?.value ?? null,
    wp: s.wp?.value ?? null,
    san: s.sanity?.value ?? null,
    bp: s.sanity?.currentBreakingPoint ?? null,
    adapt,
    stats: s.statistics ? Object.fromEntries(Object.entries(s.statistics).map(([k, v]) => [k, v.value])) : null,
    firstAid: s.physical?.firstAidAttempted ?? null,
    bonds: (actor.itemTypes?.bond ?? []).map((b) => ({ id: b.id, score: b.system.score, damaged: !!b.system.hasBeenDamagedSinceLastHomeScene, broken: !!b.getFlag?.(MODULE_ID, "broken") })),
    acute: (actor.itemTypes?.motivation ?? []).map((m) => ({ id: m.id, acute: !!m.system.acuteEpisode })),
    statuses: STATUSES.filter((id) => actor.statuses?.has?.(id)),
    flags: Object.fromEntries(FLAG_KEYS.map((k) => [k, flags[k] === undefined ? null : foundry.utils.deepClone(flags[k])])),
  };
}

export async function restore(actor, snap) {
  const data = {};
  // Stats first: the system shifts Bonds when CHA changes; Bond scores are set explicitly below.
  if (snap.stats) for (const [k, v] of Object.entries(snap.stats)) if (actor.system.statistics[k].value !== v) data[`system.statistics.${k}.value`] = v;
  if (Object.keys(data).length) await update(actor, data, { dgOpsUndo: true });
  const d2 = {};
  if (snap.hp != null) d2["system.health.value"] = snap.hp;
  if (snap.wp != null) d2["system.wp.value"] = snap.wp;
  if (snap.san != null) d2["system.sanity.value"] = snap.san;
  if (snap.bp != null) d2["system.sanity.currentBreakingPoint"] = snap.bp;
  if (snap.adapt) for (const [k, v] of Object.entries(snap.adapt)) for (const [i, b] of Object.entries(v)) d2[`system.sanity.adaptations.${k}.${i}`] = b;
  if (snap.firstAid != null) d2["system.physical.firstAidAttempted"] = snap.firstAid;
  for (const [k, v] of Object.entries(snap.flags ?? {})) {
    if (v === null) d2[`flags.${MODULE_ID}.-=${k}`] = null;
    else d2[`flags.${MODULE_ID}.${k}`] = v;
  }
  await update(actor, d2, { dgOpsUndo: true });
  const bonds = (snap.bonds ?? []).filter((b) => actor.items.get(b.id)).map((b) => ({ _id: b.id, "system.score": b.score, "system.hasBeenDamagedSinceLastHomeScene": b.damaged, [`flags.${MODULE_ID}.broken`]: b.broken }));
  const acute = (snap.acute ?? []).filter((m) => actor.items.get(m.id)).map((m) => ({ _id: m.id, "system.acuteEpisode": m.acute }));
  await updateEmbedded(actor, "Item", [...bonds, ...acute]);
  for (const id of STATUSES) {
    const want = snap.statuses.includes(id);
    if (!!actor.statuses?.has?.(id) !== want) await setStatus(actor, id, want, id === STATUS.dead);
  }
}

registerAction("undo", async ({ message }) => {
  if (!game.user.isGM) return false;
  const u = message.getFlag(MODULE_ID, "undo");
  const actor = u?.actorUuid ? await fromUuid(u.actorUuid) : null;
  if (!actor) return false;
  await restore(actor, u.snap);
  ui.notifications.info(`${actor.name} restored to before this card.`);
  return "Undone";
});
