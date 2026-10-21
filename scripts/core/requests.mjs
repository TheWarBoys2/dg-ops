/**
 * Roll requests. When the automation needs dice from someone other than the person who clicked,
 * it doesn't roll for them: it posts a chat card with a button. The actor's owner clicks it
 * (the Handler can too, for absent players) and the follow-up runs on that person's client.
 *
 *  - requestAction(): a card with one or more buttons; each runs a named continuation.
 *  - requestTest():   a card with a single "Roll X" button.
 *  - testFor():       roll here if this user may roll for the actor, otherwise request and wait.
 *  - group cards:     one card, one row per actor (SAN tests, opposed tests, team tests).
 *
 * Who rolls:
 *  - an Agent (player-owned): its player. Requests go to chat unless the player is the one acting.
 *  - an NPC: rolled automatically, or a Roll button for the Handler (setting "npcRolls").
 *
 * State lives in chat-message flags, so a card survives reloads. Flag updates go through the
 * Handler's client (players can't edit other people's messages), serialised per message.
 */
import { MODULE_ID, warn } from "./constants.mjs";
import { setting } from "./settings.mjs";
import { gm, registerHandler, activeGM } from "./socket.mjs";
import { systemTest, statValue, skillValue } from "./system.mjs";
import { postCard, registerAction, outcomeBadge, gmWhisper } from "./chat.mjs";
import { esc, readForm } from "./ui.mjs";

/* ------------------------------------------------------------------------ */
/*  Continuations                                                           */
/* ------------------------------------------------------------------------ */

const continuations = new Map();

export function registerContinuation(name, fn) {
  continuations.set(name, fn);
}

export async function runContinuation(name, args = {}, ctx = {}) {
  const fn = continuations.get(name);
  if (!fn) throw new Error(`Delta Green Ops: unknown follow-up "${name}"`);
  return fn(args, ctx);
}

/* ------------------------------------------------------------------------ */
/*  Who may roll                                                            */
/* ------------------------------------------------------------------------ */

/** Actors this client is currently rolling for because someone clicked their request card. */
const authorised = new Map();

export async function asRoller(actor, fn) {
  const key = actor?.uuid;
  if (!key) return fn();
  authorised.set(key, (authorised.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (authorised.get(key) ?? 1) - 1;
    if (n <= 0) authorised.delete(key);
    else authorised.set(key, n);
  }
}

export function isAuthorised(actor) {
  return !!actor?.uuid && authorised.has(actor.uuid);
}

export function isPlayerActor(actor) {
  return !!actor?.hasPlayerOwner;
}

/**
 * True when a roll for this Agent should come from its player: someone else set it off, the
 * "Players roll their own dice" setting is on, and the player is connected.
 */
export function playerMustRoll(actor) {
  if (!isPlayerActor(actor) || authorised.has(actor.uuid)) return false;
  if (!setting("playersRoll")) return false;
  if (!game.user.isGM && actor.isOwner) return false;
  return game.users.some((u) => u.active && !u.isGM && u.id !== game.user.id && actor.testUserPermission(u, "OWNER"));
}

/** True if dice for this actor can be rolled right here, without asking anyone. */
export function rollsHere(actor) {
  if (!actor) return true;
  if (authorised.has(actor.uuid)) return true;
  if (!isPlayerActor(actor)) return setting("npcRolls") === "auto";
  return !playerMustRoll(actor);
}

export function ownerNames(actor) {
  if (!isPlayerActor(actor)) return "the Handler";
  const names = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.name);
  return names.join(" or ") || "its owner";
}

function whisperFor(actor, visibility) {
  if (visibility === "gm") return gmWhisper();
  if (visibility === "owners") {
    const ids = new Set(gmWhisper());
    for (const u of game.users) if (actor?.testUserPermission?.(u, "OWNER")) ids.add(u.id);
    return [...ids];
  }
  return null;
}

