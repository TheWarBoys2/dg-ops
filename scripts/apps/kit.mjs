/**
 * The Ops Kit: a colour-coded title-bar button on Delta Green sheets that opens a panel showing
 * the actor's state, what the module can automate, and one-click fixes (after CPR's Medkit).
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { esc, options, prompt, field } from "../core/ui.mjs";
import { setting } from "../core/settings.mjs";
import { update, createEmbedded, hasStatus } from "../core/ops.mjs";
import { statValue } from "../core/system.mjs";
import { DISORDERS } from "../rules/disorders.mjs";
import { PROTECTION, parseCapacity } from "../rules/combat.mjs";
import { analyzeActor, analyzeItem, STATUS_LABEL, disorderIdFor, triggerText } from "../features/readiness.mjs";
import { isDGBond } from "../core/bonds.mjs";
import { DGOpsApp, btn } from "./base.mjs";
import { sanLogLine } from "../features/sanity.mjs";

/** Plain-language explanations for conditions shown in the kit and on status effects. */
export const CONDITION_TEXT = {
  [STATUS.tempInsane]: ["Temporarily insane", "Flees, struggles or submits until it passes. Can be repressed with WP and a Bond, or talked down with Psychotherapy."],
  [STATUS.breakdown]: ["Emotional breakdown", "WP is 1–2: −20% to every test until WP rises above 2."],
  [STATUS.lostControl]: ["Lost control", "WP is 0: the Handler controls the Agent, and every test fails until WP returns."],
  [STATUS.pinned]: ["Pinned", "Can only try to escape. Melee attacks against them get +20%."],
  [STATUS.suppressed]: ["Suppressed", "Next action must be to find cover or go prone — or pay 1 SAN to act normally."],
  [STATUS.onFire]: ["On fire", "Half fire damage every turn until extinguished."],
  [STATUS.suffocating]: ["Suffocating", "Holding breath; CON×5 every turn once it runs out."],
  [STATUS.unaware]: ["Unaware", "Not suppressed by gunfire and can't defend."],
  [STATUS.cover]: ["In cover", "Cover armor applies; Lethality can't kill outright."],
  [STATUS.distracted]: ["Distracted", "−20% to the next test, then it passes."],
  [STATUS.aiming]: ["Aiming", "+20% to the next attack. Lost if hurt first, or if the next turn is spent on anything else."],
  [STATUS.guard]: ["Guarding", "Their melee roll this turn opposes every hand-to-hand attack against them until their next turn. Attacks that don't beat it do no harm."],
  [STATUS.helpless]: ["Helpless", "Bound or asleep: attacks hit automatically and can kill outright (p.53)."],
  stun: ["Stunned", "Can't act. Roll CON×5 on their turn to act normally next turn."],
  unconscious: ["Unconscious", "2 HP or fewer: helpless. Wakes at 3+ HP or after an hour."],
  prone: ["Prone", "−20% to ranged attacks against them (p.53). Standing up takes an action."],
  dead: ["Dead", "Resuscitation is possible within CON minutes (First Aid)."],
};

/* ---------------- Title-bar button ---------------- */

const SUPPORTED_ITEMS = new Set(["weapon", "motivation", "bond", "armor"]);

export function kitStatus(doc) {
  if (doc.documentName === "Actor") return analyzeActor(doc).status;
  if (SUPPORTED_ITEMS.has(doc.type)) return analyzeItem(doc).status;
  return null;
}

export function canOpenKit(doc) {
  if (!setting("kitButton")) return false;
  if (game.user.isGM) return true;
  return setting("playersSeeKit") && doc.isOwner;
}

export function decorateSheetHeader(app, element) {
  const doc = app.document ?? app.actor ?? app.item;
  if (!doc || !["Actor", "Item"].includes(doc.documentName)) return;
  if (doc.documentName === "Item" && !SUPPORTED_ITEMS.has(doc.type)) return;
  if (!canOpenKit(doc)) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const frame = root?.closest?.(".application") ?? root;
  const header = frame?.querySelector(".window-header");
  if (!header) return;
  const status = kitStatus(doc) ?? "na";
  let b = header.querySelector(".dgops-kit-btn");
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "header-control dgops-kit-btn";
    b.innerHTML = `<i class="fas fa-briefcase-medical"></i><span>Ops</span>`;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openKit(doc);
    });
    const anchor = header.querySelector(".header-control, [data-action='close']");
    header.insertBefore(b, anchor ?? null);
  }
  b.dataset.status = status;
  b.dataset.tooltip = `Ops Kit: ${STATUS_LABEL[status] ?? ""}`;
  b.setAttribute("aria-label", b.dataset.tooltip);
}

