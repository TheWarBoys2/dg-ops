/**
 * Quality-of-life tools, mostly reached from the macro compendium:
 *  - situational effects with a duration (pepper spray, tear gas, intoxication…)
 *  - Agent backups in a world compendium, with restore
 *  - team report, damage/heal selected tokens, toggle conditions on selected tokens
 *  - Home scene: hand each player their pursuit
 *  - combat tracker marks, "your roll is waiting" notices, keybindings
 */
import { MODULE_ID, STATUS, warn } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { setStatus, hasStatus, createEffect, effectsWithFlag, deleteEmbedded } from "../core/ops.mjs";
import { postCard, registerAction, gmWhisper, list } from "../core/chat.mjs";
import { prompt, esc, options, field } from "../core/ui.mjs";
import { evalFormula } from "../core/system.mjs";
import { callUser, registerHandler } from "../core/socket.mjs";
import { schedule, registerEventType } from "../core/scheduler.mjs";
import { registerContinuation } from "../core/requests.mjs";
import * as H from "../rules/home.mjs";
import { teamOnScene } from "../core/team.mjs";

/* ------------------------------------------------------------------------ */
/*  Who a macro acts on                                                     */
/* ------------------------------------------------------------------------ */

export function selectedActors() {
  const sel = canvas?.tokens?.controlled?.map((t) => t.actor).filter(Boolean) ?? [];
  return [...new Map(sel.map((a) => [a.uuid, a])).values()];
}

/** Agents on the scene, else every player-owned Agent. */
export function team() {
  return teamOnScene();
}

/** Selected tokens' actors, else the user's own character. */
export function actingActor() {
  return selectedActors()[0] ?? game.user.character ?? null;
}

/* ------------------------------------------------------------------------ */
/*  Situational effects                                                     */
/* ------------------------------------------------------------------------ */

const ALL = ["system.rollTarget.allSkills", "system.rollTarget.statistics"];
/**
 * Situational effects. Book values where the book gives them (pp.51, 70, 93–96); the module's guess
 * where it doesn't (marked). minutes: game minutes; turns: a dice formula of 6-second turns; 0 = until removed.
 */
export const EFFECT_PRESETS = {
  pepper: { name: "Pepper-sprayed", mod: -20, keys: ALL, minutes: 60, img: "icons/svg/daze.svg", hint: "−20% for 1 hour (p.96)." },
  taser: { name: "Shocked (stun gun / taser)", mod: -20, keys: ALL, turns: "1d20", img: "icons/svg/lightning.svg", hint: "−20% for 1D20 turns (p.96). A taser hit stuns first." },
  gas: { name: "Tear gas", mod: -40, keys: ALL, minutes: 60, img: "icons/svg/poison.svg", hint: "−40% for 1 hour (p.96)." },
  flashbang: { name: "Flash-banged", mod: -40, keys: ALL, turns: "1d6", img: "icons/svg/explosion.svg", hint: "Stunned, then −40% for 1D6 turns; −20% with eye or ear protection (p.93)." },
  dazzled: { name: "Dazzled", mod: -20, keys: ALL, turns: "1d6", img: "icons/svg/light.svg", hint: "Bright light in darkness: −20% for 1D6 turns (p.93)." },
  drunk: { name: "Intoxicated", mod: -20, keys: ALL, minutes: 180, img: "icons/svg/tankard.svg", hint: "Heavy drinking: −20% to skill and stat tests (p.70). Lasts a few hours: 3 is the module's guess." },
  sedated: { name: "Sedated (benzodiazepine)", mod: -20, keys: ALL, minutes: 240, img: "icons/svg/sleep.svg", hint: "−20% to skill and stat tests (p.70). Duration is the module's guess." },
  hungover: { name: "Sick after sedatives", mod: -20, keys: [...ALL, "system.rollTarget.sanity"], minutes: 0, img: "icons/svg/degen.svg", hint: "−20% to all tests until a full night's rest (p.47)." },
  dark: { name: "Darkness / smoke", mod: -20, keys: ["system.rollTarget.allSkills"], minutes: 0, img: "icons/svg/blind.svg", hint: "Terrible visibility: −20% (p.53). Remove when the lights come on." },
  custom: { name: "Custom modifier", mod: -20, keys: ALL, minutes: 0, img: "icons/svg/aura.svg", hint: "Your own name, modifier and duration." },
};