/** Human label for a test: "Dodge (45%)", "CON×5 (60%)". SAN shows no number (it may be private). */
export function specLabel(actor, spec) {
  const mod = Number(spec.modifier) || 0;
  const m = mod ? ` ${mod > 0 ? "+" : "−"}${Math.abs(mod)}` : "";
  if (spec.type === "stat") return `${spec.key.toUpperCase()}×5 (${statValue(actor, spec.key) * 5}%${m})`;
  if (spec.type === "sanity") return `SAN${m}`;
  if (spec.type === "luck") return `Luck (50%${m})`;
  const s = actor?.system?.skills?.[spec.key] ?? actor?.system?.typedSkills?.[spec.key];
  const name = spec.label ?? s?.label ?? String(spec.key).replace(/_/g, " ");
  const item = spec.itemId ? actor?.items?.get(spec.itemId) : null;
  return `${item ? `${item.name}: ` : ""}${name} (${skillValue(actor, spec.key)}%${m})`;
}

/* ------------------------------------------------------------------------ */
/*  Message flag updates via the Handler                                    */
/* ------------------------------------------------------------------------ */

const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

/** Apply dotted-path flag changes to a message. Runs on the Handler. */
registerHandler("gmPatchMessage", (messageId, patch) =>
  withLock(messageId, async () => {
    const message = game.messages.get(messageId);
    if (!message) return false;
    const data = {};
    for (const [k, v] of Object.entries(patch)) data[`flags.${MODULE_ID}.${k}`] = v;
    await message.update(data);
    return true;
  }),
);

/**
 * Compare-and-set a state field. Returns true if this caller won the claim.
 * `path` like "request" or "group.rows.abc"; state lives at `${path}.state`.
 */
registerHandler("gmClaim", (messageId, path, from, to, by) =>
  withLock(messageId, async () => {
    const message = game.messages.get(messageId);
    if (!message) return false;
    const node = foundry.utils.getProperty(message.flags?.[MODULE_ID] ?? {}, path);
    const state = node?.state;
    if (!(Array.isArray(from) ? from : [from]).includes(state)) return false;
    await message.update({ [`flags.${MODULE_ID}.${path}.state`]: to, [`flags.${MODULE_ID}.${path}.by`]: by ?? null });
    return true;
  }),
);

export async function patchMessage(message, patch) {
  const id = typeof message === "string" ? message : message.id;
  return gm("gmPatchMessage", id, patch);
}

export async function claim(message, path, from, to) {
  const id = typeof message === "string" ? message : message.id;
  if (!activeGM()) {
    ui.notifications.warn("Delta Green Ops: the Handler needs to be connected for this.");
    return false;
  }
  return gm("gmClaim", id, path, from, to, game.user.id);
}

/* ------------------------------------------------------------------------ */
/*  Single requests                                                         */
/* ------------------------------------------------------------------------ */

const waiting = new Map();

/**
 * @param {Actor} actor  Whose player (or the Handler, for NPCs) answers.
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.reason]   HTML shown above the buttons.
 * @param {{label:string, run:string, args?:object, primary?:boolean, tip?:string}[]} p.choices
 * @param {string} [p.fields]   HTML controls read when a button is clicked (passed as args.fields).
 * @param {"public"|"owners"|"gm"} [p.visibility]
 * @param {boolean} [p.blocking=true]  Wait for the answer (else return null at once).
 * @param {number|null} [p.direct]     Index of the choice to run immediately if this user may roll here.
 * @param {string} [p.kind]
 */
export async function requestAction(actor, { title, reason = "", choices, fields = "", visibility, blocking = true, direct = 0, kind = "roll", skipLabel = "Skip" }) {
  if (direct !== null && direct !== undefined && rollsHere(actor) && choices[direct]) {
    const c = choices[direct];
    return asRoller(actor, () => runContinuation(c.run, { ...(c.args ?? {}), fields: {} }, { actor, user: game.user }));
  }
  const vis = visibility ?? (isPlayerActor(actor) ? "public" : "gm");
  const owner = actor?.uuid ?? null;
  const buttons = choices
    .map(
      (c, i) =>
        `<button type="button" class="dgops-btn ${c.primary === false ? "" : i === 0 ? "primary" : ""}" data-dgops="requestChoice" data-args='${esc(JSON.stringify({ i }))}'${owner ? ` data-owner="${esc(owner)}"` : ""}${c.tip ? ` data-tooltip="${esc(c.tip)}"` : ""}>${c.icon ? `<i class="${esc(c.icon)}"></i> ` : ""}${esc(c.label)}</button>`,
    )
    .join("");
  const body = `<div class="dgops-request">
      ${reason ? `<div class="dgops-request__reason">${reason}</div>` : ""}
      ${fields ? `<div class="dgops-request__fields">${fields}</div>` : ""}
      <div class="dgops-buttons dgops-request__actions">${buttons}
        <button type="button" class="dgops-btn subtle dgops-gm-only" data-dgops="requestSkip" data-tooltip="Handler: carry on without this roll.">${esc(skipLabel)}</button>
      </div>
      <p class="dgops-request__status"></p>
    </div>`;
  const message = await postCard({
    actor,
    title,
    body,
    kind,
    whisper: whisperFor(actor, vis),
    flags: { [MODULE_ID]: { request: { state: "pending", actorUuid: owner, choices, who: ownerNames(actor), result: null } } },
  });
  if (!blocking) return null;
  return new Promise((resolve) => waiting.set(message.id, resolve));
}