/* ---------------- The panel ---------------- */

const stamp = (status) => `<span class="dgops-stamp" data-status="${status}">${STATUS_LABEL[status]}</span>`;

function gauge(label, value, max, { marker = null, markerLabel = "", hidden = false, tone = "" } = {}) {
  if (hidden) return `<div class="dgops-gauge"><span class="label">${label}</span><span class="bar hidden"><i style="width:0"></i></span><span class="num">hidden</span></div>`;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const m = marker != null && max > 0 ? `<b class="marker" style="left:${Math.max(0, Math.min(100, (marker / max) * 100))}%" data-tooltip="${esc(markerLabel)}"></b>` : "";
  return `<div class="dgops-gauge ${tone}"><span class="label">${label}</span><span class="bar"><i style="width:${pct}%"></i>${m}</span><span class="num">${value}<small>/${max}</small></span></div>`;
}

export class OpsKit extends DGOpsApp {
  static BANNER = "Ops kit";

  static DEFAULT_OPTIONS = {
    classes: ["dgops-kit"],
    window: { title: "Ops Kit", icon: "fas fa-briefcase-medical" },
    position: { width: 620 },
  };

  constructor(doc) {
    super({ id: `dgops-kit-${doc.uuid.replace(/\./g, "-")}` });
    this.doc = doc;
    this.tab = doc.documentName === "Actor" ? "status" : "item";
    this._hook = Hooks.on(doc.documentName === "Actor" ? "updateActor" : "updateItem", (d) => {
      if (d.id === doc.id && this.rendered) this.render();
    });
  }

  get title() {
    return `Ops Kit — ${this.doc.name}`;
  }

  async close(options) {
    Hooks.off(this.doc.documentName === "Actor" ? "updateActor" : "updateItem", this._hook);
    return super.close(options);
  }

  async renderBody() {
    if (this.doc.documentName === "Item") return this.renderItem(this.doc);
    const tabs = { status: "Status", readiness: "Readiness", log: "Case log" };
    const r = analyzeActor(this.doc);
    const nav = `<nav class="dgops-filetabs">${Object.entries(tabs)
      .map(([k, v]) => `<a data-dgops-app="tab" data-tab="${k}" class="${this.tab === k ? "on" : ""}">${v}${k === "readiness" ? ` <span class="dot" data-status="${r.status}"></span>` : ""}</a>`)
      .join("")}</nav>`;
    let body = "";
    if (this.tab === "status") body = this.renderStatus();
    if (this.tab === "readiness") body = this.renderReadiness(r);
    if (this.tab === "log") body = await this.renderLog();
    return `<div class="dgops-panel">${nav}<section class="dgops-sheet">${body}</section></div>`;
  }

  on_tab(ds) {
    this.tab = ds.tab;
    this.render();
  }