export async function applySituationalEffect(actor, { preset = "custom", name, mod, minutes, sanToo = false } = {}) {
  const p = EFFECT_PRESETS[preset] ?? EFFECT_PRESETS.custom;
  const value = Number(mod ?? p.mod) || 0;
  const keys = [...p.keys, ...(sanToo ? ["system.rollTarget.sanity"] : [])];
  const id = foundry.utils.randomID(8);
  const label = name || p.name;
  await createEffect(actor, {
    name: `${label} (${value > 0 ? "+" : ""}${value}%)`,
    img: p.img,
    description: p.hint,
    changes: keys.map((key) => ({ key, type: "add", value: String(value), phase: "final" })),
    flags: { situational: id },
  });
  let seconds = (Number(minutes ?? p.minutes) || 0) * 60;
  if (minutes == null && p.turns) seconds = (await evalFormula(p.turns, {}, { show: false })).total * 6;
  if (seconds > 0) await schedule({ type: "removeSituational", delay: seconds, actorUuid: actor.uuid, data: { id }, label: `${actor.name}: ${label} wears off` });
  return id;
}

registerEventType("removeSituational", async (evt, actor) => {
  if (!actor) return null;
  const fx = actor.effects?.filter((e) => e.getFlag(MODULE_ID, "situational") === evt.data.id) ?? [];
  if (fx.length) {
    await deleteEmbedded(actor, "ActiveEffect", fx.map((e) => e.id));
    await postCard({ actor, title: "Wears off", body: `<p>${esc(fx[0].name)} wears off ${esc(actor.name)}.</p>` });
  }
  return null;
});

export async function effectDialog(actors = selectedActors()) {
  if (!actors.length) return ui.notifications.warn("Select the tokens first.");
  const r = await prompt({
    title: "Situational effect",
    width: 460,
    content: `<p>For: <b>${actors.map((a) => esc(a.name)).join(", ")}</b></p>
      ${field("Effect", `<select name="preset">${Object.entries(EFFECT_PRESETS).map(([k, v]) => `<option value="${k}" title="${esc(v.hint)}">${esc(v.name)} (${v.mod}%, ${v.turns ? `${v.turns.toUpperCase()} turns` : v.minutes ? `${v.minutes} min` : "until removed"})</option>`).join("")}</select>`)}
      ${field("Name", `<input type="text" name="name" placeholder="Only for a custom effect">`)}
      ${field("Modifier", `<input type="number" name="mod" placeholder="preset" step="10" style="width:6em">`)}
      ${field("Lasts (minutes of game time)", `<input type="number" name="minutes" placeholder="preset" min="0" style="width:6em">`, "Blank: the effect's own duration. 0 = until removed. It wears off as game time passes.")}
      <label class="dgops-check"><input type="checkbox" name="sanToo"> Also applies to SAN rolls</label>`,
    buttons: [{ action: "ok", label: "Apply", default: true }],
  });
  if (!r) return;
  const d = r.data;
  for (const a of actors) {
    await applySituationalEffect(a, { preset: d.preset, name: d.name, mod: d.mod ?? undefined, minutes: d.minutes ?? undefined, sanToo: d.sanToo });
  }
  const p = EFFECT_PRESETS[d.preset];
  const dur = d.minutes != null ? (d.minutes ? `${d.minutes} minutes` : "until removed") : p.turns ? `${p.turns.toUpperCase()} turns` : p.minutes ? `${p.minutes} minutes` : "until removed";
  await postCard({ title: esc(d.name || p.name), kind: "alert", body: `<p>${actors.map((a) => esc(a.name)).join(", ")}: ${d.mod ?? p.mod}% ${d.sanToo ? "to every test" : "to skills and stats"}, ${dur}.</p><p class="dgops-quiet">${esc(p.hint)}</p>` });
}

export async function clearSituational(actor) {
  const fx = effectsWithFlag(actor, "situational");
  if (fx.length) await deleteEmbedded(actor, "ActiveEffect", fx.map((e) => e.id));
  return fx.length;
}

/* ------------------------------------------------------------------------ */
/*  Damage, healing, conditions on selected tokens                          */
/* ------------------------------------------------------------------------ */

