/**
 * Delta Green: Ops Automation — entry point.
 */
import { MODULE_ID, SYSTEM_ID, STATUS, log, warn } from "./core/constants.mjs";
import { registerSettings, registerCampaignSettings, setting } from "./core/settings.mjs";
import { initSocket } from "./core/socket.mjs";
import { applyPatches, onRoll, addFlagProvider } from "./core/patches.mjs";
import { renderRequest, renderGroup, onRequestUpdated } from "./core/requests.mjs";
import { onRenderMessage, button, registerAction } from "./core/chat.mjs";
import { processDue, events, schedule } from "./core/scheduler.mjs";
import * as clock from "./features/clock.mjs";
import { hasSystemRolls } from "./core/system.mjs";
import { filterDamage } from "./core/extensions.mjs";
import * as sanity from "./features/sanity.mjs";
import * as combat from "./features/combat.mjs";
import * as injury from "./features/injury.mjs";
import * as hazards from "./features/hazards.mjs";
import * as tests from "./features/tests.mjs";
import * as wellbeing from "./features/wellbeing.mjs";
import * as downtime from "./features/downtime.mjs";
import * as money from "./features/money.mjs";
import * as qol from "./features/qol.mjs";
import { openConsole } from "./apps/console.mjs";
import { openChase, renderChase, startChase } from "./apps/chase.mjs";
import { resolveNormalDamage, resolveLethality } from "./rules/combat.mjs";
import { OpsSettingsMenu, openSettings } from "./apps/settings.mjs";
import { openWelcome, shouldWelcome } from "./apps/welcome.mjs";
import { openKit, decorateSheetHeader, CONDITION_TEXT } from "./apps/kit.mjs";
import { openNpcBuilder, createNpcs } from "./apps/npc-builder.mjs";
import "./core/snapshot.mjs";
import * as impossibleLandscapes from "./campaigns/il/index.mjs";

const TESTED_SYSTEM = "2.0.1";

Hooks.once("init", () => {
  if (game.system.id !== SYSTEM_ID) return;
  registerSettings();
  registerCampaignSettings();
  if (setting("ilCampaign")) impossibleLandscapes.init();
  const icon = (n) => `modules/${MODULE_ID}/assets/icons/${n}.svg`;
  const statuses = [
    { id: STATUS.pinned, name: "Pinned", img: icon("pinned") },
    { id: STATUS.suppressed, name: "Suppressed", img: icon("suppressed") },
    { id: STATUS.onFire, name: "On fire", img: icon("on-fire") },
    { id: STATUS.tempInsane, name: "Temporarily insane", img: icon("temp-insane") },
    { id: STATUS.breakdown, name: "Emotional breakdown (WP 1–2)", img: icon("breakdown") },
    { id: STATUS.lostControl, name: "Lost control (0 WP)", img: icon("lost-control") },
    { id: STATUS.unaware, name: "Unaware", img: icon("unaware") },
    { id: STATUS.cover, name: "In cover", img: icon("cover") },
    { id: STATUS.suffocating, name: "Suffocating", img: icon("suffocating") },
    { id: STATUS.distracted, name: "Distracted (−20% next test)", img: icon("distracted") },
    { id: STATUS.aiming, name: "Aiming (+20% next attack)", img: icon("aiming") },
    { id: STATUS.guard, name: "Guarding (melee roll stands)", img: icon("guard") },
    { id: STATUS.helpless, name: "Helpless (bound or asleep)", img: icon("helpless") },
  ];
  for (const s of statuses) if (!CONFIG.statusEffects.some((e) => e.id === s.id)) CONFIG.statusEffects.push(s);
  // Plain-language descriptions on every status the module uses (shown by Foundry and in the Ops Kit).
  for (const e of CONFIG.statusEffects) if (CONDITION_TEXT[e.id] && !e.description) e.description = CONDITION_TEXT[e.id][1];
  qol.registerKeybindings();
  game.settings.registerMenu(MODULE_ID, "opsSettings", {
    name: "Delta Green Ops",
    label: "Open Ops settings",
    hint: "Every rule the module automates, grouped by area, with presets.",
    icon: "fas fa-sliders",
    type: OpsSettingsMenu,
    restricted: false,
  });
});

Hooks.once("setup", () => {
  if (game.system.id !== SYSTEM_ID) return;
  combat.patchInitiative();
});