  /* ---- Status ---- */
  renderStatus() {
    const a = this.doc;
    const s = a.system;
    const gm = game.user.isGM;
    let priv = false;
    try {
      priv = game.settings.get("deltagreen", "keepSanityPrivate") && !gm;
    } catch {
      /* ignore */
    }
    const parts = [];
    if (s.health) parts.push(gauge("HP", s.health.value, s.health.max, { marker: 2, markerLabel: "2 HP: unconscious", tone: "hp" }));
    if (s.wp && a.type !== "vehicle") parts.push(gauge("WP", s.wp.value, s.wp.max, { marker: 2, markerLabel: "1–2 WP: breakdown", tone: "wp" }));
    if (a.type === "agent" || (a.type === "npc" && s.sanity?.value != null)) {
      parts.push(gauge("SAN", s.sanity.value, s.sanity.max ?? 99, { marker: s.sanity.currentBreakingPoint, markerLabel: `Breaking Point ${s.sanity.currentBreakingPoint}`, hidden: priv, tone: "san" }));
    }
    const gauges = `<div class="dgops-gauges">${parts.join("")}</div>`;

    // Conditions
    const conds = [];
    for (const id of a.statuses ?? []) if (CONDITION_TEXT[id]) conds.push(CONDITION_TEXT[id]);
    const disorders = (a.itemTypes?.motivation ?? []).filter((m) => m.system.disorder && !m.system.crossedOut);
    for (const d of disorders) {
      if (d.system.disorderCured) conds.push([`${d.name} (cured)`, "In remission. May return with the next disorder."]);
      else if (d.system.acuteEpisode) conds.push([`${d.name}: acute episode`, (DISORDERS[disorderIdFor(d)]?.summary ?? "The disorder has the Agent in its grip.") + " Repress it with WP and a Bond."]);
      else conds.push([d.name, `Dormant; triggered ${triggerText(d.getFlag(MODULE_ID, "trigger") ?? DISORDERS[disorderIdFor(d)]?.trigger)}.`]);
    }
    const f = (k) => a.getFlag?.(MODULE_ID, k);
    const pend = f("pendingDisorders") ?? [];
    if (pend.length) conds.push([`${pend.length} disorder${pend.length > 1 ? "s" : ""} pending`, "Reached the Breaking Point. The Handler assigns the disorder now or at the Home scene."]);
    if (f("sleepTest")) conds.push(["Sleep is owed a SAN test", "The next Rest asks for SAN; failure means no WP for 24 hours."]);
    if ((f("noWpUntil") ?? 0) > game.time.worldTime) conds.push(["No WP recovery", "For the next 24 game hours."]);
    if (f("diseased")) conds.push(["Sick", "No HP can be regained while the disease lasts."]);
    if (f("treated") && s.health?.value < s.health?.max) conds.push(["Recovering from treatment", "Strenuous tests deal 1D4 until fully healed."]);
    if (f("resting")) conds.push(["Resting", "Rolls recuperation (CON×5) every game day."]);
    if (f("hospitalized")) conds.push(["Hospitalized", "+20% to CON tests against poison and disease."]);
    if (s.physical?.exhausted) conds.push(["Exhausted", "Penalty to all tests until a full night's sleep."]);
    const condHtml = conds.length
      ? `<dl class="dgops-conds">${conds.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>`
      : `<p class="dgops-empty">Nothing wrong. Yet.</p>`;

    // Adaptation
    let adapt = "";
    if (a.type === "agent") {
      const row = (k, label, cost) => {
        const st = s.sanity.adaptations[k];
        const n = [st.incident1, st.incident2, st.incident3].filter(Boolean).length;
        return `<div class="dgops-adapt"><span>${label}</span><span class="boxes">${[0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>${n >= 3 ? `<span class="dgops-stamp small" data-status="warn">Adapted</span>` : `<small>${cost}</small>`}</div>`;
      };
      adapt = `<h3>Adaptation</h3>${row("violence", "Violence", "3 losses in a row: CHA and Bonds −1D6")}${row("helplessness", "Helplessness", "3 losses in a row: POW −1D6")}`;
    }

    // Protection for NPCs and unnatural things
    let prot = "";
    if (["unnatural", "npc"].includes(a.type) && game.user.isGM) {
      const cur = a.getFlag(MODULE_ID, "protection") ?? "";
      prot = `<h3>Protection</h3><div class="form-group"><select data-dgops-change="protection"><option value="">Exposed (default)</option>${options(Object.fromEntries(PROTECTION.filter((p) => p !== "exposed").map((p) => [p, p[0].toUpperCase() + p.slice(1)])), cur)}</select></div>
        <p class="dgops-tip">Huge: Lethality hits as flat damage. Transcendent: immune to physical harm. Fragile: any deliberate harm drops it to 0.</p>`;
    }

    // Quick actions
    const acts = [];
    if (["agent", "npc"].includes(a.type)) acts.push(btn("act", "SAN test", { a: "san" }), btn("act", "Attack", { a: "attack" }), btn("act", "Medical care", { a: "medical" }));
    if (a.type === "agent") acts.push(btn("act", "Gear & money", { a: "money" }));
    if (hasStatus(a, STATUS.tempInsane)) acts.push(btn("act", "Repress insanity", { a: "repress" }));
    for (const d of disorders.filter((x) => x.system.acuteEpisode)) acts.push(btn("act", `Repress ${d.name}`, { a: "repressAcute", id: d.id }));
    if (disorders.some((d) => DISORDERS[disorderIdFor(d)]?.addiction)) acts.push(btn("act", "Feed addiction", { a: "feed" }));
    if (game.user.isGM && a.type === "agent") {
      acts.push(btn("act", "+1 WP (motivation)", { a: "wp" }));
      if (pend.length) acts.push(btn("act", "Assign disorder", { a: "disorder" }, "primary"));
    }
    if (a.type === "unnatural" && game.user.isGM) acts.push(btn("act", "It's destroyed", { a: "destroyed" }));

    return `${gauges}<div class="dgops-two"><div><h3>Condition</h3>${condHtml}</div><div>${adapt}${prot}</div></div>${acts.length ? `<h3>Do something</h3><div class="dgops-buttons">${acts.join("")}</div>` : ""}`;
  }