export async function damageDialog(actors = selectedActors()) {
  if (!actors.length) return ui.notifications.warn("Select the tokens first.");
  const r = await prompt({
    title: "Damage",
    content: `<p>To: <b>${actors.map((a) => esc(a.name)).join(", ")}</b></p>
      ${field("Damage", `<input type="text" name="f" value="1D6" style="width:7em">`, "A number or dice. Rolled once for each.")}
      ${field("Source", `<input type="text" name="src" placeholder="e.g. Shrapnel">`)}
      <label class="dgops-check"><input type="checkbox" name="armor" checked> Body armor reduces it</label>
      <label class="dgops-check"><input type="checkbox" name="stun"> Check for stun</label>`,
    buttons: [{ action: "ok", label: "Apply", default: true }],
  });
  if (!r) return;
  const { applyDamage } = await import("./injury.mjs");
  for (const a of actors) {
    const roll = await evalFormula(r.data.f || "0");
    const armor = r.data.armor ? Number(a.system?.health?.protection ?? 0) || 0 : 0;
    const amount = Math.max(0, roll.total - armor);
    await applyDamage(a, amount, { source: r.data.src || "Damage", attack: !!r.data.stun, rolls: roll.dice?.length ? [roll] : [], notes: armor ? [`${roll.total} − armor ${armor}`] : [] });
  }
}

export async function healDialog(actors = selectedActors()) {
  if (!actors.length) return ui.notifications.warn("Select the tokens first.");
  const r = await prompt({
    title: "Heal",
    content: `<p>For: <b>${actors.map((a) => esc(a.name)).join(", ")}</b></p>${field("HP", `<input type="text" name="f" value="1D4" style="width:7em">`)}${field("Source", `<input type="text" name="src" placeholder="e.g. Field dressing">`)}`,
    buttons: [{ action: "ok", label: "Heal", default: true }],
  });
  if (!r) return;
  const { heal } = await import("./hazards.mjs");
  for (const a of actors) {
    const roll = await evalFormula(r.data.f || "0");
    await heal(a, roll.total, r.data.src || "Healing", roll.dice?.length ? [roll] : []);
  }
}

export async function toggleCondition(statusId, actors = selectedActors()) {
  if (!actors.length) return ui.notifications.warn("Select the tokens first.");
  const on = !actors.every((a) => hasStatus(a, statusId));
  for (const a of actors) await setStatus(a, statusId, on);
  const name = CONFIG.statusEffects.find((s) => s.id === statusId)?.name ?? statusId;
  ui.notifications.info(`${name} ${on ? "on" : "off"}: ${actors.map((a) => a.name).join(", ")}`);
  return on;
}

/* ------------------------------------------------------------------------ */
/*  Team report                                                             */
/* ------------------------------------------------------------------------ */

export async function teamReport(actors = team()) {
  if (!actors.length) return ui.notifications.warn("No Agents found.");
  const rows = actors
    .map((a) => {
      const s = a.system;
      const conds = [...(a.statuses ?? [])].map((id) => (CONFIG.statusEffects.find((e) => e.id === id)?.name ?? id).replace(/\s*\(.*\)$/, "")).filter(Boolean);
      const pend = (a.getFlag(MODULE_ID, "pendingDisorders") ?? []).length;
      const bp = s.sanity?.currentBreakingPoint;
      const nearBp = bp != null && s.sanity.value - bp <= 5;
      return `<tr><td><b>${esc(a.name)}</b></td><td>${s.health?.value}/${s.health?.max}</td><td>${s.wp?.value}/${s.wp?.max}</td><td class="${nearBp ? "warn" : ""}">${s.sanity?.value}${bp != null ? `<small> /BP ${bp}</small>` : ""}</td><td>${esc(conds.join(", "))}${pend ? ` <b class="dgops-alert">${pend} disorder${pend > 1 ? "s" : ""} pending</b>` : ""}</td></tr>`;
    })
    .join("");
  return postCard({
    title: "Team status",
    kind: "info",
    body: `<table class="dgops-table"><tr><th>Agent</th><th>HP</th><th>WP</th><th>SAN</th><th>Conditions</th></tr>${rows}</table>`,
    whisper: gmWhisper(),
  });
}

/* ------------------------------------------------------------------------ */
/*  Home scene: hand out pursuits                                           */
/* ------------------------------------------------------------------------ */