/** Request a single test. Resolves to { outcome, messageId, next } (or null if skipped). */
export async function requestTest(actor, spec, { title, reason = "", then = null, thenArgs = {}, visibility, blocking = true, label = null } = {}) {
  return requestAction(actor, {
    title: title ?? `${actor.name}: ${specLabel(actor, spec)}`,
    reason,
    visibility,
    blocking,
    choices: [{ label: label ?? `Roll ${specLabel(actor, spec)}`, icon: "fas fa-dice-d20", run: "rollTest", args: { spec, then, thenArgs } }],
  });
}

/** Roll here if allowed, otherwise request the roll and wait. Resolves to an outcome or null. */
export async function testFor(actor, spec, opts = {}) {
  const r = await requestTest(actor, spec, { ...opts, blocking: true });
  return r?.outcome ?? null;
}

registerContinuation("rollTest", async ({ spec, then, thenArgs }, ctx) => {
  const { outcome, message } = await systemTest(ctx.actor, {
    type: spec.type,
    key: spec.key,
    item: spec.itemId ? ctx.actor.items.get(spec.itemId) : null,
    modifier: spec.modifier ?? 0,
    messageMode: spec.messageMode,
    context: spec.context ?? {},
  });
  let next = null;
  if (then) next = await runContinuation(then, { ...(thenArgs ?? {}), outcome, rollMessageId: message?.id }, ctx);
  return { outcome, messageId: message?.id ?? null, next: next ?? null };
});

function summarise(result) {
  let out;
  try {
    out = JSON.parse(JSON.stringify(result ?? null));
  } catch {
    out = null;
  }
  if (out && result?.outcome) {
    const o = result.outcome;
    out.outcome = { total: o.total, target: o.target, success: o.success, critical: o.critical, fumble: o.fumble };
    out.messageId ??= null;
    out.next ??= null;
  }
  return out;
}

registerAction("requestChoice", async ({ message, args, button }) => {
  const req = message.getFlag(MODULE_ID, "request");
  if (!req || req.state !== "pending") return false;
  const choice = req.choices?.[args.i];
  if (!choice) return false;
  const fields = readForm(button.closest(".dgops-request")?.querySelector(".dgops-request__fields"));
  if (!(await claim(message, "request", "pending", "running"))) return false;
  const actor = req.actorUuid ? await fromUuid(req.actorUuid) : null;
  let result = null;
  try {
    result = await asRoller(actor, () => runContinuation(choice.run, { ...(choice.args ?? {}), fields }, { actor, message, user: game.user }));
  } catch (e) {
    await patchMessage(message, { "request.state": "pending", "request.by": null });
    throw e;
  }
  await patchMessage(message, { "request.state": "done", "request.result": summarise(result), "request.chosen": choice.label, "request.by": game.user.id });
  return false;
});

registerAction("requestSkip", async ({ message }) => {
  if (!game.user.isGM) return false;
  if (!(await claim(message, "request", "pending", "skipped"))) return false;
  return false;
});

/** Resolve whoever is waiting on a request once its card records an answer. */
export function onRequestUpdated(message) {
  const req = message.getFlag(MODULE_ID, "request");
  if (!req || !waiting.has(message.id)) return;
  if (req.state === "done" || req.state === "skipped") {
    const resolve = waiting.get(message.id);
    waiting.delete(message.id);
    resolve(req.state === "done" ? req.result : null);
  }
}

