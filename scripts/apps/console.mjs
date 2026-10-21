/**
 * Handler Console.
 *
 * Left: the team roster. Each Agent is a card with portrait, HP/WP/SAN bars, conditions and what
 * needs attention. Click a card to act on that Agent (selected tokens win if there are any).
 * Top: the game clock, operation priority, the catastrophe queue and quick time buttons.
 * Right: Actions (grouped tiles), Home scene, Clock & queue, and a How do I… guide.
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { esc, options } from "../core/ui.mjs";
import { setWorld, hasStatus } from "../core/ops.mjs";
import { events, cancel, formatDue } from "../core/scheduler.mjs";
import { PURSUITS } from "../rules/home.mjs";
import { PROTECTION } from "../rules/combat.mjs";
import { DGOpsApp, btn } from "./base.mjs";
import { setting } from "../core/settings.mjs";
import { activeAgents, playerOwners } from "../core/team.mjs";
import * as sanity from "../features/sanity.mjs";
import * as combat from "../features/combat.mjs";
import * as hazards from "../features/hazards.mjs";
import * as tests from "../features/tests.mjs";
import * as downtime from "../features/downtime.mjs";
import * as money from "../features/money.mjs";
import * as wellbeing from "../features/wellbeing.mjs";
import * as qol from "../features/qol.mjs";
import { openChase } from "./chase.mjs";
import { analyzeActor } from "../features/readiness.mjs";

const agents = () => activeAgents();

const selectedActorsRaw = () => canvas?.tokens?.controlled?.map((t) => t.actor).filter(Boolean) ?? [];
const selectedTokensRaw = () => canvas?.tokens?.controlled?.map((t) => t.document) ?? [];
let picked = new Set();

/** Selected tokens win; otherwise the Agents picked on the roster. */
const selectedActors = () => {
  const sel = selectedActorsRaw();
  if (sel.length) return sel;
  return [...picked].map((u) => fromUuidSync(u)).filter(Boolean);
};
const selectedTokens = () => {
  const sel = selectedTokensRaw();
  if (sel.length) return sel;
  return selectedActors().map((a) => a.getActiveTokens?.(true, true)?.[0]?.document ?? a.getActiveTokens?.(true, true)?.[0]).filter(Boolean);
};