export async function homeSceneDialog(actors = team()) {
  if (!actors.length) return ui.notifications.warn("No Agents found.");
  const pursuits = Object.fromEntries(Object.entries(H.PURSUITS).filter(([, p]) => !p.optional || setting("illicitCash")).map(([k, p]) => [k, p.label]));
  const r = await prompt({
    title: "Home scene",
    width: 520,
    content: `<p>Each Agent's player gets a card to play out the pursuit you pick (rolls and Bond choices on their screen). Pick "Let them choose" to send a card with every option.</p>
      ${actors.map((a) => field(a.name, `<select name="p_${a.id}"><option value="">— skip —</option><option value="choose" selected>Let them choose</option>${options(pursuits)}</select>`)).join("")}`,
    buttons: [{ action: "ok", label: "Send", default: true }],
  });
  if (!r) return;
  const { runPursuit } = await import("./downtime.mjs");
  const { requestAction } = await import("../core/requests.mjs");
  for (const a of actors) {
    const pick = r.data[`p_${a.id}`];
    if (!pick) continue;
    if (pick !== "choose") {
      await runPursuit(a, pick);
      continue;
    }
    await requestAction(a, {
      title: `${a.name}: Home scene`,
      kind: "home",
      reason: `<p>Pick how ${esc(a.name)} spends the time between operations (pp.78–80). Pick the pursuit, then click Play.</p>`,
      fields: `<div class="dgops-inline-fields"><select name="id">${options(pursuits)}</select></div>`,
      choices: [{ label: "Play", icon: "fas fa-house", run: "homePursuitPick", args: {} }],
      blocking: false,
      direct: null,
    });
  }
}

registerContinuation("homePursuitPick", async ({ fields = {} }, ctx) => {
  const { runPursuit } = await import("./downtime.mjs");
  const id = fields.id || "nature";
  await runPursuit(ctx.actor, id, { handOver: false });
  return { label: H.PURSUITS[id]?.label ?? id };
});

/* ------------------------------------------------------------------------ */
/*  Catastrophe queue                                                       */
/* ------------------------------------------------------------------------ */

export async function afterTheCrisis() {
  const q = game.settings.get(MODULE_ID, "queue")?.catastrophes ?? [];
  if (!q.length) return ui.notifications.info("No catastrophes waiting: nobody's Delta Green Bonds need resolving.");
  const { resolveCatastrophe } = await import("./sanity.mjs");
  for (const c of q) await resolveCatastrophe(c.id);
}

/* ------------------------------------------------------------------------ */
/*  Backups                                                                 */
/* ------------------------------------------------------------------------ */

const PACK = "dg-ops-backups";

async function backupPack({ create = true } = {}) {
  let pack = game.packs.get(`world.${PACK}`);
  if (!pack && create && game.user.isGM) {
    const { CompendiumCollection } = foundry.documents.collections ?? {};
    const Cls = CompendiumCollection ?? globalThis.CompendiumCollection;
    pack = await Cls.createCompendium({ label: "Ops: Agent backups", name: PACK, type: "Actor", package: "world" });
  }
  return pack ?? null;
}

/** Copy an Agent into the backups compendium, keeping the newest N per Agent. */
export async function backupActor(actor, { reason = "manual" } = {}) {
  if (!game.user.isGM || actor?.type !== "agent") return null;
  const pack = await backupPack();
  if (!pack) return null;
  const data = actor.toObject();
  delete data._id;
  const stamp = new Date();
  data.name = `${actor.name} — ${stamp.toISOString().slice(0, 16).replace("T", " ")}`;
  data.ownership = { default: 0 };
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), backup: { of: actor.uuid, name: actor.name, at: stamp.getTime(), worldTime: game.time.worldTime, reason } };
  const [doc] = await pack.documentClass.createDocuments([data], { pack: pack.collection });
  // Prune
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.backup`] });
  const mine = index.filter((e) => foundry.utils.getProperty(e, `flags.${MODULE_ID}.backup.of`) === actor.uuid).sort((a, b) => foundry.utils.getProperty(b, `flags.${MODULE_ID}.backup.at`) - foundry.utils.getProperty(a, `flags.${MODULE_ID}.backup.at`));
  const keep = Number(setting("backupsKept")) || 5;
  const drop = mine.slice(keep).map((e) => e._id);
  if (drop.length) await pack.documentClass.deleteDocuments(drop, { pack: pack.collection });
  return doc ?? null;
}

export async function backupAll({ reason = "manual", quiet = false } = {}) {
  if (!game.user.isGM) return 0;
  const agents = game.actors.filter((a) => a.type === "agent");
  let n = 0;
  for (const a of agents) if (await backupActor(a, { reason })) n++;
  if (!quiet) ui.notifications.info(`Backed up ${n} Agent${n === 1 ? "" : "s"} to "Ops: Agent backups".`);
  return n;
}

/** Backups of one Agent, newest first: [{ id, at, reason }]. */
export async function backupsOf(actor) {
  const pack = await backupPack({ create: false });
  if (!pack) return [];
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.backup`] });
  return index
    .map((e) => ({ id: e._id, ...(foundry.utils.getProperty(e, `flags.${MODULE_ID}.backup`) ?? {}) }))
    .filter((b) => b.of === actor.uuid)
    .sort((a, b) => b.at - a.at);
}

