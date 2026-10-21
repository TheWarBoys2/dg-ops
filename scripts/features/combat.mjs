/**
 * Combat automation (pp.50–60).
 *
 * The flow:
 *  1. Clicking a weapon opens the attack wizard (apps/attack-wizard.mjs). It builds the roll from the
 *     action, the situation and the conditions on both sides, then the attacker rolls.
 *  2. The attack's chat card carries one row per target: token picture, name, state, and the next
 *     button (Resolve → Defend → Roll damage). Row state lives in the message flags.
 *  3. Resolve checks what the target can do. Helpless targets are hit automatically; a target whose
 *     melee roll still stands (Guarding) opposes hand-to-hand attacks without being asked; otherwise
 *     the target's player gets a Defend card. NPCs defend automatically or via a Handler card.
 *  4. On a hit the attacker rolls damage or Lethality from the row. Pins and disarms land at once;
 *     a disarmer chooses to take the weapon or knock it away.
 */
import { MODULE_ID, STATUS, warn } from "../core/constants.mjs";
import { aimActive, distracted } from "../core/patches.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, outcomeOf, statValue, skillValue, evalFormula, activeTokenDoc, rollClasses } from "../core/system.mjs";
import { update, setStatus, hasStatus } from "../core/ops.mjs";
import { postCard, button, registerAction, list, gmWhisper, outcomeBadge } from "../core/chat.mjs";
import { prompt, askOwner, esc, options, field } from "../core/ui.mjs";
import { callUser, registerHandler, gm, activeGM } from "../core/socket.mjs";
import { requestAction, testFor, registerContinuation, runContinuation, patchMessage, claim, isPlayerActor, ownerNames, asRoller } from "../core/requests.mjs";
import { resolveOpposed, capAttackModifiers } from "../rules/dice.mjs";
import {
  FIRE_MODES,
  CALLED_SHOTS,
  COMBAT_MODIFIERS,
  MELEE_SKILLS,
  OPTIONAL_CRIT_EFFECTS,
  parseKillRadius,
  parseCapacity,
  parseRange,
  rangeBand,
  cannotDefendReason,
  resolveLethality,
  resolveNormalDamage,
} from "../rules/combat.mjs";
import { applyDamage } from "./injury.mjs";
import { isAdapted } from "./sanity.mjs";

const RANGED_SKILLS = new Set(["firearms", "heavy_weapons", "artillery", "athletics", "demolitions"]);

/* ------------------------------------------------------------------------ */
/*  Combat-round memory: who acted, who is guarding, who is aiming          */
/* ------------------------------------------------------------------------ */

function combatRound() {
  const c = game.combat;
  return c?.started ? { combatId: c.id, round: c.round } : null;
}

export async function markActed(actor) {
  const cr = combatRound();
  if (!cr || !actor) return;
  await update(actor, { [`flags.${MODULE_ID}.acted`]: cr });
}

export function actedThisRound(actor) {
  const cr = combatRound();
  const a = actor?.getFlag?.(MODULE_ID, "acted");
  return !!(cr && a && a.combatId === cr.combatId && a.round === cr.round);
}

/**
 * A melee attack, pin, disarm or called shot "also opposes each Unarmed Combat and Melee Weapons
 * attack against your Agent until your Agent's next action" (p.54). So do Dodge and fighting back,
 * for the rest of that turn (p.53). The roll is kept as a guard until the actor's next turn.
 */
export function guardOf(actor) {
  const g = actor?.getFlag?.(MODULE_ID, "guard");
  const c = game.combat;
  if (!g || !c?.started || g.combatId !== c.id) return null;
  return g;
}

export async function setGuard(actor, outcome, source) {
  const cr = combatRound();
  if (!cr || !actor || !outcome) return;
  await update(actor, { [`flags.${MODULE_ID}.guard`]: { total: outcome.total, success: !!outcome.success, critical: !!outcome.critical, fumble: !!outcome.fumble, source, ...cr } });
  await setStatus(actor, STATUS.guard, true);
}

export async function clearGuard(actor) {
  if (!actor) return;
  if (actor.getFlag?.(MODULE_ID, "guard")) await update(actor, { [`flags.${MODULE_ID}.-=guard`]: null });
  await setStatus(actor, STATUS.guard, false);
}

/* ------------------------------------------------------------------------ */
/*  Weapons and targets                                                     */
/* ------------------------------------------------------------------------ */

export function protectionOf(tokenDoc) {
  const actor = tokenDoc?.actor;
  const flag = tokenDoc?.getFlag?.(MODULE_ID, "protection") ?? actor?.getFlag?.(MODULE_ID, "protection");
  if (flag) return flag;
  if (actor?.type === "vehicle") return "huge";
  return "exposed";
}

export function coverOf(tokenDoc) {
  return Number(tokenDoc?.getFlag?.(MODULE_ID, "cover") ?? 0) || 0;
}

function bodyArmor(actor) {
  return Number(actor?.system?.health?.protection ?? 0) || 0;
}

export function capacityOf(item) {
  return Number(item?.getFlag?.(MODULE_ID, "capacity")) || parseCapacity(item?.system?.ammo) || null;
}

export function isUnarmedItem(item) {
  return item?.getFlag?.("deltagreen", "SystemName") === "unarmed-attack" || /^unarmed/i.test(item?.name ?? "");
}

/** Fire modes a weapon can use: selective-fire weapons get bursts and sprays. */
export function fireModesFor(item) {
  const sys = item?.system ?? {};
  const selective = item?.getFlag?.(MODULE_ID, "selectiveFire") || (Number(sys.lethality) > 0 && !sys.isLethal && ["firearms", "heavy_weapons"].includes(sys.skill));
  const firearm = ["firearms", "heavy_weapons"].includes(sys.skill);
  const keys = selective ? Object.keys(FIRE_MODES) : ["single", ...(firearm ? ["suppressive"] : [])];
  return Object.fromEntries(keys.map((k) => [k, FIRE_MODES[k].label]));
}

/** Which actions a weapon allows (p.50–51). Pin and disarm need Unarmed Combat with both hands free. */
export function actionsFor(item) {
  const unarmed = item?.system?.skill === "unarmed_combat" || isUnarmedItem(item);
  return unarmed ? ["attack", "called", "pin", "disarm"] : ["attack", "called"];
}

export function weaponProfile(item, ctx = {}) {
  const sys = item?.system ?? {};
  const skill = sys.skill;
  const grapple = ctx.action === "pin" || ctx.action === "disarm";
  const melee = MELEE_SKILLS.has(skill) || grapple;
  const mode = FIRE_MODES[ctx.fireMode ?? "single"] ?? FIRE_MODES.single;
  let lethality = 0;
  let killRadius = parseKillRadius(sys.killRadius);
  let lethal = !!sys.isLethal;
  if (lethal) lethality = Number(sys.lethality) || 0;
  if (ctx.fireMode && ctx.fireMode !== "single") {
    lethality = mode.suppressOnly ? 0 : Number(sys.lethality) || mode.lethality;
    killRadius = mode.killRadius;
    lethal = !mode.suppressOnly;
  }
  const explosiveFlag = item?.getFlag?.(MODULE_ID, "explosive");
  const explosive = explosiveFlag ?? (lethal && killRadius >= 3 && (!ctx.fireMode || ctx.fireMode === "single"));
  return { skill, melee, grapple, lethal, lethality, killRadius, explosive, ap: Number(sys.armorPiercing) || 0, damage: sys.damage, suppressOnly: !!mode.suppressOnly, ammoUse: mode.ammo };
}

function strBonus(actor, skill) {
  if (!MELEE_SKILLS.has(skill)) return "";
  return actor?.system?.statistics?.str?.meleeDamageBonusFormula ?? "";
}

export function distanceBetween(a, b) {
  if (!a || !b) return null;
  try {
    const pa = a.object?.center ?? a.center;
    const pb = b.object?.center ?? b.center;
    return canvas.grid.measurePath([pa, pb]).distance;
  } catch {
    const d = canvas.dimensions;
    const ax = a.x + ((a.width ?? 1) * d.size) / 2;
    const ay = a.y + ((a.height ?? 1) * d.size) / 2;
    const bx = b.x + ((b.width ?? 1) * d.size) / 2;
    const by = b.y + ((b.height ?? 1) * d.size) / 2;
    return (Math.hypot(ax - bx, ay - by) / d.size) * d.distance;
  }
}