  async change_protection(el) {
    await update(this.doc, { [`flags.${MODULE_ID}.protection`]: el.value || null });
  }

  async on_act(ds) {
    const a = this.doc;
    const sanity = await import("../features/sanity.mjs");
    switch (ds.a) {
      case "san":
        return sanity.sanDialog([a]);
      case "attack":
        return (await import("../features/combat.mjs")).attackAssistant(a);
      case "medical":
        return (await import("../features/hazards.mjs")).medicalDialog([a]);
      case "money":
        return (await import("../features/money.mjs")).requisitionDialog(a);
      case "repress":
        return sanity.repress(a, { kind: "temp" });
      case "repressAcute":
        return sanity.repress(a, { kind: "acute", itemId: ds.id });
      case "feed":
        return (await import("../features/wellbeing.mjs")).feedAddiction(a);
      case "wp":
        return (await import("../features/wellbeing.mjs")).motivationWp(a);
      case "disorder":
        return sanity.assignDisorder(a);
      case "destroyed":
        return sanity.destroyedUnnatural(a);
      default:
        return null;
    }
  }

  /* ---- Readiness ---- */
  renderReadiness(r) {
    const row = (status, text, fix, extra = "") => `<li data-status="${status}">${stamp(status)}<span class="text">${esc(text)}${extra}</span>${fix ? this.fixButton(fix) : ""}</li>`;
    const actorRows = r.notes.map((n) => row(n.status, n.text, n.fix)).join("");
    const itemRows = r.items
      .map((i) => {
        const shown = i.status === "ok" ? i.notes.filter((n) => n.status === "ok").slice(0, 1) : i.notes.filter((n) => n.status !== "ok" && n.status !== "na");
        const link = `<a data-dgops-app="openItem" data-id="${i.item.id}">${esc(i.item.name)}</a>`;
        return shown
          .map((n, idx) => `<li data-status="${n.status}">${stamp(n.status)}<span class="text">${idx === 0 ? link : `<span class="dgops-quiet">${esc(i.item.name)}</span>`} — ${esc(n.text)}</span>${n.fix ? this.fixButton({ ...n.fix, itemId: i.item.id }) : idx === 0 ? btn("openItemKit", "Configure", { id: i.item.id }) : ""}</li>`)
          .join("");
      })
      .join("");
    const fixable = [...r.notes, ...r.items.flatMap((i) => i.notes.map((n) => (n.fix ? { ...n, fix: { ...n.fix, itemId: i.item.id } } : n)))].filter((n) => n.fix && SAFE_FIXES.has(n.fix.kind));
    return `<p class="dgops-lede">${r.status === "ok" ? "Everything the module can automate on this sheet is ready." : r.status === "bad" ? "Some things won't automate until they're fixed." : "Works as is — a few things are worth checking."}</p>
      <ul class="dgops-checklist">${actorRows}</ul>
      ${itemRows ? `<h3>Items</h3><ul class="dgops-checklist">${itemRows}</ul>` : ""}
      ${fixable.length ? `<div class="dgops-buttons">${btn("fixAll", `Fix ${fixable.length} automatically`, {}, "primary")}</div>` : ""}`;
  }