/** Put an Agent back as it was in a backup. Takes a fresh backup first, so this can be undone. */
export async function restoreBackup(actor, backupId) {
  if (!game.user.isGM) return false;
  const pack = await backupPack({ create: false });
  const doc = await pack?.getDocument(backupId);
  if (!doc) return false;
  await backupActor(actor, { reason: "before restore" });
  const data = doc.toObject();
  delete data._id;
  data.name = actor.name;
  data.ownership = actor.toObject().ownership;
  if (data.flags?.[MODULE_ID]) delete data.flags[MODULE_ID].backup;
  await actor.deleteEmbeddedDocuments("Item", actor.items.map((i) => i.id));
  await actor.deleteEmbeddedDocuments("ActiveEffect", actor.effects.map((e) => e.id));
  const { items = [], effects = [], ...rest } = data;
  await actor.update(rest, { diff: false, recursive: false, dgOpsSan: true, dgOpsUndo: true });
  if (items.length) await actor.createEmbeddedDocuments("Item", items, { keepId: true });
  if (effects.length) await actor.createEmbeddedDocuments("ActiveEffect", effects, { keepId: true });
  await postCard({ actor, title: "Restored from backup", kind: "alert", body: `<p>${esc(actor.name)} is back as they were. The state just before the restore was backed up too.</p>`, whisper: gmWhisper() });
  return true;
}

/** Once a real day, when the Handler logs in. */
export async function dailyBackup() {
  if (!game.user.isActiveGM || !setting("backups")) return;
  const last = Number(game.settings.get(MODULE_ID, "lastBackup")) || 0;
  if (Date.now() - last < 20 * 3600 * 1000) return;
  try {
    await backupAll({ reason: "daily", quiet: true });
    await game.settings.set(MODULE_ID, "lastBackup", Date.now());
  } catch (e) {
    warn("backup failed", e);
  }
}

/* ------------------------------------------------------------------------ */
/*  Combat tracker marks                                                    */
/* ------------------------------------------------------------------------ */