/** Everything about a target that matters to an attack. */
export function targetConditions(tokenDoc, { melee = false } = {}) {
  const a = tokenDoc?.actor;
  const st = (id) => hasStatus(a, id);
  const hp = Number(a?.system?.health?.value ?? 99);
  const person = ["agent", "npc"].includes(a?.type);
  const dead = st(STATUS.dead) || (person && hp <= 0);
  return {
    dead,
    helpless: !dead && (st(STATUS.helpless) || st(STATUS.unconscious) || (person && hp <= 2)),
    unconscious: st(STATUS.unconscious),
    stunned: st(STATUS.stun),
    pinned: st(STATUS.pinned),
    prone: st(STATUS.prone),
    unaware: st(STATUS.unaware),
    insane: st(STATUS.tempInsane),
    pinning: !!a?.getFlag?.(MODULE_ID, "pinning"),
    acted: actedThisRound(a),
    guard: melee ? guardOf(a) : null,
    cover: coverOf(tokenDoc),
    armor: bodyArmor(a),
    protection: protectionOf(tokenDoc),
  };
}

/** Short labels for the wizard's target chips. */
export function conditionChips(c, { melee }) {
  const out = [];
  if (c.dead) out.push({ text: "Dead", tone: "bad" });
  else if (c.helpless) out.push({ text: "Helpless: automatic hit", tone: "warn" });
  if (c.pinned && melee) out.push({ text: "Pinned: +20%", tone: "ok" });
  if (c.prone && !melee) out.push({ text: "Prone: −20%", tone: "warn" });
  if (c.unaware) out.push({ text: "Unaware: surprise", tone: "ok" });
  if (c.stunned) out.push({ text: "Stunned: can't defend", tone: "ok" });
  if (c.guard) out.push({ text: `Guarding: must beat ${c.guard.total}`, tone: "warn" });
  if (c.cover) out.push({ text: `Cover ${c.cover}`, tone: "warn" });
  if (c.armor) out.push({ text: `Armor ${c.armor}`, tone: "" });
  if (["huge", "transcendent", "fragile"].includes(c.protection)) out.push({ text: c.protection[0].toUpperCase() + c.protection.slice(1), tone: c.protection === "transcendent" ? "bad" : "" });
  return out;
}

/** What stops (or complicates) the attacker acting. */
export function attackerState(actor) {
  const st = (id) => hasStatus(actor, id);
  const hp = Number(actor?.system?.health?.value ?? 99);
  const blocks = [];
  const warns = [];
  if (st(STATUS.dead) || (["agent", "npc"].includes(actor?.type) && hp <= 0)) blocks.push({ kind: "dead", text: "Dead." });
  else if (st(STATUS.unconscious) || st(STATUS.helpless)) blocks.push({ kind: "out", text: "Unconscious or helpless: can't act." });
  else if (st(STATUS.stun)) blocks.push({ kind: "stun", text: "Stunned: can't act. Roll CON×5 on your turn to act normally next turn (p.55)." });
  else if (st(STATUS.pinned)) blocks.push({ kind: "pinned", text: "Pinned: the only thing you can do is try to escape (p.51)." });
  if (st(STATUS.suppressed) && !isAdapted(actor, "violence")) warns.push({ kind: "suppressed", text: "Suppressed: your action must be to get to cover or go prone — unless you stifle the terror for 1 SAN (p.57)." });
  if (st(STATUS.tempInsane)) warns.push({ kind: "insane", text: "Temporarily insane: the Handler decides what you do (p.69)." });
  if (Number(actor?.system?.wp?.value) === 0 && ["agent", "npc"].includes(actor?.type)) warns.push({ kind: "wp0", text: "0 WP: every test fails until WP recovers (p.47)." });
  if (actedThisRound(actor)) warns.push({ kind: "acted", text: "Already acted this round (or defended out of turn)." });
  return { blocks, warns };
}

/* ------------------------------------------------------------------------ */
/*  Building the roll                                                       */
/* ------------------------------------------------------------------------ */

/** Defaults for the wizard's choices, read from the situation on the table. */
export function attackDefaults(actor, item, targets = [], attackerToken = null) {
  const prof = weaponProfile(item);
  const t = targets[0] ?? null;
  const c = t ? targetConditions(t, { melee: prof.melee }) : {};
  const dist = t && attackerToken ? distanceBetween(attackerToken, t) : null;
  const band = !prof.melee && dist !== null ? rangeBand(dist, parseRange(item.system.range)) : "normal";
  return {
    weapon: item.id,
    action: "attack",
    fireMode: "single",
    called: "partial",
    range: band === "out" ? "beyond2" : band,
    vis: "normal",
    tr: c.prone ? "proneRunning" : "normal",
    tm: c.pinned ? "pinned" : "normal",
    att: "normal",
    ammo: "std",
    mod: 0,
    surprise: !!c.unaware && !game.combat?.started,
    blast: true,
    paySan: false,
    distance: dist,
    band,
  };
}

/** Work out the roll for an attack: skill, every modifier, and the capped total. */
export function computeAttack(actor, item, d) {
  const grapple = d.action === "pin" || d.action === "disarm";
  const calledKey = d.action === "called" ? d.called ?? "partial" : "none";
  const prof = weaponProfile(item, { fireMode: d.fireMode, action: d.action });
  const parts = [];
  const push = (label, mod) => mod && parts.push({ label: String(label ?? "").replace(/\s*\((?:[^)]*%[^)]*)\)\s*$/, ""), mod });
  const called = CALLED_SHOTS[calledKey] ?? CALLED_SHOTS.none;
  if (called.mod) push(`Called shot: ${called.label.replace(/^Optional:\s*/, "").replace(/\s*\(.*$/, "")}`, called.mod);
  if (prof.melee) push(COMBAT_MODIFIERS.targetMelee[d.tm]?.label, COMBAT_MODIFIERS.targetMelee[d.tm]?.mod);
  else {
    push(COMBAT_MODIFIERS.range[d.range]?.label, COMBAT_MODIFIERS.range[d.range]?.mod);
    push(COMBAT_MODIFIERS.targetRanged[d.tr]?.label, COMBAT_MODIFIERS.targetRanged[d.tr]?.mod);
  }
  push(COMBAT_MODIFIERS.visibility[d.vis]?.label, COMBAT_MODIFIERS.visibility[d.vis]?.mod);
  push(COMBAT_MODIFIERS.attacker[d.att]?.label, COMBAT_MODIFIERS.attacker[d.att]?.mod);
  if (d.surprise) push("Surprise attack", 20);
  if (prof.explosive && d.blast) push("Blast zone", 20);
  if (d.mod) push("Other", Number(d.mod));
  const type = grapple ? "skill" : "weapon";
  const key = grapple ? "unarmed_combat" : item.system.skill || "custom";
  let base;
  if (grapple) base = skillValue(actor, "unarmed_combat");
  else if (key === "custom") base = Number(item.system.customSkillTarget) || 0;
  else base = skillValue(actor, key) || statValue(actor, key) * 5;
  base += grapple ? 0 : Number(item.system.skillModifier) || 0;
  const mods = parts.map((p) => p.mod);
  // Applied by the roll itself (patches.mjs); listed so the total shown matches what gets rolled.
  if (!grapple && aimActive(actor)) parts.push({ label: "Aiming", mod: 20, auto: true });
  if (distracted(actor)) parts.push({ label: "Distracted", mod: -20, auto: true });
  const effectMod = Number(actor.system?.rollTarget?.allSkills) || 0;
  if (effectMod) parts.push({ label: "Conditions on the sheet", mod: effectMod, auto: true });
  const total = capAttackModifiers(parts.map((p) => p.mod));
  const raw = parts.reduce((a, p) => a + p.mod, 0);
  const target = Math.max(1, Math.min(99, base + total));
  const skillLabel = grapple ? "Unarmed Combat" : key === "custom" ? item.name : actor.system?.skills?.[key]?.label ?? actor.system?.typedSkills?.[key]?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  return { prof, parts, type, key, skillLabel, base, total, raw, capped: raw !== total, target, mods, calledKey };
}