Hooks.once("ready", async () => {
  if (game.system.id !== SYSTEM_ID) {
    warn("Delta Green system not active; module idle.");
    return;
  }
  if (game.system.version !== TESTED_SYSTEM && game.user.isGM) {
    ui.notifications.warn(`Delta Green Ops was built against Delta Green ${TESTED_SYSTEM}; this world runs ${game.system.version}. Check the roll automation before play.`, { permanent: true });
  }
  initSocket();
  // Mirror the system's sheet style so our paper and typeface match it.
  try {
    document.body.classList.add(`dgops-style-${game.settings.get(SYSTEM_ID, "characterSheetStyle") || "program"}`);
  } catch {
    document.body.classList.add("dgops-style-program");
  }
  if (!hasSystemRolls() || !applyPatches()) return;
  if (!wellbeing.patchRest()) warn("Could not wrap the agent sheet's Rest action.");

  addFlagProvider((roll) => combat.attackFlagsFor(roll));
  if (!combat.patchSheetRolls()) warn("Could not find the Delta Green sheets' roll handler; the attack wizard opens from the Ops Kit and token HUD only.");

  onRoll((roll, message) => combat.onAttackRolled(roll, message));
  onRoll((roll, message) => tests.fumbleHook(roll, message));
  onRoll((roll) => tests.consumeDistraction(roll));
  onRoll((roll, message) => sanity.wpPerTestHook(roll, message));
  onRoll((roll) => hazards.complicationsHook(roll));

  if (game.user.isActiveGM && !events().some((e) => e.type === "daily")) {
    const t = game.time.worldTime;
    await schedule({ type: "daily", due: t + 86400 - (((t % 86400) + 86400) % 86400), label: "Daily upkeep (stat recovery, recuperation, addiction)" });
  }

  game.modules.get(MODULE_ID).api = {
    openConsole,
    clockText: clock.clockText,
    setClock: clock.setClock,
    setClockDialog: clock.setClockDialog,
    addReminder: clock.addReminder,
    reminderDialog: clock.reminderDialog,
    openChase,
    sanTest: sanity.sanTest,
    sanDialog: sanity.sanDialog,
    assignDisorder: sanity.assignDisorder,
    repress: sanity.repress,
    destroyedUnnatural: sanity.destroyedUnnatural,
    attackAssistant: combat.attackAssistant,
    aim: combat.aim,
    setCover: combat.setCover,
    reload: combat.reload,
    escapePin: combat.escapePin,
    suppressChoice: combat.suppressChoice,
    disarmFlow: combat.disarmFlow,
    startChase,
    sanGroupCard: sanity.sanGroupCard,
    openNpcBuilder,
    createNpcs,
    effectDialog: qol.effectDialog,
    applySituationalEffect: qol.applySituationalEffect,
    clearSituational: qol.clearSituational,
    damageDialog: qol.damageDialog,
    healDialog: qol.healDialog,
    toggleCondition: qol.toggleCondition,
    teamReport: qol.teamReport,
    homeSceneDialog: qol.homeSceneDialog,
    endHome: downtime.endHome,
    afterTheCrisis: qol.afterTheCrisis,
    backupAll: qol.backupAll,
    backupActor: qol.backupActor,
    restoreBackup: qol.restoreBackup,
    vehicleDialog: hazards.vehicleDialog,
    selected: qol.selectedActors,
    team: qol.team,
    actingActor: qol.actingActor,
    STATUS,
    applyDamage: injury.applyDamage,
    hazardDialog: hazards.hazardDialog,
    medicalDialog: hazards.medicalDialog,
    firstAid: hazards.firstAid,
    startPoison: hazards.startPoison,
    startDisease: hazards.startDisease,
    tempStatLoss: hazards.tempStatLoss,
    opposedDialog: tests.opposedDialog,
    groupDialog: tests.groupDialog,
    runPursuit: downtime.runPursuit,
    firedFlow: downtime.firedFlow,
    prosecutionFlow: downtime.prosecutionFlow,
    requisitionDialog: money.requisitionDialog,
    interrogationDialog: money.interrogationDialog,
    feedAddiction: wellbeing.feedAddiction,
    openKit,
    openSettings,
    openWelcome,
  };
  if (setting("ilCampaign")) game.modules.get(MODULE_ID).api.il = impossibleLandscapes.api();
  if (shouldWelcome()) openWelcome();
  qol.dailyBackup();
  log("ready");
});

/* ---------------- Hooks ---------------- */

Hooks.on("updateWorldTime", (worldTime) => {
  if (game.system.id === SYSTEM_ID) processDue(worldTime);
});

Hooks.on("updateActor", (actor, changed) => {
  if (game.system.id !== SYSTEM_ID || !game.user.isActiveGM) return;
  if (foundry.utils.hasProperty(changed, "system.wp")) sanity.syncWpState(actor);
});