/** Render-time: show the request's state; hide controls from people who can't use them. */
export function renderRequest(message, element) {
  const req = message.getFlag(MODULE_ID, "request");
  const box = element.querySelector(".dgops-request");
  if (!req || !box) return;
  const status = box.querySelector(".dgops-request__status");
  const actions = box.querySelector(".dgops-request__actions");
  const fields = box.querySelector(".dgops-request__fields");
  if (!game.user.isGM) box.querySelectorAll(".dgops-gm-only").forEach((el) => el.remove());
  if (req.state === "pending") {
    const actor = req.actorUuid ? fromUuidSync(req.actorUuid, { strict: false }) : null;
    const mine = game.user.isGM || actor?.isOwner;
    if (status) status.textContent = mine ? "" : `Waiting for ${req.who}…`;
    if (!mine) {
      actions?.remove();
      fields?.remove();
    }
    return;
  }
  actions?.remove();
  fields?.remove();
  const by = req.by ? game.users.get(req.by)?.name : null;
  if (!status) return;
  if (req.state === "running") status.textContent = `${by ?? "Someone"} is rolling…`;
  else if (req.state === "skipped") status.textContent = "Skipped by the Handler.";
  else {
    const o = req.result?.outcome;
    status.innerHTML = o ? `${esc(req.chosen ?? "")}: <b>${o.total}</b> ${outcomeBadge(o)}${by ? ` <span class="dgops-quiet">— ${esc(by)}</span>` : ""}` : `${esc(req.chosen ?? "Done")}${by ? ` <span class="dgops-quiet">— ${esc(by)}</span>` : ""}`;
  }
}

/* ------------------------------------------------------------------------ */
/*  Group cards                                                             */
/* ------------------------------------------------------------------------ */

/**
 * One card, one row per actor. Each row's button runs `run` for that actor on the clicker's client.
 * The continuation returns { pass?: boolean, label?: string, gm?: string } for the row.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.intro]    HTML above the rows.
 * @param {{actor:Actor, run:string, args?:object, button?:string}[]} p.rows
 * @param {"passfail"|"none"} [p.reveal]  What everyone sees once a row has rolled.
 * @param {"public"|"involved"|"gm"} [p.visibility]
 * @param {string} [p.finalize]  Continuation run on the Handler's client once every row is done.
 * @param {object} [p.finalizeArgs]
 */
export async function createGroupCard({ title, subtitle = "", intro = "", rows, reveal = "passfail", visibility = "public", finalize = null, finalizeArgs = {}, kind = "roll", tip = "" }) {
  const rowMap = {};
  const order = [];
  for (const r of rows) {
    const id = foundry.utils.randomID(8);
    order.push(id);
    const token = r.actor.getActiveTokens?.(true, true)?.[0];
    rowMap[id] = {
      actorUuid: r.actor.uuid,
      name: token?.name ?? r.actor.name,
      img: token?.texture?.src ?? r.actor.img ?? "icons/svg/mystery-man.svg",
      run: r.run,
      args: r.args ?? {},
      button: r.button ?? "Roll",
      state: "pending",
      player: isPlayerActor(r.actor),
    };
  }
  let whisper = null;
  if (visibility === "gm") whisper = gmWhisper();
  if (visibility === "involved") {
    const ids = new Set(gmWhisper());
    for (const r of rows) for (const u of game.users) if (r.actor.testUserPermission?.(u, "OWNER")) ids.add(u.id);
    whisper = [...ids];
  }
  const message = await postCard({
    title,
    subtitle,
    kind,
    tip,
    body: `${intro}<div class="dgops-group"></div>`,
    whisper,
    flags: { [MODULE_ID]: { group: { rows: rowMap, order, reveal, finalize, finalizeArgs, done: false } } },
  });
  // NPC rows roll straight away when the Handler has chosen automatic NPC rolls.
  for (const id of order) {
    const row = rowMap[id];
    if (row.player || setting("npcRolls") !== "auto") continue;
    const actor = await fromUuid(row.actorUuid);
    // eslint-disable-next-line no-await-in-loop
    await runGroupRow(message, id, actor);
  }
  return message;
}

async function runGroupRow(message, rowId, actor) {
  const group = message.getFlag(MODULE_ID, "group");
  const row = group?.rows?.[rowId];
  if (!row) return false;
  if (!(await claim(message, `group.rows.${rowId}`, "pending", "running"))) return false;
  let result;
  try {
    result = await asRoller(actor, () => runContinuation(row.run, { ...(row.args ?? {}), messageId: message.id, rowId }, { actor, message, user: game.user }));
  } catch (e) {
    await patchMessage(message, { [`group.rows.${rowId}.state`]: "pending" });
    throw e;
  }
  await gm("gmGroupRowDone", message.id, rowId, summarise(result) ?? {});
  return true;
}