/** In-game clock, as the world's calendar (if any) or days and time since the start. */
function clockText() {
  const t = game.time.worldTime;
  try {
    const c = game.time.calendar;
    if (c?.timeToComponents && c?.format) return c.format(t);
  } catch {
    /* fall back */
  }
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `Day ${d + 1}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Actions: [action, label, icon, hint, needs] — needs: "agents" | "tokens" | null. */
const TILES = {
  "Sanity & Bonds": [
    ["toolSan", "SAN test", "fas fa-brain", "Post a SAN card. Each player rolls their own.", null],
    ["toolDestroyed", "Unnatural destroyed", "fas fa-sun", "Restore SAN to those who put it down (p.75).", null],
    ["toolCrisis", "After the crisis", "fas fa-people-group", "Delta Green Bond tests for queued catastrophes (p.37).", null],
  ],
  Rolls: [
    ["toolOpposed", "Opposed test", "fas fa-people-arrows", "Select one token, target another.", null],
    ["toolGroup", "Group test", "fas fa-users", "Who rolls? Best, worst or everyone (p.43).", "agents"],
  ],
  Combat: [
    ["toolAttack", "Attack", "fas fa-crosshairs", "Attack window for the selected token.", null],
    ["toolNpc", "NPC builder", "fas fa-user-plus", "Make NPCs on the spot, tokens and all.", null],
    ["toolUnaware", "Unaware", "fas fa-eye-slash", "Toggle: can be surprised.", "tokens"],
    ["toolHelpless", "Helpless", "fas fa-handcuffs", "Toggle: hit automatically, can be killed.", "tokens"],
    ["toolCover", "Cover", "fas fa-shield-halved", "Set cover armour.", "tokens"],
    ["toolDamage", "Damage", "fas fa-droplet", "Damage with or without armour.", "agents"],
    ["toolHeal", "Heal", "fas fa-heart-pulse", "Give HP back.", "agents"],
    ["toolEffect", "Situational effect", "fas fa-smog", "Pepper spray, tear gas, drunk… with a duration.", "agents"],
  ],
  "Hazards & medicine": [
    ["toolHazard", "Hazard", "fas fa-triangle-exclamation", "Falls, fire, cold, poison, disease.", "agents"],
    ["toolMedical", "Medical care", "fas fa-kit-medical", "First Aid, treatment, recuperation.", "agents"],
    ["toolVehicle", "Collision", "fas fa-car-burst", "Ramming and crashes.", null],
    ["toolChase", "Pursuit", "fas fa-person-running", "Post a Pursuit card.", null],
  ],
  Operation: [
    ["toolMoney", "Gear & money", "fas fa-sack-dollar", "Do we have it, requisition, black market.", null],
    ["toolInterrogate", "Interrogation", "fas fa-comments", "Select the interrogator, target the subject.", null],
    ["toolReport", "Team status", "fas fa-clipboard-list", "Whisper yourself everyone's numbers.", null],
    ["toolBackup", "Back up Agents", "fas fa-box-archive", "Copy every Agent to Ops: Agent backups.", null],
  ],
};

export class HandlerConsole extends DGOpsApp {
  static BANNER = "Handler console";

  static DEFAULT_OPTIONS = {
    id: "dgops-console",
    classes: ["dgops-console-app"],
    window: { title: "Delta Green Ops — Handler Console", icon: "fas fa-folder-open", resizable: true },
    position: { width: 940, height: 720 },
  };

  tab = "actions";
  open = new Set();

  async renderBody() {
    const tabs = { actions: "Actions", home: "Home scene", queue: "Clock & queue", guide: "How do I…" };
    const q = (game.settings.get(MODULE_ID, "queue")?.catastrophes ?? []).length;
    const nav = `<nav class="dgops-filetabs">${Object.entries(tabs)
      .map(([k, v]) => `<a data-dgops-app="tab" data-tab="${k}" class="${this.tab === k ? "on" : ""}">${v}${k === "queue" && q ? ` <span class="count">${q}</span>` : ""}</a>`)
      .join("")}<a class="gear" data-dgops-app="settings" data-tooltip="Ops settings"><i class="fas fa-sliders"></i></a></nav>`;
    let body = "";
    if (this.tab === "actions") body = this.renderActions();
    if (this.tab === "home") body = this.renderHome();
    if (this.tab === "queue") body = this.renderQueue();
    if (this.tab === "guide") body = this.renderGuide();
    return `<div class="dgops-panel dgops-console">
      ${this.renderTop(q)}
      <div class="dgops-console__body">
        <aside class="dgops-roster">${this.renderRoster()}</aside>
        <main class="dgops-console__main">${nav}<section class="dgops-sheet">${body}</section></main>
      </div>
    </div>`;
  }

  /* ---- Top strip ---- */
  renderTop(q) {
    const prio = game.settings.get(MODULE_ID, "opPriority");
    return `<header class="dgops-console__top">
      <span class="dgops-clock" data-tooltip="Game time"><i class="fas fa-clock"></i> ${esc(clockText())}</span>
      <span class="dgops-quick">${[["+10 min", 600], ["+1 h", 3600], ["+1 day", 86400]].map(([l, s]) => btn("advance", l, { s }, "subtle")).join("")}</span>
      <label class="dgops-prio" data-tooltip="Operation priority: ±20% to requisitions">Priority <select data-dgops-change="prio">${options({ low: "Low", normal: "Normal", high: "High" }, prio)}</select></label>
      ${q ? `<a class="dgops-alertchip" data-dgops-app="tab" data-tab="queue"><i class="fas fa-bell"></i> ${q} catastrophe${q > 1 ? "s" : ""} queued</a>` : ""}
    </header>`;
  }

  async change_prio(el) {
    await setWorld("opPriority", el.value);
    ui.notifications.info(`Operation priority: ${el.value}.`);
  }

  /* ---- Roster ---- */
  renderRoster() {
    const list = agents();
    const sel = selectedActorsRaw();
    const head = sel.length
      ? `<div class="dgops-roster__for on"><i class="fas fa-crosshairs"></i> Acting on ${sel.length} selected token${sel.length > 1 ? "s" : ""}</div>`
      : `<div class="dgops-roster__for">${picked.size ? `Acting on ${picked.size} Agent${picked.size > 1 ? "s" : ""}` : "Click Agents to act on them"} ${list.length ? `<a data-dgops-app="pickAll">${list.every((a) => picked.has(a.uuid)) ? "none" : "all"}</a>` : ""}</div>`;
    const cards = list.map((a) => this.agentCard(a)).join("");
    return `${head}<div class="dgops-roster__list">${cards || `<p class="dgops-empty">No Agents on the team. Give players Owner permission on their Agents, or pick the team in Ops settings → Team.</p>`}</div>
      <div class="dgops-roster__foot">${btn("teamSettings", '<i class="fas fa-users-gear"></i> Who\'s on the team', {}, "subtle")}</div>`;
  }

  agentCard(a) {
    const s = a.system;
    const bar = (cls, v, max, mark = null) => `<span class="bar ${cls}" data-tooltip="${cls.toUpperCase()} ${v}/${max}${mark != null ? ` · BP ${mark}` : ""}"><i style="width:${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%"></i>${mark != null ? `<b style="left:${Math.max(0, Math.min(100, (mark / Math.max(1, max)) * 100))}%"></b>` : ""}<em>${v}</em></span>`;
    const pend = (a.getFlag(MODULE_ID, "pendingDisorders") ?? []).length;
    const damaged = a.itemTypes.bond.filter((b) => b.system.hasBeenDamagedSinceLastHomeScene).length;
    const conds = [...(a.statuses ?? [])].map((id) => CONFIG.statusEffects.find((e) => e.id === id)).filter(Boolean);
    const acute = sanity.disordersOf(a, { activeOnly: true }).filter((m) => m.system.acuteEpisode);
    const flags = [];
    if (pend) flags.push(`<span class="flag bad" data-tooltip="Reached the Breaking Point: assign a disorder">Disorder ×${pend}</span>`);
    if (acute.length) flags.push(`<span class="flag warn" data-tooltip="${esc(acute.map((m) => m.name).join(", "))}">Acute</span>`);
    if (s.sanity?.value - (s.sanity?.currentBreakingPoint ?? 0) <= 5) flags.push(`<span class="flag warn" data-tooltip="Within 5 of the Breaking Point">Near BP</span>`);
    if (damaged) flags.push(`<span class="flag" data-tooltip="Damaged since the last Home scene">${damaged} Bond${damaged > 1 ? "s" : ""} hurt</span>`);
    const owner = playerOwners(a).map((u) => u.name).join(", ");
    const on = picked.has(a.uuid);
    const open = this.open.has(a.uuid);
    const detail = open ? this.agentDetail(a) : "";
    return `<div class="dgops-agent ${on ? "on" : ""}" data-uuid="${a.uuid}">
      <div class="dgops-agent__row" data-dgops-app="pick" data-uuid="${a.uuid}">
        <img src="${esc(a.img)}" alt="">
        <div class="dgops-agent__id"><b>${esc(a.name)}</b><small>${owner ? esc(owner) : "no player"}</small></div>
        <span class="dgops-agent__icons">${conds.map((c) => `<img src="${esc(c.img)}" data-tooltip="${esc(c.name)}" alt="">`).join("")}</span>
      </div>
      <div class="dgops-agent__bars">${bar("hp", s.health.value, s.health.max)}${bar("wp", s.wp.value, s.wp.max)}${bar("san", s.sanity.value, s.sanity.max ?? 99, s.sanity.currentBreakingPoint)}</div>
      ${flags.length ? `<div class="dgops-agent__flags">${flags.join("")}</div>` : ""}
      <div class="dgops-agent__tools">
        <a data-dgops-app="sheet" data-uuid="${a.uuid}" data-tooltip="Sheet"><i class="fas fa-file-lines"></i></a>
        <a data-dgops-app="kit" data-uuid="${a.uuid}" class="dgops-kit-link" data-status="${analyzeActor(a).status}" data-tooltip="Ops Kit"><i class="fas fa-briefcase-medical"></i></a>
        <a data-dgops-app="toggleOpen" data-uuid="${a.uuid}" data-tooltip="${open ? "Less" : "More"}"><i class="fas fa-chevron-${open ? "up" : "down"}"></i></a>
      </div>
      ${detail}
    </div>`;
  }

  agentDetail(a) {
    const s = a.system;
    const bonds = a.itemTypes.bond.map((b) => `<li class="${b.getFlag(MODULE_ID, "broken") ? "broken" : b.system.hasBeenDamagedSinceLastHomeScene ? "hurt" : ""}">${esc(b.name)} <b>${b.system.score}</b></li>`).join("");
    const adapt = ["violence", "helplessness"].map((c) => `${c[0].toUpperCase() + c.slice(1)}: ${sanity.isAdapted(a, c) ? "adapted" : `${Object.values(s.sanity.adaptations?.[c] ?? {}).filter((v) => v === true).length}/3`}`).join(" · ");
    const pend = (a.getFlag(MODULE_ID, "pendingDisorders") ?? []).length;
    const addicted = sanity.disordersOf(a, { activeOnly: true }).some((m) => sanity.disorderDef(m)?.addiction);
    return `<div class="dgops-agent__detail">
      <ul class="dgops-agent__bonds">${bonds || "<li class='dgops-quiet'>No Bonds</li>"}</ul>
      <p class="dgops-quiet">${esc(adapt)}</p>
      <div class="dgops-buttons">${btn("agentSan", "SAN test", { uuid: a.uuid })}${pend ? btn("agentDisorder", "Assign disorder", { uuid: a.uuid }, "primary") : ""}${btn("agentWp", "+1 WP", { uuid: a.uuid })}${addicted ? btn("agentFeed", "Feed addiction", { uuid: a.uuid }) : ""}${btn("agentMoney", "Gear & money", { uuid: a.uuid })}</div>
    </div>`;
  }

  on_pick(ds, ev) {
    if (ev?.target?.closest?.("a")) return;
    if (picked.has(ds.uuid)) picked.delete(ds.uuid);
    else picked.add(ds.uuid);
    this.render();
  }

  on_pickAll() {
    const all = agents().map((a) => a.uuid);
    picked = all.every((u) => picked.has(u)) ? new Set() : new Set(all);
    this.render();
  }

  on_toggleOpen(ds) {
    if (this.open.has(ds.uuid)) this.open.delete(ds.uuid);
    else this.open.add(ds.uuid);
    this.render();
  }

  async on_teamSettings() {
    (await import("./settings.mjs")).openSettings("team");
  }

  on_tab(ds) {
    this.tab = ds.tab;
    this.render();
  }

  /* ---- Actions ---- */
  renderActions() {
    const who = selectedActors();
    const whoText = who.length ? who.map((a) => esc(a.name)).join(", ") : "nobody picked";
    const groups = Object.entries(TILES)
      .map(
        ([g, tiles]) => `<section class="dgops-tiles"><h3>${esc(g)}</h3><div class="dgops-tiles__grid">${tiles
          .map(([act, label, icon, hint, needs]) => {
            const missing = needs && !who.length;
            return `<button type="button" class="dgops-tile ${missing ? "needs" : ""}" data-dgops-app="${act}" data-tooltip="${esc(hint)}${missing ? " — pick Agents or select tokens first" : ""}"><i class="${icon}"></i><span>${esc(label)}</span></button>`;
          })
          .join("")}</div></section>`,
      )
      .join("");
    const prot = Object.fromEntries([["auto", "Auto"], ...PROTECTION.map((p) => [p, p[0].toUpperCase() + p.slice(1)])]);
    return `<p class="dgops-acting">For: <b>${whoText}</b></p>
      ${groups}
      <section class="dgops-tiles"><h3>Protection</h3><div class="dgops-inline-fields"><select name="prot">${options(prot)}</select>${btn("toolProtection", "Set for selected tokens")}</div></section>`;
  }

  /* ---- Home ---- */
  renderHome() {
    const optional = setting("illicitCash");
    const pursuitOpts = Object.fromEntries(Object.entries(PURSUITS).filter(([, p]) => optional || !p.optional).map(([k, p]) => [k, p.label]));
    const rows = agents()
      .map((a) => {
        const w = downtime.whatChanged(a);
        const changes = [];
        if (w.sanLog.length) changes.push(`SAN lost: ${w.sanLog.reduce((s, e) => s + e.loss, 0)} over ${w.sanLog.length} incident(s)`);
        if (w.damaged.length) changes.push(`Damaged Bonds: ${w.damaged.map((b) => esc(b.name)).join(", ")}: describe how each relationship has deteriorated`);
        if (w.broken.length) changes.push(`Broken Bonds: ${w.broken.map((b) => esc(b.name)).join(", ")}`);
        if (w.pending.length) changes.push(`<b>Breaking Point reached ${w.pending.length}×</b>: assign disorder(s)`);
        if (w.injuries.length) changes.push(`Permanent injuries: ${w.injuries.map((i) => esc(i.text)).join(", ")}: describe them`);
        if (a.getFlag(MODULE_ID, "reviews")?.length) changes.push(`Official review pending (${a.getFlag(MODULE_ID, "reviews").length})`);
        const done = a.getFlag(MODULE_ID, "homePursuit");
        return `<div class="dgops-home-row"><h4><img src="${esc(a.img)}" alt="">${esc(a.name)}${done ? ` <small class="dgops-quiet">did ${esc(PURSUITS[done.id]?.label ?? done.id)}</small>` : ""}</h4>
          ${changes.length ? `<ul class="dgops-list">${changes.map((c) => `<li>${c}</li>`).join("")}</ul>` : `<p class="dgops-quiet">Nothing new to account for.</p>`}
          <div class="dgops-inline-fields"><select name="p-${a.id}">${options(pursuitOpts)}</select>${btn("homeRun", "Send to player", { uuid: a.uuid, id: a.id }, "primary")}
          ${w.pending.length ? btn("agentDisorder", "Assign disorder", { uuid: a.uuid }) : ""}${btn("homeFired", "Job on the line", { uuid: a.uuid }, "subtle")}${btn("homeProsecute", "Prosecution", { uuid: a.uuid }, "subtle")}${btn("homeReview", "Official review", { uuid: a.uuid }, "subtle")}</div>
        </div>`;
      })
      .join("");
    return `<p class="dgops-lede">Months pass between operations. Take stock of what changed, then each player plays one pursuit (pp.78–81). <i>Send to player</i> gives them a card to play it on their own screen.</p>
      <div class="dgops-buttons">${btn("homeHandOut", '<i class="fas fa-paper-plane"></i> Hand out pursuits to everyone')}</div>
      ${rows || `<p class="dgops-empty">No Agents on the team.</p>`}
      <div class="dgops-buttons">${btn("homeEnd", "End the Home scene", {}, "primary")}<span class="dgops-quiet">Clears damaged-Bond marks; Agents are backed up first.</span></div>`;
  }

  /* ---- Clock & queue ---- */
  renderQueue() {
    const q = game.settings.get(MODULE_ID, "queue")?.catastrophes ?? [];
    const evs = events().sort((a, b) => a.due - b.due);
    return `<h3>Game time</h3>
      <p class="dgops-clockbig"><i class="fas fa-clock"></i> ${esc(clockText())}</p>
      <div class="dgops-buttons">${[["1 turn", 6], ["10 min", 600], ["1 hour", 3600], ["8 hours", 28800], ["1 day", 86400], ["1 week", 604800]].map(([l, s]) => btn("advance", `+${l}`, { s })).join("")}</div>
      <p class="dgops-quiet">Poison, disease, cold, situational effects, sleep limits, addiction, temporary stats and recuperation run on game time.</p>
      <h3>Delta Green Bond tests (p.37)</h3>
      ${q.length ? `<table class="dgops-table">${q.map((c) => `<tr><td>${esc(c.name)} ${esc(c.what)}</td><td>${c.present.length} present</td><td class="dgops-actions">${btn("queueResolve", "After the crisis: roll", { id: c.id }, "primary")}${btn("queueDrop", "Drop", { id: c.id }, "subtle")}</td></tr>`).join("")}</table>` : `<p class="dgops-empty">Nothing queued.</p>`}
      <h3>Scheduled</h3>
      ${evs.length ? `<table class="dgops-table">${evs.map((e) => `<tr><td>${esc(e.label || e.type)}</td><td>${formatDue(e.due)}</td><td class="dgops-actions">${e.type === "daily" ? "" : btn("eventCancel", "Cancel", { id: e.id }, "subtle")}</td></tr>`).join("")}</table>` : `<p class="dgops-empty">No scheduled events.</p>`}`;
  }

  /* ---- Guide ---- */
  renderGuide() {
    const items = [
      ["Something horrible happens", "Pick the Agents on the roster (or select their tokens) → SAN test → choose the threat. A SAN card goes to chat: each player clicks to roll their own (you can click for anyone who's away). Projection, insanity, Breaking Point and adaptation follow from each roll."],
      ["Someone's SAN was lowered by hand", "Typing a lower SAN on an Agent's sheet runs it as a SAN loss: the player is offered projection, and insanity and the Breaking Point are checked. Undo on the card puts it back."],
      ["A player rolled SAN from their sheet", "Click Apply SAN loss on that roll's card and pick the threat. The roll they already made is used."],
      ["A fight breaks out", "Players target an enemy and click a weapon on their sheet. The attack window walks them through it, and the attack card lists each target with a Resolve button. Targets defend from their own card; damage is rolled from the same row."],
      ["I need NPCs right now", "Actions → NPC builder (or the macro). Pick an archetype and how dangerous they are; weapons and armour come from the system's compendiums, and the tokens land in the middle of your view."],
      ["Who sees a roll?", "The roll-mode selector above the chat box decides, for the module's rolls as for the system's. Each card's header says who can see it."],
      ["Someone is hurt", "Damage cards handle stun, unconsciousness, death and permanent injury. For care, use Medical care: First Aid once per injury, treatment weekly, recuperation daily."],
      ["Poison, disease, a fall, fire, cold", "Actions → Hazard. Poisons and diseases run on game time, so advance the clock."],
      ["A chase", "Actions → Pursuit. Pick both sides, then each round both roll on the card."],
      ["Between operations", "Home scene tab: what changed for each Agent, then hand out the pursuits. End the Home scene to clear the damaged-Bond marks."],
      ["I made a mistake", "Damage and SAN cards have an Undo button. For bigger messes, restore an Agent from a backup (Ops Kit → Case log)."],
      ["I'd rather use macros", "Compendium tab → Delta Green Ops → Ops: Handler macros. Everything here is there too. You can hide this Console's button in Ops settings → Interface."],
    ];
    return `<div class="dgops-guide">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
      <div class="dgops-buttons">${btn("settings", "Ops settings")}${btn("welcome", "Run the setup guide again")}</div>`;
  }

  async on_settings() {
    (await import("./settings.mjs")).openSettings();
  }
  async on_welcome() {
    (await import("./welcome.mjs")).openWelcome();
  }
  async on_kit(ds) {
    (await import("./kit.mjs")).openKit(await fromUuid(ds.uuid));
  }
  async on_sheet(ds) {
    (await fromUuid(ds.uuid))?.sheet?.render(true);
  }

  /* --- agent actions --- */
  async on_agentSan(ds) {
    await sanity.sanDialog([await fromUuid(ds.uuid)]);
  }
  async on_agentDisorder(ds) {
    await sanity.assignDisorder(await fromUuid(ds.uuid));
    this.render();
  }
  async on_agentWp(ds) {
    await wellbeing.motivationWp(await fromUuid(ds.uuid));
    this.render();
  }
  async on_agentFeed(ds) {
    await wellbeing.feedAddiction(await fromUuid(ds.uuid));
    this.render();
  }
  async on_agentMoney(ds) {
    await money.requisitionDialog(await fromUuid(ds.uuid));
  }

  /* --- tiles --- */
  need(kind = "agents") {
    const list = kind === "tokens" ? selectedTokens() : selectedActors();
    if (!list.length) ui.notifications.warn(kind === "tokens" ? "Select tokens, or pick Agents with tokens on this scene." : "Pick Agents on the roster, or select their tokens.");
    return list;
  }
  async on_toolSan() {
    const a = selectedActors();
    await sanity.sanDialog(a.length ? a : qol.team());
  }
  on_toolDestroyed() {
    sanity.destroyedUnnatural();
  }
  async on_toolCrisis() {
    await qol.afterTheCrisis();
    this.render();
  }
  on_toolOpposed() {
    tests.opposedDialog();
  }
  on_toolGroup() {
    const a = this.need();
    if (a.length) tests.groupDialog(a);
  }
  on_toolAttack() {
    combat.attackAssistant();
  }
  async on_toolNpc() {
    (await import("./npc-builder.mjs")).openNpcBuilder();
  }
  async on_toolUnaware() {
    const a = this.need("tokens").map((t) => t.actor).filter(Boolean);
    if (a.length) await qol.toggleCondition(STATUS.unaware, a);
    this.render();
  }
  async on_toolHelpless() {
    const a = this.need("tokens").map((t) => t.actor).filter(Boolean);
    if (a.length) await qol.toggleCondition(STATUS.helpless, a);
    this.render();
  }
  async on_toolCover() {
    for (const t of this.need("tokens")) await combat.setCover(t);
  }
  async on_toolDamage() {
    const a = this.need();
    if (a.length) await qol.damageDialog(a);
    this.render();
  }
  async on_toolHeal() {
    const a = this.need();
    if (a.length) await qol.healDialog(a);
    this.render();
  }
  async on_toolEffect() {
    const a = this.need();
    if (a.length) await qol.effectDialog(a);
  }
  on_toolHazard() {
    const a = this.need();
    if (a.length) hazards.hazardDialog(a);
  }
  on_toolMedical() {
    const a = this.need();
    if (a.length) hazards.medicalDialog(a);
  }
  on_toolVehicle() {
    hazards.vehicleDialog();
  }
  on_toolChase() {
    openChase();
  }
  on_toolMoney() {
    money.requisitionDialog(selectedActors()[0] ?? null);
  }
  on_toolInterrogate() {
    money.interrogationDialog();
  }
  on_toolReport() {
    qol.teamReport(agents());
  }
  async on_toolBackup() {
    await qol.backupAll();
  }
  async on_toolProtection() {
    const v = this.element.querySelector("[name=prot]").value;
    const t = this.need("tokens");
    if (!t.length) return;
    await combat.setProtection(t, v);
    ui.notifications.info(`Protection: ${v}`);
  }

  /* --- home --- */
  async on_homeRun(ds) {
    const a = await fromUuid(ds.uuid);
    const id = this.element.querySelector(`[name="p-${ds.id}"]`).value;
    await downtime.runPursuit(a, id);
    this.render();
  }
  async on_homeHandOut() {
    await qol.homeSceneDialog(agents());
  }
  async on_homeFired(ds) {
    await downtime.firedFlow(await fromUuid(ds.uuid));
  }
  async on_homeProsecute(ds) {
    await downtime.prosecutionFlow(await fromUuid(ds.uuid));
  }
  async on_homeReview(ds) {
    await money.officialReview(await fromUuid(ds.uuid));
    this.render();
  }
  async on_homeEnd() {
    await downtime.endHome(agents());
    this.render();
  }

  /* --- queue & clock --- */
  async on_queueResolve(ds) {
    await sanity.resolveCatastrophe(ds.id);
    this.render();
  }
  async on_queueDrop(ds) {
    const q = foundry.utils.deepClone(game.settings.get(MODULE_ID, "queue"));
    q.catastrophes = q.catastrophes.filter((c) => c.id !== ds.id);
    await setWorld("queue", q);
    this.render();
  }
  async on_eventCancel(ds) {
    await cancel({ id: ds.id });
    this.render();
  }
  async on_advance(ds) {
    await game.time.advance(Number(ds.s));
    setTimeout(() => this.rendered && this.render(), 300);
  }
}

export function openConsole() {
  const existing = foundry.applications.instances.get("dgops-console");
  if (existing) return existing.render({ force: true });
  return new HandlerConsole().render({ force: true });
}

export { hasStatus };