Hooks.on("updateCombat", (combat_, changed) => {
  if (game.system.id === SYSTEM_ID) combat.onCombatTurn(combat_, changed);
});

Hooks.on("deleteCombat", (combat_) => {
  if (game.system.id === SYSTEM_ID) combat.onCombatEnd(combat_);
});

/* Lowering SAN by hand goes through the SAN pipeline (projection, insanity, Breaking Point). */
Hooks.on("preUpdateActor", (actor, changed, options, userId) => {
  if (game.system.id !== SYSTEM_ID) return;
  try {
    sanity.interceptManualSan(actor, changed, options, userId);
  } catch (e) {
    warn(e);
  }
});

/* Someone answered a roll request: wake up whoever is waiting on it. */
Hooks.on("updateChatMessage", (message) => {
  if (game.system.id === SYSTEM_ID) onRequestUpdated(message);
});

Hooks.on("renderChatMessageHTML", (message, element) => {
  if (game.system.id !== SYSTEM_ID) return;
  const info = message.getFlag(MODULE_ID, "roll");
  for (const fn of [
    () => info && decorateSystemCard(message, element, info),
    () => renderRequest(message, element),
    () => renderGroup(message, element),
    () => combat.renderAttackRows(message, element),
    () => renderChase(message, element),
    () => qol.markWaiting(message, element),
    () => qol.addNudge(message, element),
  ]) {
    try {
      fn();
    } catch (e) {
      warn(e);
    }
  }
  onRenderMessage(message, element);
});

function appendButtons(element, html) {
  const host = document.createElement("div");
  host.className = "dgops-buttons dgops-inline";
  host.innerHTML = html;
  (element.querySelector(".message-content") ?? element).append(host);
}

function decorateSystemCard(message, element, info) {
  const canAct = game.user.isGM || message.isAuthor;
  if (!canAct) return;
  if (info.percentile && info.type === "sanity" && !info.context?.sanTest && !info.context?.home && !info.context?.repress && !info.context?.sleep && !info.context?.relapse && !info.context?.dgBondTest) {
    appendButtons(element, button("applySanToRoll", "Apply SAN loss to this roll", { once: "san" }));
  }
  if (info.sanityDamage) appendButtons(element, button("sanFromDamageCard", "Run SAN test for selected tokens"));
  if (message.getFlag(MODULE_ID, "attack")) return;
  if (info.damage && info.itemUuid && !info.context?.applied) appendButtons(element, button("applyDamageCard", "Apply to targets (armor & protection)", { once: "apply" }));
  if (info.lethality && info.itemUuid) appendButtons(element, button("applyLethalityCard", "Apply Lethality to targets", { once: "apply" }));
}

async function targetsFor(info) {
  const uuids = info.targets?.length ? info.targets : [...game.user.targets].map((t) => t.document.uuid);
  return uuids.map((u) => fromUuidSync(u, { strict: false })).filter((t) => t?.actor);
}

registerAction("applyDamageCard", async ({ message }) => {
  const info = message.getFlag(MODULE_ID, "roll");
  const total = message.rolls?.[0]?.total ?? info.total ?? 0;
  const item = await fromUuid(info.itemUuid);
  const targets = await targetsFor(info);
  if (!targets.length) {
    ui.notifications.warn("Target a token first.");
    return false;
  }
  for (const t of targets) {
    const raw = resolveNormalDamage({ rolled: total, protection: combat.protectionOf(t), bodyArmor: Number(t.actor.system.health?.protection ?? 0), cover: combat.coverOf(t), ap: Number(item?.system?.armorPiercing) || 0 });
    const res = filterDamage({ actor: t.actor, kind: "damage", rolled: total, res: raw });
    await injury.applyDamage(t.actor, res.killed ? Infinity : res.damage, { source: item?.name ?? "Damage", attack: true, notes: res.note ? [res.note] : [] });
  }
  return `Applied to ${targets.map((t) => t.name).join(", ")}`;
});

registerAction("applyLethalityCard", async ({ message }) => {
  const info = message.getFlag(MODULE_ID, "roll");
  const item = await fromUuid(info.itemUuid);
  const targets = await targetsFor(info);
  if (!targets.length) {
    ui.notifications.warn("Target a token first.");
    return false;
  }
  for (const t of targets) {
    const raw = resolveLethality({ rating: info.rating, total: info.total, protection: combat.protectionOf(t), bodyArmor: Number(t.actor.system.health?.protection ?? 0), cover: combat.coverOf(t), ap: Number(item?.system?.armorPiercing) || 0 });
    const res = filterDamage({ actor: t.actor, kind: "lethality", rolled: info.total, res: raw });
    await injury.applyDamage(t.actor, res.killed ? Infinity : res.damage, { source: item?.name ?? "Lethality", attack: true, notes: [res.note].filter(Boolean) });
  }
  return `Applied to ${targets.map((t) => t.name).join(", ")}`;
});