registerAction("groupRoll", async ({ message, args }) => {
  const group = message.getFlag(MODULE_ID, "group");
  const row = group?.rows?.[args.row];
  if (!row) return false;
  const actor = await fromUuid(row.actorUuid);
  if (!game.user.isGM && !actor?.isOwner) return false;
  await runGroupRow(message, args.row, actor);
  return false;
});

registerAction("groupSkip", async ({ message, args }) => {
  if (!game.user.isGM) return false;
  if (!(await claim(message, `group.rows.${args.row}`, "pending", "running"))) return false;
  await gm("gmGroupRowDone", message.id, args.row, { skipped: true });
  return false;
});

registerHandler("gmGroupRowDone", async (messageId, rowId, result) => {
  const finish = await withLock(messageId, async () => {
    const message = game.messages.get(messageId);
    if (!message) return null;
    const r = result ?? {};
    await message.update({
      [`flags.${MODULE_ID}.group.rows.${rowId}.state`]: r.skipped ? "skipped" : "done",
      [`flags.${MODULE_ID}.group.rows.${rowId}.pass`]: r.pass ?? null,
      [`flags.${MODULE_ID}.group.rows.${rowId}.label`]: r.label ?? null,
      [`flags.${MODULE_ID}.group.rows.${rowId}.gm`]: r.gm ?? null,
      [`flags.${MODULE_ID}.group.rows.${rowId}.outcome`]: r.outcome ?? null,
    });
    const group = message.getFlag(MODULE_ID, "group");
    const allDone = group.order.every((id) => ["done", "skipped"].includes(group.rows[id]?.state));
    if (!allDone || group.done) return null;
    await message.update({ [`flags.${MODULE_ID}.group.done`]: true });
    return group.finalize ? { message, group } : null;
  });
  // Outside the lock, so the finalizer can update the card too.
  if (finish) {
    try {
      await runContinuation(finish.group.finalize, { ...(finish.group.finalizeArgs ?? {}), messageId }, { message: finish.message, user: game.user });
    } catch (e) {
      warn("group finalize failed", e);
    }
  }
  return true;
});

/** Render-time: draw the rows from flags. */
export function renderGroup(message, element) {
  const group = message.getFlag(MODULE_ID, "group");
  const host = element.querySelector(".dgops-group");
  if (!group || !host) return;
  const isGM = game.user.isGM;
  host.innerHTML = group.order
    .map((id) => {
      const r = group.rows[id];
      const actor = fromUuidSync(r.actorUuid, { strict: false });
      const mine = isGM || actor?.isOwner;
      let right = "";
      if (r.state === "pending") {
        right = mine
          ? `<button type="button" class="dgops-btn primary" data-dgops="groupRoll" data-args='${esc(JSON.stringify({ row: id }))}'><i class="fas fa-dice-d20"></i> ${esc(r.button)}</button>${isGM ? `<button type="button" class="dgops-btn subtle" data-dgops="groupSkip" data-args='${esc(JSON.stringify({ row: id }))}' data-tooltip="Handler: leave this one out.">Skip</button>` : ""}`
          : `<span class="dgops-quiet">Waiting…</span>`;
      } else if (r.state === "running") right = `<span class="dgops-quiet">Rolling…</span>`;
      else if (r.state === "skipped") right = `<span class="dgops-quiet">Skipped</span>`;
      else if (group.reveal === "passfail" && r.pass !== null && r.pass !== undefined) right = `<span class="dgops-badge ${r.pass ? "success" : "fail"}">${r.pass ? "Passed" : "Failed"}</span>`;
      else right = `<span class="dgops-quiet">${esc(isGM || mine ? r.label ?? "Rolled" : "Rolled")}</span>`;
      const gmLine = isGM && r.gm ? `<span class="dgops-trow__gm">${r.gm}</span>` : "";
      return `<div class="dgops-trow" data-state="${r.state}"><img src="${esc(r.img)}" alt=""><span class="dgops-trow__name">${esc(r.name)}${gmLine}</span><span class="dgops-trow__act">${right}</span></div>`;
    })
    .join("");
}