/**
 * Make the attack. Returns the chat message.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} d        wizard choices
 * @param {object} [opts]
 * @param {TokenDocument[]} [opts.targets]
 * @param {TokenDocument} [opts.token]  attacker token
 */
export async function rollAttack(actor, item, d, { targets = null, token = null } = {}) {
  const targetDocs = targets ?? [...(game.user.targets ?? [])].map((t) => t.document).filter(Boolean);
  const c = computeAttack(actor, item, d);
  if (d.paySan && hasStatus(actor, STATUS.suppressed)) {
    await (await import("./sanity.mjs")).runForActor(actor, { fixedLoss: 1, category: "violence", source: "Braving suppressing fire" });
    await setStatus(actor, STATUS.suppressed, false);
  }
  const first = targetDocs[0];
  if (first && !c.prof.killRadius && targetConditions(first).helpless) return autoHit(actor, item, d, c, first, token);
  const { DGPercentileRoll } = rollClasses();
  const roll = new DGPercentileRoll("1D100", {}, { rollType: c.type, key: c.key, actor, item: c.type === "weapon" ? item : null, token: token ?? activeTokenDoc(actor) });
  roll.modifier += c.mods.reduce((a, b) => a + b, 0);
  roll.options.dgOps = { attack: true, mods: c.mods, fireMode: d.fireMode, called: c.calledKey, surprise: !!d.surprise, ammo: d.ammo, action: d.action === "called" ? "attack" : d.action, weaponId: item.id, targets: targetDocs.map((t) => t.uuid) };
  await roll.evaluate();
  const message = await roll.toChat();
  return message;
}

/** A helpless target is hit without a roll (p.55, p.53). */
async function autoHit(actor, item, d, c, targetDoc, token) {
  const ctx = { action: d.action === "called" ? "attack" : d.action, called: c.calledKey, fireMode: d.fireMode, ammo: d.ammo, surprise: false };
  const attack = buildAttack({ attacker: actor, tokenUuid: (token ?? activeTokenDoc(actor))?.uuid, item, ctx, outcome: { total: null, success: true, critical: false, fumble: false, auto: true }, prof: c.prof, tokens: [targetDoc], state: "ready" });
  const message = await postCard({
    actor,
    title: `${esc(item.name)}: automatic hit`,
    kind: "combat",
    body: `<p>${esc(targetDoc.name)} is helpless, so there's no roll: the attack simply lands (p.55).</p>`,
    flags: { [MODULE_ID]: { attack } },
  });
  await markActed(actor);
  await resolveRow(message, attack.order[0]);
  return message;
}

export async function attackAssistant(actor = null, { itemId = null, token = null } = {}) {
  actor ??= canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Select the token that's attacking.");
  if (!actor.itemTypes.weapon.some((w) => w.system.equipped !== false || w.id === itemId)) return ui.notifications.warn(`${actor.name} has no equipped weapons.`);
  const { openAttackWizard } = await import("../apps/attack-wizard.mjs");
  return openAttackWizard(actor, itemId, token);
}

/** Send weapon rolls from sheets and hotbar macros through the wizard (shift-click skips it). */
export function patchSheetRolls() {
  const seen = new Set();
  for (const type of ["agent", "npc", "unnatural"]) {
    for (const entry of Object.values(CONFIG.Actor.sheetClasses?.[type] ?? {})) {
      let proto = entry?.cls?.prototype;
      while (proto && !Object.prototype.hasOwnProperty.call(proto, "processRoll")) proto = Object.getPrototypeOf(proto);
      if (!proto || seen.has(proto)) continue;
      seen.add(proto);
      const orig = proto.processRoll;
      proto.processRoll = async function (event, roll) {
        if (wantsWizard(event, roll)) return attackAssistant(roll.actor ?? this.actor, { itemId: roll.item?.id, token: roll.options?.token ?? this.token ?? null });
        return orig.call(this, event, roll);
      };
    }
  }
  return seen.size > 0;
}

function wantsWizard(event, roll) {
  if (!setting("attackWizard")) return false;
  if (event?.shiftKey || event?.which === 3 || event?.button === 2) return false;
  if (roll?.type !== "weapon" || roll.options?.dgOps?.attack) return false;
  const actor = roll.actor;
  if (!actor) return false;
  if (actor.type !== "agent" && !setting("wizardForNpcs")) return false;
  return true;
}

/* ------------------------------------------------------------------------ */
/*  Attack rows on the chat card                                            */
/* ------------------------------------------------------------------------ */

function makeRow(tokenDoc, state, extra = {}) {
  return {
    tokenUuid: tokenDoc.uuid,
    name: tokenDoc.name ?? tokenDoc.actor?.name ?? "?",
    img: tokenDoc.texture?.src ?? tokenDoc.actor?.img ?? "icons/svg/mystery-man.svg",
    state,
    note: "",
    ...extra,
  };
}

function buildAttack({ attacker, tokenUuid, item, ctx, outcome, prof, tokens, state }) {
  const rows = {};
  const order = [];
  for (const t of tokens) {
    const id = foundry.utils.randomID(8);
    rows[id] = makeRow(t, state);
    order.push(id);
  }
  return {
    attackerUuid: attacker.uuid,
    tokenUuid: tokenUuid ?? null,
    itemUuid: item?.uuid ?? null,
    weaponId: item?.id ?? null,
    action: ctx.action ?? "attack",
    called: ctx.called ?? "none",
    fireMode: ctx.fireMode ?? "single",
    ammo: ctx.ammo ?? "std",
    surprise: !!ctx.surprise,
    melee: !!prof.melee,
    radius: prof.killRadius || 0,
    suppressOnly: !!prof.suppressOnly,
    outcome: { total: outcome.total, success: !!outcome.success, critical: !!outcome.critical, fumble: !!outcome.fumble, auto: !!outcome.auto },
    rows,
    order,
    primaryRow: order[0] ?? null,
    blastDone: false,
  };
}

/** Flag provider: every weapon (or grapple) roll gets attack rows for the roller's targets. */
export function attackFlagsFor(roll) {
  const ctx = roll.options?.dgOps ?? {};
  if (ctx.defense) return null;
  const grapple = ctx.action === "pin" || ctx.action === "disarm";
  if (roll.type !== "weapon" && !grapple) return null;
  const actor = roll.actor;
  if (!actor) return null;
  const item = roll.item ?? (ctx.weaponId ? actor.items.get(ctx.weaponId) : null);
  const prof = item ? weaponProfile(item, ctx) : { killRadius: 0, melee: true, suppressOnly: false };
  const o = outcomeOf(roll);
  const uuids = ctx.targets ?? [...(game.user.targets ?? [])].map((t) => t.document?.uuid).filter(Boolean);
  const tokens = uuids.map((u) => fromUuidSync(u, { strict: false })).filter(Boolean);
  const state = prof.killRadius ? "centre" : o.success ? "ready" : "missed";
  return { attack: buildAttack({ attacker: actor, tokenUuid: roll.options?.token?.uuid, item, ctx, outcome: o, prof, tokens, state }) };
}

function liveAttack(message) {
  const m = game.messages.get(message.id) ?? message;
  return m.getFlag(MODULE_ID, "attack");
}

async function patchRow(message, rowId, patch) {
  const p = {};
  for (const [k, v] of Object.entries(patch)) p[`attack.rows.${rowId}.${k}`] = v;
  return patchMessage(message, p);
}

function damageLabel(atk, item) {
  const prof = weaponProfile(item, atk);
  const crit = atk.outcome.critical || (atk.outcome.success && atk.surprise) || atk.called === "headShot";
  if (prof.lethal && prof.lethality > 0) return `Roll Lethality ${crit ? prof.lethality * 2 : prof.lethality}%`;
  const dmg = String(prof.damage || "").replace(/stun/i, "").trim();
  if (!dmg) return /stun/i.test(prof.damage ?? "") ? "Apply stun" : "Roll damage";
  return `Roll damage ${dmg}${strBonus(fromUuidSync(atk.attackerUuid, { strict: false }), prof.skill)}${crit ? " ×2" : ""}`;
}

