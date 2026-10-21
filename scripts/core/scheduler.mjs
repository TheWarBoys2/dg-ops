/**
 * World-time scheduler. Runs on the active GM when game time advances.
 * Event: { id, type, due, actorUuid?, data?, label? }
 */
import { MODULE_ID, warn } from "./constants.mjs";
import { setWorld } from "./ops.mjs";
import { gm, registerHandler } from "./socket.mjs";

const types = new Map();
let running = false;

export function registerEventType(type, fn) {
  types.set(type, fn);
}

export function events() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "schedule") ?? []);
}

registerHandler("gmSchedule", async (evt) => {
  const list = events();
  list.push(evt);
  await game.settings.set(MODULE_ID, "schedule", list);
  return evt.id;
});

registerHandler("gmCancel", async (filter) => {
  const list = events().filter((e) => !(e.id === filter.id || (filter.type && e.type === filter.type && (!filter.actorUuid || e.actorUuid === filter.actorUuid))));
  await game.settings.set(MODULE_ID, "schedule", list);
  return true;
});

export async function schedule({ type, delay, due, actorUuid = null, data = {}, label = "" }) {
  const evt = { id: foundry.utils.randomID(), type, due: due ?? game.time.worldTime + Math.max(0, Number(delay) || 0), actorUuid, data, label };
  if (game.user.isGM) {
    const list = events();
    list.push(evt);
    await game.settings.set(MODULE_ID, "schedule", list);
    return evt.id;
  }
  return gm("gmSchedule", evt);
}

export async function cancel(filter) {
  if (game.user.isGM) {
    const list = events().filter((e) => !(e.id === filter.id || (filter.type && e.type === filter.type && (!filter.actorUuid || e.actorUuid === filter.actorUuid))));
    return game.settings.set(MODULE_ID, "schedule", list);
  }
  return gm("gmCancel", filter);
}

export async function processDue(worldTime = game.time.worldTime) {
  if (!game.user.isActiveGM || running) return;
  running = true;
  try {
    let guard = 0;
    while (guard++ < 600) {
      const list = events().sort((a, b) => a.due - b.due);
      const next = list.find((e) => e.due <= worldTime);
      if (!next) break;
      const rest = list.filter((e) => e.id !== next.id);
      await setWorld("schedule", rest);
      const fn = types.get(next.type);
      if (!fn) continue;
      try {
        const actor = next.actorUuid ? await fromUuid(next.actorUuid) : null;
        const res = await fn(next, actor);
        if (res?.reschedule) {
          const again = events();
          again.push({ ...next, id: foundry.utils.randomID(), due: res.reschedule, data: res.data ?? next.data });
          await setWorld("schedule", again);
        }
      } catch (e) {
        warn(`scheduled event ${next.type} failed`, e);
      }
    }
  } finally {
    running = false;
  }
}

export function formatDue(due) {
  const delta = due - game.time.worldTime;
  const abs = Math.abs(delta);
  const fmt = abs >= 86400 ? `${(abs / 86400).toFixed(1)} d` : abs >= 3600 ? `${(abs / 3600).toFixed(1)} h` : abs >= 60 ? `${Math.round(abs / 60)} min` : `${abs} s`;
  return delta >= 0 ? `in ${fmt}` : `${fmt} overdue`;
}
