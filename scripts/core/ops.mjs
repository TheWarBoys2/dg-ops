/**
 * Permission-aware document operations. Owners act directly; everyone else goes through the GM.
 */
import { MODULE_ID } from "./constants.mjs";
import { gm, registerHandler } from "./socket.mjs";

const resolve = (uuid) => fromUuid(uuid);

registerHandler("gmUpdate", async (uuid, data, options = {}) => {
  const doc = await resolve(uuid);
  if (!doc) throw new Error(`No document ${uuid}`);
  await doc.update(data, options);
  return true;
});

registerHandler("gmCreateEmbedded", async (parentUuid, docName, data) => {
  const parent = await resolve(parentUuid);
  const docs = await parent.createEmbeddedDocuments(docName, data);
  return docs.map((d) => d.id);
});

registerHandler("gmUpdateEmbedded", async (parentUuid, docName, updates) => {
  const parent = await resolve(parentUuid);
  await parent.updateEmbeddedDocuments(docName, updates);
  return true;
});

registerHandler("gmDeleteEmbedded", async (parentUuid, docName, ids) => {
  const parent = await resolve(parentUuid);
  await parent.deleteEmbeddedDocuments(docName, ids);
  return true;
});

registerHandler("gmStatus", async (actorUuid, statusId, active, overlay = false) => {
  const actor = await resolve(actorUuid);
  await actor?.toggleStatusEffect?.(statusId, { active, overlay });
  return true;
});

registerHandler("gmSetting", async (key, value) => {
  await game.settings.set(MODULE_ID, key, value);
  return true;
});

registerHandler("gmOwnership", async (uuid, ownership) => {
  const doc = await resolve(uuid);
  await doc.update({ ownership });
  return true;
});

export function canUpdate(doc) {
  return !!doc?.canUserModify?.(game.user, "update");
}

export async function update(doc, data, options = {}) {
  if (!doc) return;
  if (canUpdate(doc)) return doc.update(data, options);
  return gm("gmUpdate", doc.uuid, data, options);
}

export async function createEmbedded(parent, docName, data) {
  const arr = Array.isArray(data) ? data : [data];
  if (parent.isOwner) {
    const docs = await parent.createEmbeddedDocuments(docName, arr);
    return docs.map((d) => d.id);
  }
  return gm("gmCreateEmbedded", parent.uuid, docName, arr);
}

export async function updateEmbedded(parent, docName, updates) {
  if (!updates?.length) return;
  if (parent.isOwner) return parent.updateEmbeddedDocuments(docName, updates);
  return gm("gmUpdateEmbedded", parent.uuid, docName, updates);
}

export async function deleteEmbedded(parent, docName, ids) {
  if (!ids?.length) return;
  if (parent.isOwner) return parent.deleteEmbeddedDocuments(docName, ids);
  return gm("gmDeleteEmbedded", parent.uuid, docName, ids);
}

export function hasStatus(actor, id) {
  return !!actor?.statuses?.has?.(id);
}

export async function setStatus(actor, id, active = true, overlay = false) {
  if (!actor) return;
  if (hasStatus(actor, id) === active) return;
  if (actor.isOwner) return actor.toggleStatusEffect(id, { active, overlay });
  return gm("gmStatus", actor.uuid, id, active, overlay);
}

export async function setFlag(doc, key, value) {
  return update(doc, { [`flags.${MODULE_ID}.${key}`]: value });
}

export async function unsetFlag(doc, key) {
  return update(doc, { [`flags.${MODULE_ID}.-=${key}`]: null });
}

export async function setWorld(key, value) {
  if (game.user.isGM) return game.settings.set(MODULE_ID, key, value);
  return gm("gmSetting", key, value);
}

/** Create a module Active Effect (DG system AE format: top-level changes with type/phase). */
export async function createEffect(actor, { name, img = "icons/svg/aura.svg", changes = [], flags = {}, statuses = [], disabled = false, description = "" }) {
  return createEmbedded(actor, "ActiveEffect", [
    { name, img, transfer: false, disabled, changes, statuses, description, flags: { [MODULE_ID]: flags } },
  ]);
}

export function effectsWithFlag(actor, flag) {
  return actor?.effects?.filter((e) => e.getFlag(MODULE_ID, flag) !== undefined) ?? [];
}