const STATE_TEXT = {
  ready: "",
  resolving: "Resolving…",
  rolling: "Rolling…",
  centre: "Centre of the blast",
  missed: "Missed",
  hit: "Hit",
  dodged: "Dodged",
  blocked: "Blocked",
  foughtBack: "Fought back",
  done: "",
  suppressed: "Suppressed",
};

/** Render-time: draw the target rows on an attack card. */
export function renderAttackRows(message, element) {
  const atk = message.getFlag(MODULE_ID, "attack");
  if (!atk) return;
  element.querySelectorAll(".dg-result-actions").forEach((el) => el.remove());
  const attacker = fromUuidSync(atk.attackerUuid, { strict: false });
  const mayAttack = game.user.isGM || !!attacker?.isOwner;
  const item = atk.itemUuid ? fromUuidSync(atk.itemUuid, { strict: false }) : attacker?.items?.get(atk.weaponId);
  const btn = (action, label, args = {}, cls = "", tip = "") => `<button type="button" class="dgops-btn ${cls}" data-dgops="${action}" data-args='${esc(JSON.stringify(args))}'${tip ? ` data-tooltip="${esc(tip)}"` : ""}>${esc(label)}</button>`;
  const rows = atk.order.map((id) => [id, atk.rows[id]]).filter(([, r]) => r);
  const html = rows
    .map(([id, r]) => {
      let act = "";
      const note = r.note || STATE_TEXT[r.state] || "";
      if (mayAttack && r.state === "ready") act = btn("atkResolve", "Resolve", { row: id }, "primary", "Check how the target can defend, then see if it lands.");
      if (r.state === "defending") act = `<span class="dgops-quiet">Waiting for ${esc(r.who ?? "the defender")}…</span>${game.user.isGM ? btn("atkSkipDefence", "Skip", { row: id }, "subtle", "Handler: no defence, the attack lands.") : ""}`;
      if (mayAttack && r.state === "hit" && item) {
        act = btn("atkDamage", damageLabel(atk, item), { row: id }, "primary");
        if (r.helpless) act += btn("atkKill", "Kill", { row: id }, "", "A helpless target can be killed with one attack, no roll needed (p.55). The Handler may allow it.");
      }
      return `<div class="dgops-trow" data-state="${esc(r.state)}"><img src="${esc(r.img)}" alt=""><span class="dgops-trow__name">${esc(r.name)}${note ? `<small>${esc(note)}</small>` : ""}</span><span class="dgops-trow__act">${act}</span></div>`;
    })
    .join("");
  const head = [];
  if (mayAttack) {
    if (!rows.length) head.push(`<span class="dgops-quiet">No target.</span>${btn("atkUseTargets", "Use my targets", {}, "", "Target the token(s) you meant, then click.")}`);
    if (atk.radius && !atk.blastDone) head.push(btn("atkBlast", `Resolve the ${atk.radius} m ${atk.suppressOnly ? "suppression" : "blast"}`, {}, "primary", "Finds everyone in the radius and applies suppression."));
    const ready = rows.filter(([, r]) => r.state === "ready").length;
    const hit = rows.filter(([, r]) => r.state === "hit").length;
    if (ready > 1) head.push(btn("atkResolveAll", `Resolve all (${ready})`));
    if (hit > 1) head.push(btn("atkDamageAll", `Roll for all hit (${hit})`));
  }
  let host = element.querySelector(".dgops-atk");
  if (!host) {
    host = document.createElement("div");
    host.className = "dgops-atk";
    (element.querySelector(".dgops-card") ?? element.querySelector(".message-content") ?? element).append(host);
  }
  host.innerHTML = `${html}${head.length ? `<div class="dgops-buttons dgops-atk__head">${head.join("")}</div>` : ""}`;
}

registerAction("atkResolve", async ({ message, args }) => {
  await resolveRow(message, args.row);
  return false;
});

registerAction("atkResolveAll", async ({ message }) => {
  const atk = liveAttack(message);
  for (const id of atk.order) if (atk.rows[id]?.state === "ready") await resolveRow(message, id);
  return false;
});

registerAction("atkSkipDefence", async ({ message, args }) => {
  if (!game.user.isGM) return false;
  if (!(await claim(message, `attack.rows.${args.row}`, "defending", "resolving"))) return false;
  await landHit(message, args.row, { note: "No defence" });
  return false;
});

registerAction("atkDamage", async ({ message, args }) => {
  await rowDamage(message, args.row);
  return false;
});

registerAction("atkDamageAll", async ({ message }) => {
  const atk = liveAttack(message);
  for (const id of atk.order) if (atk.rows[id]?.state === "hit") await rowDamage(message, id);
  return false;
});

registerAction("atkKill", async ({ message, args }) => {
  if (!(await claim(message, `attack.rows.${args.row}`, "hit", "rolling"))) return false;
  const atk = liveAttack(message);
  const row = atk.rows[args.row];
  const token = await fromUuid(row.tokenUuid);
  const attacker = await fromUuid(atk.attackerUuid);
  await applyDamage(token.actor, Infinity, { source: `${attacker?.name ?? "Attack"}: killed while helpless`, attack: true, notes: ["Helpless: killed with a single attack (p.55)."] });
  await patchRow(message, args.row, { state: "done", note: "Killed" });
  return false;
});

registerAction("atkUseTargets", async ({ message }) => {
  const atk = liveAttack(message);
  const tokens = [...(game.user.targets ?? [])].map((t) => t.document).filter(Boolean);
  if (!tokens.length) {
    ui.notifications.warn("Target a token first (T while hovering, or double right-click).");
    return false;
  }
  const state = atk.radius ? "centre" : atk.outcome.success ? "ready" : "missed";
  const patch = {};
  const order = [...atk.order];
  for (const t of tokens.slice(0, atk.radius ? 1 : 1)) {
    const id = foundry.utils.randomID(8);
    patch[`attack.rows.${id}`] = makeRow(t, state);
    order.push(id);
  }
  patch["attack.order"] = order;
  patch["attack.primaryRow"] = atk.primaryRow ?? order[0];
  await patchMessage(message, patch);
  if (tokens.length > 1 && !atk.radius) ui.notifications.info("One attack, one target (p.54): using the first.");
  return false;
});

/* ------------------------------------------------------------------------ */
/*  Resolution                                                              */
/* ------------------------------------------------------------------------ */

/** Decide how an attack meets one target: automatic, against a guard, or by asking them to defend. */
export async function resolveRow(message, rowId) {
  if (!(await claim(message, `attack.rows.${rowId}`, "ready", "resolving"))) return;
  try {
    const atk = liveAttack(message);
    const row = atk.rows[rowId];
    const token = await fromUuid(row.tokenUuid);
    const target = token?.actor;
    if (!target) return patchRow(message, rowId, { state: "done", note: "Token no longer on the scene" });
    const melee = atk.melee;
    const c = targetConditions(token, { melee });
    if (c.dead) return patchRow(message, rowId, { state: "done", note: "Already dead" });
    if (c.helpless) return landHit(message, rowId, { note: "Helpless: no defence", helpless: true });
    if (c.guard) {
      const w = resolveOpposed(atk.outcome, c.guard, { bothFail: "a" });
      if (w !== "a") return patchRow(message, rowId, { state: "blocked", note: `Doesn't beat ${target.name}'s guard (${c.guard.total}): no harm` });
      return landHit(message, rowId, { note: `Beats their guard roll (${c.guard.total})` });
    }
    if (!setting("defensePrompts") || !["agent", "npc", "unnatural"].includes(target.type)) return landHit(message, rowId, {});
    const reason = cannotDefendReason({ ...c, surprise: atk.surprise, actedThisRound: c.acted });
    if (reason) return landHit(message, rowId, { note: `Can't defend: ${reason}` });
    const attacker = await fromUuid(atk.attackerUuid);
    if (!isPlayerActor(target) && setting("npcRolls") === "auto") {
      if (!melee) return landHit(message, rowId, {});
      const pick = npcDefence(target);
      return asRoller(target, () => runContinuation("defend", { attackMsgId: message.id, rowId, choice: pick.choice, fields: pick.fields }, { actor: target, user: game.user }));
    }
    await patchRow(message, rowId, { state: "defending", who: ownerNames(target) });
    await requestDefence(message, rowId, attacker, target, atk);
  } catch (e) {
    await patchRow(message, rowId, { state: "ready" });
    throw e;
  }
}

