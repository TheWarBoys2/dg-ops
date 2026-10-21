/**
 * Request/response socket layer.
 *  - gm(op, ...args): run a privileged document operation on the active GM's client.
 *  - ask(userId, spec): show a prompt on another user's client and await their answer.
 * When the target is the current user the handler runs locally.
 */
import { SOCKET, warn } from "./constants.mjs";

const handlers = new Map();
const pending = new Map();

export function registerHandler(name, fn) {
  handlers.set(name, fn);
}

export function initSocket() {
  game.socket.on(SOCKET, async (msg) => {
    if (!msg || msg.to !== game.user.id) return;
    if (msg.kind === "request") {
      let result = null;
      let error = null;
      try {
        const fn = handlers.get(msg.handler);
        if (!fn) throw new Error(`Unknown handler ${msg.handler}`);
        result = await fn(...(msg.args ?? []), { from: msg.from });
      } catch (e) {
        error = e?.message ?? String(e);
        warn(e);
      }
      game.socket.emit(SOCKET, { kind: "response", id: msg.id, to: msg.from, from: game.user.id, result, error });
    } else if (msg.kind === "response") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    }
  });
}

/** Call a handler on a specific user's client. */
export function callUser(userId, handler, args = [], { timeout = 0 } = {}) {
  if (userId === game.user.id) {
    const fn = handlers.get(handler);
    if (!fn) return Promise.reject(new Error(`Unknown handler ${handler}`));
    return Promise.resolve(fn(...args, { from: game.user.id }));
  }
  const id = foundry.utils.randomID(16);
  return new Promise((resolve, reject) => {
    const timer = timeout ? setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeout * 1000) : null;
    pending.set(id, { resolve, reject, timer });
    game.socket.emit(SOCKET, { kind: "request", id, to: userId, from: game.user.id, handler, args });
  });
}

export function activeGM() {
  return game.users.activeGM ?? game.users.find((u) => u.isGM && u.active) ?? null;
}

/** Run a GM-privileged handler. */
export async function gm(handler, ...args) {
  const g = activeGM();
  if (!g) {
    ui.notifications.warn("Delta Green Ops: no Handler is connected to apply that change.");
    return null;
  }
  return callUser(g.id, handler, args);
}

/**
 * The best user to answer a prompt for an actor: an active non-GM owner
 * (preferring one whose assigned character it is), else the active GM.
 */
export function ownerUserFor(actor) {
  if (!actor) return activeGM();
  const owners = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  const assigned = owners.find((u) => u.character?.id === actor.id);
  return assigned ?? owners[0] ?? activeGM();
}