  fixButton(fix) {
    const labels = { resetBP: "Reset to SAN − POW", linkToken: "Link token", capacity: "Set capacity", selectiveFire: "Mark selective-fire", mapDisorder: "Map disorder", addEpisodeEffect: "Add effect", assignDisorder: "Assign", protection: "Set protection" };
    return btn("fix", labels[fix.kind] ?? "Fix", { kind: fix.kind, item: fix.itemId ?? "" });
  }

  async on_fix(ds) {
    await applyFix(this.doc, { kind: ds.kind, itemId: ds.item || null });
    this.render();
  }

  async on_fixAll() {
    const r = analyzeActor(this.doc);
    const all = [...r.notes.map((n) => n.fix), ...r.items.flatMap((i) => i.notes.map((n) => n.fix && { ...n.fix, itemId: i.item.id }))].filter((x) => x && SAFE_FIXES.has(x.kind));
    for (const f of all) await applyFix(this.doc, f);
    this.render();
  }

  on_openItem(ds) {
    this.doc.items.get(ds.id)?.sheet?.render(true);
  }

  on_openItemKit(ds) {
    const item = this.doc.items.get(ds.id);
    if (item) openKit(item);
  }

  /* ---- Log ---- */
  async renderLog() {
    const a = this.doc;
    const now = game.time.worldTime;
    const ago = (t) => {
      const d = Math.max(0, now - (t ?? now));
      if (d < 3600) return "this hour";
      if (d < 86400) return `${Math.round(d / 3600)} h ago`;
      return `${Math.round(d / 86400)} d ago`;
    };
    const san = (a.getFlag(MODULE_ID, "sanLog") ?? []).slice().reverse();
    const inj = (a.getFlag(MODULE_ID, "injuries") ?? []).slice().reverse();
    const lastHome = a.getFlag(MODULE_ID, "lastHome")?.t;
    const sanRows = san.length
      ? `<table class="dgops-table"><tr><th>When</th><th>What</th><th>Kind</th><th>SAN</th></tr>${san.map((e) => `<tr class="${lastHome != null && e.t < lastHome ? "old" : ""}"><td>${ago(e.t)}</td><td>${esc(e.source || "—")}${sanLogLine(e) ? `<br><small class="dgops-quiet">${esc(sanLogLine(e))}</small>` : ""}</td><td>${esc(e.category)}</td><td>−${e.loss}</td></tr>`).join("")}</table>`
      : `<p class="dgops-empty">No SAN lost yet.</p>`;
    const cash = a.getFlag(MODULE_ID, "illicitCash");
    const reviews = a.getFlag(MODULE_ID, "reviews") ?? [];
    return `<h3>Incidents of SAN loss</h3>${sanRows}${game.user.isGM && san.length ? `<div class="dgops-buttons">${btn("editSanLog", "Edit the SAN log…")}</div>` : ""}
      ${inj.length ? `<h3>Permanent injuries</h3><ul class="dgops-list">${inj.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul>` : ""}
      ${reviews.length ? `<h3>Awaiting official review</h3><ul class="dgops-list">${reviews.map((r) => `<li>${esc(r.item)} (${esc(r.level)})</li>`).join("")}</ul>` : ""}
      ${cash ? `<p>Illicit cash: <b>${cash}</b> Standard purchases.</p>` : ""}
      <p class="dgops-tip">Greyed rows happened before the last Home scene.</p>
      ${await this.renderBackups()}`;
  }

  async renderBackups() {
    const a = this.doc;
    if (!game.user.isGM || a.type !== "agent") return "";
    const { backupsOf } = await import("../features/qol.mjs");
    let list = [];
    try {
      list = await backupsOf(a);
    } catch {
      list = [];
    }
    const rows = list.length
      ? `<table class="dgops-table"><tr><th>Taken</th><th>Why</th><th></th></tr>${list
          .map((b) => `<tr><td>${esc(new Date(b.at).toLocaleString())}</td><td>${esc(b.reason ?? "")}</td><td class="dgops-actions">${btn("restore", "Restore", { id: b.id }, "subtle")}</td></tr>`)
          .join("")}</table>`
      : `<p class="dgops-empty">No backups yet.</p>`;
    return `<h3>Backups</h3>${rows}<div class="dgops-buttons">${btn("backupNow", "Back up now")}</div>`;
  }

  async on_editSanLog() {
    const { editSanLog } = await import("../features/sanity.mjs");
    await editSanLog(this.doc);
    this.render();
  }

  async on_backupNow() {
    const { backupActor } = await import("../features/qol.mjs");
    await backupActor(this.doc, { reason: "manual" });
    this.render();
  }

  async on_restore(ds) {
    const ok = await (await import("../core/ui.mjs")).confirm("Restore from backup?", `<p>${esc(this.doc.name)} goes back to this backup: stats, items, Bonds, effects. The current state is backed up first, so you can undo this.</p>`);
    if (!ok) return;
    const { restoreBackup } = await import("../features/qol.mjs");
    await restoreBackup(this.doc, ds.id);
    this.render();
  }

  /* ---- Items ---- */
  renderItem(item) {
    const r = analyzeItem(item);
    const notes = `<ul class="dgops-checklist">${r.notes.map((n) => `<li data-status="${n.status}">${stamp(n.status)}<span class="text">${esc(n.text)}</span></li>`).join("")}</ul>`;
    let form = "";
    if (item.type === "weapon") {
      const parsed = parseCapacity(item.system.ammo);
      const cap = item.getFlag(MODULE_ID, "capacity") ?? "";
      const rounds = item.getFlag(MODULE_ID, "rounds") ?? "";
      const exp = item.getFlag(MODULE_ID, "explosive");
      form = `${field("Magazine capacity", `<input type="number" name="capacity" value="${cap}" placeholder="${parsed ?? "unknown"}" min="0">`, parsed ? `Read from the sheet as ${parsed}. Only fill this in to override.` : "The sheet's ammo field has no number in it.")}
        ${field("Rounds loaded", `<input type="number" name="rounds" value="${rounds}" placeholder="${cap || parsed || ""}" min="0">`)}
        <label class="dgops-check"><input type="checkbox" name="selectiveFire" ${item.getFlag(MODULE_ID, "selectiveFire") ? "checked" : ""}> Selective fire (bursts and sprays)</label>
        ${field("Explosive", `<select name="explosive">${options({ auto: "Decide from kill radius", yes: "Yes: blast zone +20%, AP only on the centre", no: "No" }, exp === true ? "yes" : exp === false ? "no" : "auto")}</select>`)}`;
    }
    if (item.type === "motivation" && item.system.disorder) {
      const id = disorderIdFor(item) ?? "";
      const def = DISORDERS[id];
      form = `${field("Disorder", `<select name="disorder"><option value="">— not recognised —</option>${options(Object.fromEntries(Object.entries(DISORDERS).map(([k, d]) => [k, d.name])), id)}<option value="custom" ${id === "custom" ? "selected" : ""}>Custom</option></select>`)}
        ${field("Episode starts", `<select name="trigger">${options({ "": `Catalogue default${def ? ` (${triggerText(def.trigger)})` : ""}`, san2: triggerText("san2"), insanityOrBP: triggerText("insanityOrBP"), sleep: triggerText("sleep"), manual: triggerText("manual") }, item.getFlag(MODULE_ID, "trigger") ?? "")}</select>`)}
        <label class="dgops-check"><input type="checkbox" name="wpPerTest" ${item.getFlag(MODULE_ID, "wpPerTest") ? "checked" : ""}> Every test costs 1D4 WP during an episode</label>
        ${def ? `<p class="dgops-tip">${esc(def.summary)}</p>` : ""}`;
    }
    if (item.type === "bond") {
      const agents = game.actors.filter((x) => x.type === "agent" && x.id !== item.actor?.id);
      form = `<label class="dgops-check"><input type="checkbox" name="dgBond" ${isDGBond(item) ? "checked" : ""}> Delta Green Bond (Home-scene costs never fall on it)</label>
        <label class="dgops-check"><input type="checkbox" name="colleague" ${item.getFlag(MODULE_ID, "colleague") ? "checked" : ""}> A colleague from the day job (−20% to keep it if fired)</label>
        ${field("Teammate", `<select name="dgActor"><option value="">—</option>${agents.map((x) => `<option value="${x.uuid}" ${item.getFlag(MODULE_ID, "dgActor") === x.uuid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`, "Links the Bond to an Agent so team-catastrophe tests deepen it instead of creating a duplicate.")}`;
    }
    return `<div class="dgops-panel"><section class="dgops-sheet">
      <div class="dgops-itemhead"><h2>${esc(item.name)}</h2>${stamp(r.status)}</div>
      ${notes}
      ${form ? `<h3>How the module treats it</h3><form class="dgops-form">${form}</form><div class="dgops-buttons">${btn("saveItem", "Save", {}, "primary")}</div>` : ""}
    </section></div>`;
  }

  async on_saveItem() {
    const item = this.doc;
    const d = this.formData();
    const data = {};
    const set = (k, v) => (data[`flags.${MODULE_ID}.${k}`] = v);
    const unset = (k) => (data[`flags.${MODULE_ID}.-=${k}`] = null);
    if (item.type === "weapon") {
      d.capacity ? set("capacity", Number(d.capacity)) : unset("capacity");
      d.rounds !== null && d.rounds !== undefined && d.rounds !== "" ? set("rounds", Number(d.rounds)) : unset("rounds");
      set("selectiveFire", !!d.selectiveFire);
      d.explosive === "auto" ? unset("explosive") : set("explosive", d.explosive === "yes");
    }
    if (item.type === "motivation") {
      d.disorder ? set("disorder", d.disorder) : unset("disorder");
      d.trigger ? set("trigger", d.trigger) : unset("trigger");
      set("wpPerTest", !!d.wpPerTest);
    }
    if (item.type === "bond") {
      set("dgBond", !!d.dgBond);
      set("colleague", !!d.colleague);
      d.dgActor ? set("dgActor", d.dgActor) : unset("dgActor");
    }
    await update(item, data);
    if (item.type === "motivation" && d.disorder && DISORDERS[d.disorder]?.changes.length && !(item.effects?.contents ?? []).length) await applyFix(item.actor, { kind: "addEpisodeEffect", itemId: item.id });
    ui.notifications.info(`${item.name}: saved.`);
    this.render();
  }
}

/* ---------------- Fixes ---------------- */

const SAFE_FIXES = new Set(["resetBP", "linkToken", "addEpisodeEffect", "selectiveFire"]);

export async function applyFix(actor, { kind, itemId }) {
  const item = itemId ? actor?.items?.get(itemId) : null;
  switch (kind) {
    case "resetBP":
      return update(actor, { "system.sanity.currentBreakingPoint": Math.max(0, actor.system.sanity.value - statValue(actor, "pow")) });
    case "linkToken":
      return update(actor, { "prototypeToken.actorLink": true });
    case "selectiveFire":
      return update(item, { [`flags.${MODULE_ID}.selectiveFire`]: true });
    case "capacity": {
      const r = await prompt({ title: `Magazine — ${item.name}`, content: field("Rounds per magazine", `<input type="number" name="n" value="${parseCapacity(item.system.ammo) ?? 15}" min="1">`) });
      if (r?.data?.n) return update(item, { [`flags.${MODULE_ID}.capacity`]: Number(r.data.n) });
      return null;
    }
    case "mapDisorder":
      return openKit(item);
    case "addEpisodeEffect": {
      const def = DISORDERS[disorderIdFor(item)];
      if (!def?.changes?.length) return null;
      return createEmbedded(item, "ActiveEffect", [{ name: `${def.name}: acute episode`, img: "icons/svg/daze.svg", transfer: true, changes: def.changes, flags: { [MODULE_ID]: { disorderEffect: true } } }]);
    }
    case "assignDisorder":
      return (await import("../features/sanity.mjs")).assignDisorder(actor);
    default:
      return null;
  }
}

export function openKit(doc) {
  const id = `dgops-kit-${doc.uuid.replace(/\./g, "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  return new OpsKit(doc).render({ force: true });
}