/** NPCs defending automatically: the better of Dodge and fighting back with their best melee weapon. */
function npcDefence(actor) {
  const dodge = skillValue(actor, "dodge");
  const weapons = actor.itemTypes.weapon.filter((w) => MELEE_SKILLS.has(w.system.skill) && w.system.equipped !== false);
  let best = null;
  for (const w of weapons) {
    const v = skillValue(actor, w.system.skill) + (Number(w.system.skillModifier) || 0);
    if (!best || v > best.v) best = { w, v };
  }
  if (best && best.v > dodge) return { choice: "fight", fields: { w: best.w.id, act: "attack" } };
  return { choice: "dodge", fields: {} };
}

async function requestDefence(message, rowId, attacker, target, atk) {
  const item = atk.itemUuid ? await fromUuid(atk.itemUuid) : null;
  const what = atk.action === "pin" ? "tries to pin you" : atk.action === "disarm" ? "tries to disarm you" : `attacks you${item ? ` with ${item.name}` : ""}`;
  const roll = atk.outcome.total ? ` (rolled ${atk.outcome.total}${atk.outcome.critical ? ", a critical" : ""})` : "";
  const args = { attackMsgId: message.id, rowId };
  if (atk.melee) {
    const melee = target.itemTypes.weapon.filter((w) => MELEE_SKILLS.has(w.system.skill) && w.system.equipped !== false);
    const unarmed = melee.find(isUnarmedItem);
    const weaponOpts = melee.map((w) => `<option value="${w.id}" ${w === (unarmed ?? melee[0]) ? "selected" : ""}>${esc(w.name)} (${skillValue(target, w.system.skill)}%)</option>`).join("") || `<option value="">Unarmed (${skillValue(target, "unarmed_combat")}%)</option>`;
    const fields = `<div class="dgops-inline-fields"><label>Fight back with <select name="w">${weaponOpts}</select></label>
      <label>to <select name="act"><option value="attack">attack</option><option value="called">make a called shot (−20%)</option><option value="pin">pin them</option><option value="disarm">disarm them</option></select></label></div>`;
    return requestAction(target, {
      title: `${target.name}: defend!`,
      kind: "combat",
      reason: `<p><b>${esc(attacker?.name ?? "Someone")}</b> ${esc(what)}${roll}. Defending uses your action this turn, and your roll also stands against any other hand-to-hand attacks this turn (p.53).</p>`,
      fields,
      blocking: false,
      direct: null,
      choices: [
        { label: `Dodge (${skillValue(target, "dodge")}%)`, icon: "fas fa-person-running", run: "defend", args: { ...args, choice: "dodge" }, tip: "Win the opposed roll and you take no harm." },
        { label: "Fight back", icon: "fas fa-hand-fist", run: "defend", args: { ...args, choice: "fight" }, primary: false, tip: "Win and your chosen action hits them instead. Pin and disarm need Unarmed Combat." },
        { label: "Take it", run: "defend", args: { ...args, choice: "none" }, primary: false },
      ],
    });
  }
  const fields = `<div class="dgops-inline-fields"><label>Cover nearby <select name="cover"><option value="5">wall, thick door, car body (5)</option><option value="10">concrete, thick wall (10)</option><option value="15">sandbags, big rock (15)</option></select></label></div>`;
  return requestAction(target, {
    title: `${target.name}: incoming!`,
    kind: "combat",
    reason: `<p><b>${esc(attacker?.name ?? "Someone")}</b> ${esc(what)}${roll}. Nobody dodges bullets, but if cover is close you can Dodge to scramble behind it (p.54).</p>`,
    fields,
    blocking: false,
    direct: null,
    choices: [
      { label: `Dodge for cover (${skillValue(target, "dodge")}%)`, icon: "fas fa-person-running", run: "defend", args: { ...args, choice: "cover" } },
      { label: "No cover: take it", run: "defend", args: { ...args, choice: "none" }, primary: false },
    ],
  });
}

/** The defender's choice, rolled on their client. */
registerContinuation("defend", async ({ attackMsgId, rowId, choice, fields = {} }, ctx) => {
  const message = game.messages.get(attackMsgId);
  const atk = message?.getFlag(MODULE_ID, "attack");
  const row = atk?.rows?.[rowId];
  if (!row || !["defending", "resolving"].includes(row.state)) {
    ui.notifications.info("That attack has already been resolved.");
    return { late: true };
  }
  const defender = ctx.actor;
  if (choice === "none") {
    await landHit(message, rowId, { note: `${defender.name} takes it` });
    return { label: "Took it" };
  }
  let res;
  let act = "dodge";
  let weapon = null;
  if (choice === "dodge" || choice === "cover") {
    res = await systemTest(defender, { type: "skill", key: "dodge", context: { defense: true } });
  } else {
    act = fields.act || "attack";
    weapon = fields.w ? defender.items.get(fields.w) : null;
    if (act === "pin" || act === "disarm") res = await systemTest(defender, { type: "skill", key: "unarmed_combat", context: { defense: true, action: act } });
    else if (weapon) res = await systemTest(defender, { type: "weapon", key: weapon.system.skill, item: weapon, modifier: act === "called" ? -20 : 0, context: { defense: true } });
    else res = await systemTest(defender, { type: "skill", key: "unarmed_combat", modifier: act === "called" ? -20 : 0, context: { defense: true } });
  }
  await markActed(defender);
  if (atk.melee) await setGuard(defender, res.outcome, choice);
  const o = res.outcome;
  const w = resolveOpposed(atk.outcome, o, { bothFail: "a" });
  const label = choice === "fight" ? "fight back" : "Dodge";
  if (w === "a") {
    await landHit(message, rowId, { note: `${defender.name}'s ${label} (${o.total}) doesn't stop it` });
    return { outcome: o };
  }
  if (choice === "dodge") {
    await patchRow(message, rowId, { state: "dodged", note: `${defender.name} dodges (${o.total}): no harm` });
  } else if (choice === "cover") {
    const cover = Number(fields.cover) || 5;
    const token = await fromUuid(row.tokenUuid);
    if (token) await update(token, { [`flags.${MODULE_ID}.cover`]: cover, [`flags.${MODULE_ID}.protection`]: "cover" });
    await setStatus(defender, STATUS.cover, true);
    await landHit(message, rowId, { note: `Reached cover (${o.total}): armor ${cover}`, cover });
  } else {
    await patchRow(message, rowId, { state: "foughtBack", note: `${defender.name} fights back (${o.total})` });
    const attacker = await fromUuid(atk.attackerUuid);
    await fightBackWins(defender, attacker, act, weapon, o);
  }
  return { outcome: o };
});

/** The attack has landed on this row's target. Pins and disarms take effect; otherwise wait for damage. */
async function landHit(message, rowId, { note = "", cover = 0, helpless = false } = {}) {
  const atk = liveAttack(message);
  const row = atk.rows[rowId];
  const token = await fromUuid(row.tokenUuid);
  const target = token?.actor;
  const attacker = await fromUuid(atk.attackerUuid);
  if (atk.action === "pin" && target) {
    await pin(attacker, target);
    return patchRow(message, rowId, { state: "done", note: [note, "Pinned"].filter(Boolean).join(". ") });
  }
  if (atk.action === "disarm" && target) {
    await patchRow(message, rowId, { state: "done", note: [note, "Disarmed"].filter(Boolean).join(". ") });
    const result = await disarmFlow(attacker, target);
    return patchRow(message, rowId, { note: [note, result].filter(Boolean).join(". ") });
  }
  return patchRow(message, rowId, { state: "hit", note: note || "Hit", cover, helpless });
}

async function pin(by, target) {
  await setStatus(target, STATUS.pinned, true);
  await update(target, { [`flags.${MODULE_ID}.pinnedBy`]: by?.uuid ?? null });
  if (by) {
    await update(by, { [`flags.${MODULE_ID}.pinning`]: target.uuid });
    // An Agent who has successfully pinned a target can't defend (p.54).
    await clearGuard(by);
  }
}