/* ---------------- Scene controls & token HUD ---------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  if (game.system.id !== SYSTEM_ID) return;
  const tools = [
    { name: "dgopsConsole", title: "Delta Green Ops: Handler Console", icon: "fas fa-folder-open", visible: game.user.isGM && setting("consoleButton"), fn: openConsole },
    { name: "dgopsAttack", title: "Delta Green Ops: Attack", icon: "fas fa-crosshairs", visible: true, fn: () => combat.attackAssistant() },
    { name: "dgopsOpposed", title: "Delta Green Ops: Opposed test", icon: "fas fa-people-arrows", visible: true, fn: () => tests.opposedDialog() },
  ];
  if (Array.isArray(controls)) {
    const token = controls.find((c) => c.name === "token");
    for (const t of tools) token?.tools.push({ name: t.name, title: t.title, icon: t.icon, button: true, visible: t.visible, onClick: t.fn });
    return;
  }
  const token = controls.tokens ?? controls.token;
  if (!token) return;
  let order = Object.keys(token.tools ?? {}).length + 10;
  for (const t of tools) {
    token.tools[t.name] = { name: t.name, title: t.title, icon: t.icon, button: true, visible: t.visible, order: order++, onChange: () => t.fn() };
  }
});

Hooks.on("renderTokenHUD", (hud, html) => {
  if (game.system.id !== SYSTEM_ID) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const col = root?.querySelector(".col.right");
  const tokenDoc = hud.object?.document ?? hud.document;
  const actor = tokenDoc?.actor;
  if (!col || !actor || !["agent", "npc", "unnatural"].includes(actor.type)) return;
  const items = [
    ["attack", "fas fa-crosshairs", "Attack"],
    ["aim", "fas fa-bullseye", "Aim (+20% next attack)"],
    ["cover", "fas fa-shield-halved", "Cover"],
    ["reload", "fas fa-rotate", "Reload"],
  ];
  if (actor.statuses?.has(STATUS.pinned)) items.push(["escape", "fas fa-person-running", "Escape the pin"]);
  for (const [k, icon, title] of items) {
    const b = document.createElement("div");
    b.className = "control-icon dgops-hud";
    b.dataset.tooltip = title;
    b.innerHTML = `<i class="${icon}"></i>`;
    b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (k === "attack") await combat.attackAssistant(actor);
      if (k === "aim") await combat.aim(actor);
      if (k === "cover") await combat.setCover(tokenDoc);
      if (k === "reload") await combat.reload(actor);
      if (k === "escape") await combat.escapePin(actor);
    });
    col.append(b);
  }
});

/* Who has acted, whose melee roll still stands. */
Hooks.on("renderCombatTracker", (app, html) => {
  if (game.system.id !== SYSTEM_ID) return;
  try {
    qol.renderTrackerMarks(app, html);
  } catch (e) {
    warn(e);
  }
});
/* Keep the Console's roster current (debounced). */
let consoleTimer = null;
Hooks.on("updateActor", (actor) => {
  if (actor.type !== "agent") return;
  const c = foundry.applications.instances.get("dgops-console");
  if (!c?.rendered) return;
  clearTimeout(consoleTimer);
  consoleTimer = setTimeout(() => c.rendered && c.render(), 250);
});
Hooks.on("updateActor", (actor, changed) => {
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) && game.combat?.combatants?.some?.((c) => c.actor === actor)) ui.combat?.render?.();
});

/* Ops Kit button on sheet title bars. */
Hooks.on("renderDocumentSheetV2", (app, element) => {
  if (game.system.id !== SYSTEM_ID) return;
  try {
    decorateSheetHeader(app, element);
  } catch (e) {
    warn(e);
  }
});

/* Keep the Console's "For" row in step with token selection. */
Hooks.on("controlToken", () => {
  const c = foundry.applications.instances.get("dgops-console");
  if (c?.rendered) c.render();
});

/* Strike through broken Bonds on agent sheets. */
Hooks.on("renderActorSheetV2", (app, element) => {
  const actor = app.actor ?? app.document;
  if (actor?.type !== "agent") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  for (const bond of actor.itemTypes.bond) {
    if (!bond.getFlag(MODULE_ID, "broken")) continue;
    root?.querySelectorAll(`[data-item-id="${bond.id}"]`).forEach((el) => el.classList.add("dgops-broken-bond"));
  }
});

export { setting, registerAction };
