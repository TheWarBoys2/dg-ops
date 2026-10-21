/**
 * The active team: which Agents the players are actually running.
 *
 * By default it's worked out from ownership: every Agent a (non-Handler) user owns. The Handler can
 * confirm that in Ops settings → Team, or switch to a folder, or pick the Agents by hand. Template
 * and pregenerated Agents nobody owns are left out automatically.
 *
 * Stored in the world setting "activeTeam": { mode: "auto" | "folder" | "pick", folder, ids }.
 */
import { MODULE_ID } from "./constants.mjs";

export const TEAM_DEFAULT = { mode: "auto", folder: "", ids: [] };

export function teamConfig() {
  try {
    return { ...TEAM_DEFAULT, ...(game.settings.get(MODULE_ID, "activeTeam") ?? {}) };
  } catch {
    return { ...TEAM_DEFAULT };
  }
}

/** Non-Handler users who own this actor. */
export function playerOwners(actor) {
  return game.users.filter((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER"));
}

/** Agents some player owns: the automatic guess. */
export function ownedAgents() {
  return game.actors.filter((a) => a.type === "agent" && playerOwners(a).length > 0);
}

function inFolder(actor, folderId) {
  let f = actor.folder;
  while (f) {
    if (f.id === folderId) return true;
    f = f.folder;
  }
  return false;
}

/** The Agents the module treats as the players' team. */
export function activeAgents() {
  const c = teamConfig();
  if (c.mode === "pick" && c.ids?.length) return c.ids.map((id) => game.actors.get(id)).filter((a) => a?.type === "agent");
  if (c.mode === "folder" && c.folder) return game.actors.filter((a) => a.type === "agent" && inFolder(a, c.folder));
  return ownedAgents();
}

export function isActiveAgent(actor) {
  if (actor?.type !== "agent") return false;
  const base = actor.isToken ? game.actors.get(actor.id) ?? actor : actor;
  return activeAgents().some((a) => a.id === base.id);
}

/** Active Agents with a token on the current scene, else all active Agents. */
export function teamOnScene() {
  const all = activeAgents();
  const ids = new Set(all.map((a) => a.id));
  const onScene = canvas?.scene?.tokens?.filter((t) => t.actor && ids.has(t.actor.id ?? t.actorId)).map((t) => t.actor) ?? [];
  const pool = onScene.length ? onScene : all;
  return [...new Map(pool.map((a) => [a.uuid, a])).values()];
}