async function fightBackWins(defender, attacker, act, weapon, outcome) {
  if (!attacker) return;
  if (act === "pin") {
    await pin(defender, attacker);
    return postCard({ actor: defender, title: "Fought back: pinned", kind: "combat", body: `<p>${esc(defender.name)} blocks and pins ${esc(attacker.name)}.</p>` });
  }
  if (act === "disarm") {
    const result = await disarmFlow(defender, attacker);
    return postCard({ actor: defender, title: "Fought back: disarmed", kind: "combat", body: `<p>${esc(defender.name)} blocks. ${esc(result)}.</p>` });
  }
  const item = weapon ?? defender.itemTypes.weapon.find(isUnarmedItem) ?? defender.itemTypes.weapon.find((w) => MELEE_SKILLS.has(w.system.skill));
  const aToken = activeTokenDoc(attacker);
  if (!item || !aToken) {
    return postCard({ actor: defender, title: "Fought back", kind: "combat", body: `<p>${esc(defender.name)} blocks${aToken ? "" : ` and hits back (place ${esc(attacker.name)}'s token to roll damage)`}.</p>` });
  }
  const prof = weaponProfile(item, { action: "attack" });
  const attack = buildAttack({ attacker: defender, tokenUuid: activeTokenDoc(defender)?.uuid, item, ctx: { action: "attack", called: act === "called" ? "partial" : "none" }, outcome, prof, tokens: [aToken], state: "hit" });
  attack.rows[attack.order[0]].note = "Fought back";
  return postCard({ actor: defender, title: `${esc(defender.name)} fights back`, kind: "combat", body: `<p>The block turns into a counter against ${esc(attacker.name)}.</p>`, flags: { [MODULE_ID]: { attack } } });
}

/**
 * Successful disarm: the disarmer chooses to take the weapon or knock it to the ground. If they take
 * it, the Handler confirms which weapon it was and it moves to the disarmer's sheet.
 */
export async function disarmFlow(disarmer, victim) {
  if (!disarmer || !victim) return "Disarmed";
  const r = await askOwner(disarmer, {
    title: "Disarmed them!",
    content: `<p>${esc(victim.name)} drops what they were holding (p.50). Grab it as it falls (the Handler's call), or leave it on the ground?</p>`,
    buttons: [
      { action: "take", label: "Grab it (Handler's call)", default: true },
      { action: "drop", label: "Leave it on the ground" },
    ],
  });
  const weapons = victim.itemTypes.weapon.filter((w) => !isUnarmedItem(w));
  if (r?.action !== "take") {
    await postCard({ actor: disarmer, title: "Disarmed", kind: "combat", body: `<p>${esc(victim.name)}'s weapon hits the ground. Picking it up takes a turn.</p>` });
    return "Weapon knocked to the ground";
  }
  if (!weapons.length) {
    await postCard({ actor: disarmer, title: "Disarmed", kind: "combat", body: `<p>${esc(victim.name)} has no weapon on their sheet to take. Handler: hand over whatever they were holding.</p>` });
    return "Disarmed (no weapon on their sheet)";
  }
  let weapon = weapons.length === 1 ? weapons[0] : null;
  if (!weapon) {
    const g = activeGM();
    const choicesHtml = weapons.map((w, i) => `<label class="dgops-radio"><input type="radio" name="w" value="${w.id}" ${w.system.equipped !== false && !weapons.slice(0, i).some((x) => x.system.equipped !== false) ? "checked" : ""}> ${esc(w.name)}${w.system.equipped === false ? " <em>(not equipped)</em>" : ""}</label>`).join("");
    const ans = g ? await callUser(g.id, "prompt", [{ title: `Which weapon did ${victim.name} lose?`, content: `<p>${esc(disarmer.name)} took it. It moves to their sheet.</p>${choicesHtml}`, buttons: [{ action: "ok", label: "Move it", default: true }] }]) : null;
    weapon = victim.items.get(ans?.data?.w) ?? weapons.find((w) => w.system.equipped !== false) ?? weapons[0];
  }
  await gm("gmTransferItem", victim.uuid, weapon.id, disarmer.uuid);
  await postCard({ actor: disarmer, title: "Disarmed", kind: "combat", body: `<p>${esc(disarmer.name)} takes ${esc(victim.name)}'s <b>${esc(weapon.name)}</b>. It's on their sheet now.</p>` });
  return `${disarmer.name} took the ${weapon.name}`;
}

registerHandler("gmTransferItem", async (fromUuid_, itemId, toUuid) => {
  const from = await fromUuid(fromUuid_);
  const to = await fromUuid(toUuid);
  const item = from?.items?.get(itemId);
  if (!item || !to) return false;
  const data = item.toObject();
  delete data._id;
  data.system = { ...(data.system ?? {}), equipped: true };
  await to.createEmbeddedDocuments("Item", [data]);
  await from.deleteEmbeddedDocuments("Item", [itemId]);
  return true;
});

/* ------------------------------------------------------------------------ */
/*  Damage                                                                  */
/* ------------------------------------------------------------------------ */

async function rowDamage(message, rowId) {
  if (!(await claim(message, `attack.rows.${rowId}`, "hit", "rolling"))) return;
  try {
    const atk = liveAttack(message);
    const row = atk.rows[rowId];
    const attacker = await fromUuid(atk.attackerUuid);
    const item = (atk.itemUuid ? await fromUuid(atk.itemUuid) : null) ?? attacker?.items?.get(atk.weaponId);
    const token = await fromUuid(row.tokenUuid);
    if (!item || !token?.actor) return patchRow(message, rowId, { state: "done", note: "Nothing to apply" });
    const prof = weaponProfile(item, atk);
    let critical = atk.outcome.critical || (atk.outcome.success && atk.surprise) || atk.called === "headShot";
    let critMode = "double";
    if (critical && setting("optionalCritEffects")) {
      const r = await prompt({ title: "Critical hit", content: field("Effect", `<select name="m">${options(OPTIONAL_CRIT_EFFECTS)}</select>`) });
      critMode = r?.data?.m ?? "double";
    }
    const summary = await applyHit({ attacker, item, prof, token, critical, critMode, atk, cover: row.cover, primary: !atk.radius || rowId === atk.primaryRow, fromKillRadius: !!atk.radius });
    await patchRow(message, rowId, { state: "done", note: summary });
  } catch (e) {
    await patchRow(message, rowId, { state: "hit" });
    throw e;
  }
}

/** Roll and apply one hit. Dice land before anything changes. Returns a one-line summary. */
async function applyHit({ attacker, item, prof, token, critical, critMode = "double", atk = {}, cover = 0, primary = true, fromKillRadius = false }) {
  const actor = token.actor;
  const protection = cover ? "cover" : protectionOf(token);
  const coverArmor = cover || coverOf(token);
  const armor = bodyArmor(actor);
  const ap = primary || !prof.explosive ? prof.ap : 0;
  const lines = [];
  const rolls = [];
  const called = CALLED_SHOTS[atk.called] ?? CALLED_SHOTS.none;
  let amount = 0;
  let killed = false;
  let summary = "";

  if (prof.lethal && prof.lethality > 0) {
    const lr = await evalFormula("1d100");
    rolls.push(lr);
    const res = resolveLethality({ rating: prof.lethality, total: lr.total, attackCritical: critical && critMode === "double", protection, bodyArmor: armor, cover: coverArmor, ap });
    lines.push(`Lethality ${res.rating}%: rolled ${lr.total} → ${res.killed ? "<b>LETHAL</b>" : `${res.dice.join(" + ")}`}${res.note ? ` (${esc(res.note)})` : ""}`);
    killed = res.killed;
    amount = res.damage;
    // Book shortcut (p.57): untracked humans caught in a kill radius are simply dead or out of it.
    if (!killed && fromKillRadius && actor.isToken && actor.type === "npc" && setting("npcMooks")) killed = true;
    summary = killed ? "Lethal" : `${amount} damage`;
  } else {
    let formula = String(prof.damage || "0").trim();
    if (/stun/i.test(formula) && !/\d/.test(formula)) {
      await setStatus(actor, STATUS.stun, true);
      await postCard({ actor: attacker, title: `${esc(item?.name ?? "Attack")} → ${esc(token.name)}`, kind: "combat", body: `<p>${esc(token.name)} is stunned.</p>` });
      return "Stunned";
    }
    formula = formula.replace(/stun/gi, "").trim() || "0";
    const bonus = strBonus(attacker, prof.skill);
    let f = `${formula}${bonus}`;
    if (critical && critMode === "double") f = `2*(${f})`;
    const dr = await evalFormula(f);
    rolls.push(dr);
    const res = resolveNormalDamage({ rolled: Math.max(0, dr.total), protection, bodyArmor: armor, cover: coverArmor, ap, hollowPoint: atk.ammo === "hp", apAmmo: atk.ammo === "ap", fleshWound: called.effect === "fleshWound" });
    lines.push(`${esc(f)} = ${dr.total}${res.note ? ` (${esc(res.note)})` : ""} → <b>${res.killed ? "0 HP" : res.damage}</b>`);
    killed = res.killed;
    amount = res.damage;
    summary = killed ? "Lethal" : amount ? `${amount} damage${res.note ? ` (${res.note})` : ""}` : `No damage${res.note ? ` (${res.note})` : ""}`;
  }
  if (critical) lines.push(`Critical hit${critMode !== "double" ? `: ${esc(OPTIONAL_CRIT_EFFECTS[critMode])}` : ""}.`);
  const stun = called.effect === "stun" || (critical && critMode === "stun");
  if (critical && critMode === "prone") await setStatus(actor, STATUS.prone, true);
  await applyDamage(actor, killed ? Infinity : amount, { source: `${attacker?.name ?? "Attack"}: ${item?.name ?? "attack"}`, attack: true, stun, notes: lines, rolls });
  return summary;
}

/* ------------------------------------------------------------------------ */
/*  Kill radius and suppression (pp.57–58)                                  */
/* ------------------------------------------------------------------------ */

registerAction("atkBlast", async ({ message }) => {
  const atk = liveAttack(message);
  if (atk.blastDone) return false;
  let centreId = atk.order.find((id) => atk.rows[id]?.state === "centre") ?? atk.order[0];
  let centre = centreId ? await fromUuid(atk.rows[centreId].tokenUuid) : null;
  if (!centre) {
    centre = [...(game.user.targets ?? [])][0]?.document ?? null;
    if (!centre) {
      ui.notifications.warn("Target the token at the centre of the blast, then click again.");
      return false;
    }
    centreId = null;
  }
  const radius = atk.radius;
  const inside = canvas.scene.tokens.filter((t) => t.actor && distanceBetween(centre, t) <= radius + 0.01);
  const hit = atk.outcome.success && !atk.suppressOnly;
  const patch = { "attack.blastDone": true };
  const order = centreId ? [centreId] : [];
  const stateFor = (t) => (hit ? "ready" : atk.suppressOnly && atk.outcome.success && atk.outcome.critical && t.id === centre.id ? "hit" : atk.outcome.success ? "suppressed" : "missed");
  if (centreId) patch[`attack.rows.${centreId}.state`] = stateFor(centre);
  for (const t of inside) {
    if (centreId && t.uuid === atk.rows[centreId].tokenUuid) continue;
    const id = foundry.utils.randomID(8);
    patch[`attack.rows.${id}`] = makeRow(t, stateFor(t));
    order.push(id);
    if (!centreId && t.uuid === centre.uuid) patch["attack.primaryRow"] = id;
  }
  if (!centreId && !inside.some((t) => t.uuid === centre.uuid)) {
    const id = foundry.utils.randomID(8);
    patch[`attack.rows.${id}`] = makeRow(centre, stateFor(centre));
    order.unshift(id);
    patch["attack.primaryRow"] = id;
  }
  patch["attack.order"] = order;
  await patchMessage(message, patch);
  // Suppression: anyone who knows they're inside an intended kill radius goes to ground (p.57).
  const suppressed = [];
  if (setting("suppression") && !(atk.suppressOnly && !atk.outcome.success)) {
    for (const t of inside) {
      const a = t.actor;
      if (!["agent", "npc"].includes(a?.type)) continue;
      if ([STATUS.dead, STATUS.unconscious, STATUS.unaware, STATUS.helpless].some((s) => hasStatus(a, s))) continue;
      if (a.type === "agent" && isAdapted(a, "violence")) continue;
      await setStatus(a, STATUS.suppressed, true);
      suppressed.push(a.name);
    }
  }
  if (suppressed.length) {
    await postCard({
      title: "Suppressed",
      kind: "combat",
      body: `<p>${suppressed.map(esc).join(", ")} ${suppressed.length > 1 ? "are" : "is"} inside the kill radius. Their next action must be to get to cover or go prone — or stifle the terror for 1 SAN (p.57). The turn reminder offers the choice.</p>`,
    });
  }
  return false;
});

export async function suppressChoice(actor, choice) {
  if (choice === "act") {
    await (await import("./sanity.mjs")).runForActor(actor, { fixedLoss: 1, category: "violence", source: "Braving suppressing fire" });
  } else if (choice === "prone") {
    await setStatus(actor, STATUS.prone, true);
  } else {
    await setStatus(actor, STATUS.cover, true);
  }
  await setStatus(actor, STATUS.suppressed, false);
}

registerAction("suppressChoice", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  await suppressChoice(actor, args.c);
  return { cover: "Got to cover", prone: "Went prone", act: "Acted anyway (−1 SAN)" }[args.c];
});

/* ------------------------------------------------------------------------ */
/*  After any attack roll: ammo, aim, guard                                 */
/* ------------------------------------------------------------------------ */

export async function onAttackRolled(roll) {
  const ctx = roll.options?.dgOps ?? {};
  const actor = roll.actor;
  if (!actor || ctx.defense) return;
  const grapple = ctx.action === "pin" || ctx.action === "disarm";
  if (roll.type !== "weapon" && !grapple) return;
  const item = roll.item ?? (ctx.weaponId ? actor.items.get(ctx.weaponId) : null);
  // Aim is spent by the attack.
  if (actor.getFlag(MODULE_ID, "aim")) await update(actor, { [`flags.${MODULE_ID}.-=aim`]: null });
  await setStatus(actor, STATUS.aiming, false);
  await markActed(actor);
  // A hand-to-hand attack roll opposes incoming melee until the attacker's next turn (p.54).
  const melee = grapple || (item && MELEE_SKILLS.has(item.system.skill));
  if (melee && combatRound()) await setGuard(actor, outcomeOf(roll), ctx.action ?? "attack");
  else await clearGuard(actor);
  // Ammunition
  if (setting("ammo") && item && RANGED_SKILLS.has(item.system.skill) && item.system.skill !== "athletics") {
    const cap = capacityOf(item);
    if (cap) {
      const use = FIRE_MODES[ctx.fireMode ?? "single"]?.ammo ?? 1;
      const cur = item.getFlag(MODULE_ID, "rounds") ?? cap;
      const after = Math.max(0, cur - use);
      await update(item, { [`flags.${MODULE_ID}.rounds`]: after });
      if (cur < use) ui.notifications.warn(`${item.name}: only ${cur} rounds left for a ${use}-round attack.`);
      else if (after === 0) ui.notifications.info(`${item.name} is empty. Reloading takes an action.`);
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  Aim, cover, protection, escape, reload                                  */
/* ------------------------------------------------------------------------ */

export async function aim(actor) {
  const cr = combatRound();
  await update(actor, { [`flags.${MODULE_ID}.aim`]: cr ?? { combatId: null, round: 0 } });
  await setStatus(actor, STATUS.aiming, true);
  await markActed(actor);
  await postCard({ actor, title: "Aim", kind: "combat", body: `<p>${esc(actor.name)} spends the turn aiming: +20% to their attack next turn. Lost if they're hurt first (p.50).</p>` });
}

export async function setCover(tokenDoc) {
  const r = await prompt({
    title: `Cover — ${tokenDoc.name}`,
    content: `${field("Cover armor", `<select name="c"><option value="0">No cover</option><option value="5">5 — wall, thick door, makeshift vehicle cover</option><option value="10">10 — thick wall, concrete, moderate rock</option><option value="15">15 — reinforced wall, big rock, sandbags</option><option value="20">20 — heavy vehicle armor</option></select>`)}`,
  });
  if (!r) return;
  const c = Number(r.data.c) || 0;
  await update(tokenDoc, { [`flags.${MODULE_ID}.cover`]: c, [`flags.${MODULE_ID}.protection`]: c ? "cover" : null });
  if (tokenDoc.actor) await setStatus(tokenDoc.actor, STATUS.cover, c > 0);
  if (tokenDoc.actor && c) await setStatus(tokenDoc.actor, STATUS.suppressed, false);
}

export async function setProtection(tokenDocs, protection) {
  for (const t of tokenDocs) await update(t, { [`flags.${MODULE_ID}.protection`]: protection === "auto" ? null : protection });
}

/** Escape a pin (p.51): STR×5 or Unarmed Combat, opposed by whoever holds them. */
export async function escapePin(actor) {
  const pinnerUuid = actor.getFlag(MODULE_ID, "pinnedBy");
  const pinner = pinnerUuid ? await fromUuid(pinnerUuid) : null;
  const best = (a) => (statValue(a, "str") * 5 > skillValue(a, "unarmed_combat") ? { type: "stat", key: "str" } : { type: "skill", key: "unarmed_combat" });
  const mine = await systemTest(actor, { ...best(actor), context: { escape: true } });
  let theirs = null;
  if (pinner) theirs = await testFor(pinner, { ...best(pinner), context: { opposed: true } }, { title: `${pinner.name}: hold on to ${actor.name}`, reason: `<p>${esc(actor.name)} is trying to break your pin (rolled ${mine.outcome.total}).</p>` });
  const winner = theirs ? resolveOpposed(mine.outcome, theirs, { bothFail: "b" }) : mine.outcome.success ? "a" : "b";
  if (winner === "a") {
    await setStatus(actor, STATUS.pinned, false);
    await update(actor, { [`flags.${MODULE_ID}.-=pinnedBy`]: null });
    if (pinner) await update(pinner, { [`flags.${MODULE_ID}.-=pinning`]: null });
    // The escape roll also defends against all attackers this turn.
    await setGuard(actor, mine.outcome, "escape");
  }
  await markActed(actor);
  await postCard({ actor, title: "Escape", kind: "combat", body: `<p>${esc(actor.name)} ${winner === "a" ? "breaks free. The escape roll also stands against attacks this turn" : "stays pinned"}.</p>` });
  return winner === "a";
}

export async function reload(actor) {
  const ranged = actor.itemTypes.weapon.filter((w) => capacityOf(w));
  if (!ranged.length) return ui.notifications.info("No weapons with a magazine capacity.");
  const r = await prompt({
    title: `Reload — ${actor.name}`,
    content: field("Weapon", `<select name="w">${ranged.map((w) => `<option value="${w.id}">${esc(w.name)} (${w.getFlag(MODULE_ID, "rounds") ?? capacityOf(w)}/${capacityOf(w)})</option>`).join("")}</select>`),
  });
  if (!r) return;
  const w = actor.items.get(r.data.w);
  await update(w, { [`flags.${MODULE_ID}.rounds`]: capacityOf(w) });
  await markActed(actor);
  await postCard({ actor, title: "Reload", kind: "combat", body: `<p>${esc(actor.name)} reloads ${esc(w.name)}.</p>` });
}

/* ------------------------------------------------------------------------ */
/*  Turn hooks                                                              */
/* ------------------------------------------------------------------------ */

export async function onCombatTurn(combat, changed) {
  if (!game.user.isActiveGM || !("turn" in changed || "round" in changed)) return;
  const c = combat.combatant;
  const actor = c?.actor;
  if (!actor) return;
  // The actor's own turn: rolls kept from their last action stop counting.
  const guard = actor.getFlag(MODULE_ID, "guard");
  if (guard && (guard.combatId !== combat.id || guard.round < combat.round)) await clearGuard(actor);
  const aimFlag = actor.getFlag(MODULE_ID, "aim");
  if (aimFlag?.combatId === combat.id && combat.round > aimFlag.round + 1) {
    await update(actor, { [`flags.${MODULE_ID}.-=aim`]: null });
    await setStatus(actor, STATUS.aiming, false);
  }
  const lines = [];
  const btns = [];
  if (hasStatus(actor, STATUS.stun) && setting("stunPrompt")) {
    lines.push("Stunned: can't act. Roll CON×5 to act normally next turn (p.55).");
    btns.push(button("stunRecover", "CON×5 to recover", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: `stun-${combat.round}` }));
  }
  if (hasStatus(actor, STATUS.unconscious)) lines.push("Unconscious and helpless.");
  if (hasStatus(actor, STATUS.pinned)) {
    lines.push("Pinned: the only possible action is to escape (STR×5 or Unarmed Combat, opposed).");
    btns.push(button("escapePin", "Try to escape", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: `esc-${combat.round}` }));
  }
  if (hasStatus(actor, STATUS.suppressed)) {
    lines.push("Suppressed: this action must be to get to cover or go prone — or stifle the terror for 1 SAN.");
    for (const [k, l] of [
      ["cover", "Get to cover"],
      ["prone", "Go prone"],
      ["act", "Act anyway (−1 SAN)"],
    ])
      btns.push(button("suppressChoice", l, { args: { actorUuid: actor.uuid, c: k }, owner: actor.uuid, once: `sup-${combat.round}` }));
  }
  if (hasStatus(actor, STATUS.tempInsane)) lines.push("Temporarily insane: the Handler directs this action (flee, struggle or submit).");
  const flee = actor.getFlag(MODULE_ID, "fleeTurns");
  if (flee > 0) {
    lines.push(`Fleeing: ${flee} turn(s) left before collapsing exhausted.`);
    await update(actor, { [`flags.${MODULE_ID}.fleeTurns`]: flee - 1 });
    if (flee - 1 <= 0) await update(actor, { "system.physical.exhausted": true });
  }
  if (hasStatus(actor, STATUS.onFire)) {
    const { fireTick } = await import("./hazards.mjs");
    await fireTick(actor);
  }
  if (actor.getFlag(MODULE_ID, "suffocation")) {
    const { suffocationTick } = await import("./hazards.mjs");
    await suffocationTick(actor);
  }
  if (lines.length) await postCard({ actor, title: `${esc(actor.name)}'s turn`, kind: "combat", body: list(lines) + (btns.length ? `<div class="dgops-buttons">${btns.join("")}</div>` : ""), whisper: actor.hasPlayerOwner ? null : gmWhisper() });
}

/** When a fight ends, nothing from it should linger. */
export async function onCombatEnd(combat) {
  if (!game.user.isActiveGM) return;
  for (const c of combat.combatants ?? []) {
    const a = c.actor;
    if (!a) continue;
    if (a.getFlag(MODULE_ID, "guard")) await clearGuard(a);
    const data = {};
    for (const k of ["acted", "aim", "fightIncidents"]) if (a.getFlag(MODULE_ID, k) !== undefined) data[`flags.${MODULE_ID}.-=${k}`] = null;
    if (Object.keys(data).length) await update(a, data);
    await setStatus(a, STATUS.aiming, false);
  }
}

registerAction("escapePin", async ({ args }) => {
  await escapePin(await fromUuid(args.actorUuid));
  return "Rolled";
});

/** Initiative: DEX countdown with an optional tiebreaker (p.50). */
export function patchInitiative() {
  const cls = CONFIG.Combatant.documentClass;
  const orig = cls.prototype._getInitiativeFormula;
  if (!orig) return warn("Combatant#_getInitiativeFormula not found; tiebreaks disabled.");
  cls.prototype._getInitiativeFormula = function () {
    const base = orig.call(this);
    const mode = setting("initiativeTiebreak");
    if (mode === "random") return `${base} + 1d100/1000`;
    if (mode === "agents") return `${base} + ${this.actor?.type === "agent" ? 0.5 : 0}`;
    if (mode === "npcs") return `${base} + ${this.actor?.type === "agent" ? 0 : 0.5}`;
    return base;
  };
  if (setting("initiativeTiebreak") !== "none") CONFIG.Combat.initiative.decimals = 3;
}

export { capAttackModifiers, outcomeBadge };