export function renderTrackerMarks(app, html) {
  if (!setting("combatMarks")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const combat = app?.viewed ?? game.combat;
  if (!root || !combat?.started) return;
  for (const li of root.querySelectorAll("[data-combatant-id]")) {
    const c = combat.combatants.get(li.dataset.combatantId);
    const a = c?.actor;
    if (!a) continue;
    li.querySelector(".dgops-ct")?.remove();
    const marks = [];
    const acted = a.getFlag(MODULE_ID, "acted");
    if (acted?.combatId === combat.id && acted.round === combat.round) marks.push(`<span data-tooltip="Has acted (or defended) this round">Acted</span>`);
    const g = a.getFlag(MODULE_ID, "guard");
    if (g?.combatId === combat.id) marks.push(`<span class="guard" data-tooltip="Melee roll still stands against hand-to-hand attacks">Guard${game.user.isGM ? ` ${g.total}` : ""}</span>`);
    if (!marks.length) continue;
    const box = document.createElement("span");
    box.className = "dgops-ct";
    box.innerHTML = marks.join("");
    (li.querySelector(".token-name, .name, h4") ?? li).append(box);
  }
}

/* ------------------------------------------------------------------------ */
/*  "Your roll is waiting"                                                  */
/* ------------------------------------------------------------------------ */

const pinged = new Set();

/** Is this card waiting on something the current (non-GM) user should click? */
function waitingOnMe(message) {
  if (game.user.isGM) return false;
  const mine = (uuid) => {
    const a = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    return !!a?.isOwner;
  };
  const req = message.getFlag(MODULE_ID, "request");
  if (req?.state === "pending" && mine(req.actorUuid)) return true;
  const g = message.getFlag(MODULE_ID, "group");
  if (g && Object.values(g.rows ?? {}).some((r) => r.state === "pending" && mine(r.actorUuid))) return true;
  const ch = message.getFlag(MODULE_ID, "chase");
  if (ch && !ch.state?.over && Object.entries(ch.sides ?? {}).some(([k, s]) => !ch.pending?.[k] && mine(s.actorUuid))) return true;
  return false;
}

export function markWaiting(message, element) {
  const on = waitingOnMe(message);
  element.classList?.toggle("dgops-your-turn", on);
  if (!on || !setting("pingPlayers")) return;
  if (pinged.has(message.id) || Date.now() - (message.timestamp ?? 0) > 120000) return;
  pinged.add(message.id);
  const title = element.querySelector(".dgops-card__title")?.textContent?.trim() || "A roll";
  ui.notifications.info(`${title}: it's your roll. Click it in chat.`);
}

/** Handler: re-ping the players a card is waiting on. */
registerAction("nudge", async ({ message }) => {
  if (!game.user.isGM) return false;
  const uuids = new Set();
  const req = message.getFlag(MODULE_ID, "request");
  if (req?.state === "pending") uuids.add(req.actorUuid);
  for (const r of Object.values(message.getFlag(MODULE_ID, "group")?.rows ?? {})) if (r.state === "pending") uuids.add(r.actorUuid);
  const users = new Set();
  for (const u of uuids) {
    const a = fromUuidSync(u, { strict: false });
    for (const user of game.users) if (user.active && !user.isGM && a?.testUserPermission(user, "OWNER")) users.add(user.id);
  }
  for (const id of users) callUser(id, "nudged", [message.id]).catch(() => {});
  ui.notifications.info(users.size ? `Nudged ${[...users].map((id) => game.users.get(id)?.name).join(", ")}.` : "Nobody connected to nudge.");
  return false;
});

registerHandler("nudged", (messageId) => {
  const el = document.querySelector(`.chat-message[data-message-id="${messageId}"]`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.classList.remove("dgops-your-turn");
  void el?.offsetWidth;
  el?.classList.add("dgops-your-turn");
  ui.notifications.warn("The Handler is waiting on your roll.");
  return true;
});

/** Render-time: Nudge button for the Handler on cards still waiting on a player. */
export function addNudge(message, element) {
  if (!game.user.isGM) return;
  const req = message.getFlag(MODULE_ID, "request");
  const g = message.getFlag(MODULE_ID, "group");
  const waitingPlayer = (uuid) => !!fromUuidSync(uuid, { strict: false })?.hasPlayerOwner;
  const waiting = (req?.state === "pending" && waitingPlayer(req.actorUuid)) || Object.values(g?.rows ?? {}).some((r) => r.state === "pending" && waitingPlayer(r.actorUuid));
  if (!waiting || element.querySelector('[data-dgops="nudge"]')) return;
  const host = element.querySelector(".dgops-request__actions") ?? element.querySelector(".dgops-group");
  if (!host) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dgops-btn subtle";
  b.dataset.dgops = "nudge";
  b.dataset.tooltip = "Remind the player this is waiting on them.";
  b.innerHTML = `<i class="fas fa-bell"></i> Nudge`;
  if (host.classList.contains("dgops-group")) {
    const wrap = document.createElement("div");
    wrap.className = "dgops-buttons";
    wrap.append(b);
    host.after(wrap);
  } else host.append(b);
}

/* ------------------------------------------------------------------------ */
/*  Keybindings                                                             */
/* ------------------------------------------------------------------------ */

export function registerKeybindings() {
  const kb = game.keybindings;
  if (!kb?.register) return;
  const reg = (name, label, hint, keys, onDown, restricted = false) => kb.register(MODULE_ID, name, { name: label, hint, editable: keys, onDown: () => (onDown(), true), restricted, precedence: globalThis.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? 0 });
  reg("attack", "Attack with the selected token", "Opens the attack window.", [{ key: "KeyA", modifiers: ["Shift"] }], async () => (await import("./combat.mjs")).attackAssistant());
  reg("kit", "Ops Kit for the selected token", "", [{ key: "KeyK", modifiers: ["Shift"] }], async () => {
    const a = actingActor();
    if (a) (await import("../apps/kit.mjs")).openKit(a);
  });
  reg("san", "SAN test for the selected tokens (Handler)", "Posts a SAN card.", [], async () => {
    const actors = selectedActors();
    (await import("./sanity.mjs")).sanDialog(actors.length ? actors : team());
  }, true);
  reg("report", "Team status (Handler)", "Whispers HP, WP, SAN and conditions.", [], () => teamReport(), true);
}

export { STATUS, list };
