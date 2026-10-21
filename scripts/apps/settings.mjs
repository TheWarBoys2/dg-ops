/**
 * Ops Settings: every option grouped by area, in plain words, with presets.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { esc } from "../core/ui.mjs";
import { CATEGORIES, DEFS, PRESETS, setting } from "../core/settings.mjs";
import { DGOpsApp, btn } from "./base.mjs";
import { teamConfig, ownedAgents, playerOwners, activeAgents } from "../core/team.mjs";

export class OpsSettings extends DGOpsApp {
  static DEFAULT_OPTIONS = {
    id: "dgops-settings",
    classes: ["dgops-settings"],
    window: { title: "Delta Green Ops — Settings", icon: "fas fa-sliders" },
    position: { width: 760, height: 640 },
  };

  cat = "team";
  pending = {};
  teamPending = null;
  teamFilter = "";

  value(key) {
    return key in this.pending ? this.pending[key] : setting(key);
  }

  editable(key) {
    return game.user.isGM || !!DEFS[key].client;
  }

  async renderBody() {
    const nav = Object.entries(CATEGORIES)
      .map(([k, c]) => {
        const changed = k === "team" ? !!this.teamPending : Object.keys(this.pending).some((p) => DEFS[p].cat === k);
        return `<a data-dgops-app="cat" data-cat="${k}" class="${this.cat === k ? "on" : ""}"><i class="${c.icon}"></i> ${esc(c.label)}${changed ? ` <span class="dot" data-status="warn"></span>` : ""}</a>`;
      })
      .join("");
    const c = CATEGORIES[this.cat];
    const rows = Object.entries(DEFS)
      .filter(([, d]) => d.cat === this.cat)
      .map(([key, d]) => this.row(key, d))
      .join("");
    const presets = game.user.isGM
      ? `<div class="dgops-presets">${Object.entries(PRESETS)
          .map(([k, p]) => `<div class="dgops-preset"><b>${esc(p.label)}</b><p>${esc(p.blurb)}</p>${btn("preset", "Use these", { p: k })}</div>`)
          .join("")}</div>`
      : "";
    const n = Object.keys(this.pending).length + (this.teamPending ? 1 : 0);
    return `<div class="dgops-panel dgops-settings-body">
      <nav class="dgops-sidenav">${nav}<hr>${game.user.isGM ? btn("welcome", "Run the setup guide") : ""}</nav>
      <section class="dgops-sheet">
        ${this.cat === "sanity" ? presets : ""}
        <h2>${esc(c.label)}</h2><p class="dgops-lede">${esc(c.blurb)}</p>
        ${this.cat === "team" ? this.teamPage() : `<div class="dgops-settings-rows">${rows}</div>`}
        ${!game.user.isGM ? `<p class="dgops-tip">Only the Handler can change table rules. Interface options are yours.</p>` : ""}
      </section>
      <footer class="dgops-settings-foot">${n ? `<span>${n} unsaved change${n > 1 ? "s" : ""}</span>` : `<span class="dgops-quiet">No changes</span>`}${btn("discard", "Discard")}${btn("save", "Save changes", {}, "primary")}</footer>
    </div>`;
  }

  row(key, d) {
    const v = this.value(key);
    const dis = this.editable(key) ? "" : "disabled";
    let input;
    if (d.type === Boolean) input = `<label class="dgops-switch"><input type="checkbox" data-key="${key}" ${v ? "checked" : ""} ${dis} data-dgops-change="set"><span></span></label>`;
    else if (d.choices) input = `<select data-key="${key}" ${dis} data-dgops-change="set">${Object.entries(d.choices).map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else input = `<input type="number" data-key="${key}" value="${v}" min="${d.range?.min ?? ""}" max="${d.range?.max ?? ""}" step="${d.range?.step ?? 1}" ${dis} data-dgops-change="set">`;
    const chips = [d.page ? `<span class="dgops-page">p.${d.page}</span>` : "", d.optional ? `<span class="dgops-tag">Optional rule</span>` : "", d.client ? `<span class="dgops-tag">Just you</span>` : ""].join("");
    return `<div class="dgops-setting ${key in this.pending ? "changed" : ""}"><div class="txt"><label>${esc(d.label)}</label>${chips}${d.hint ? `<p>${esc(d.hint)}</p>` : ""}</div><div class="ctl">${input}</div></div>`;
  }

  /* ---- Team ---- */
  team() {
    return this.teamPending ?? teamConfig();
  }

  teamPage() {
    const t = this.team();
    const gm = game.user.isGM;
    const dis = gm ? "" : "disabled";
    const owned = ownedAgents();
    const folders = game.folders.filter((f) => f.type === "Actor");
    const folderPath = (f) => {
      const parts = [];
      for (let x = f; x; x = x.folder) parts.unshift(x.name);
      return parts.join(" / ");
    };
    const radio = (mode, label, body) => `<label class="dgops-team-mode ${t.mode === mode ? "on" : ""}"><input type="radio" name="teamMode" value="${mode}" ${t.mode === mode ? "checked" : ""} ${dis} data-dgops-change="teamMode"><span><b>${label}</b>${body}</span></label>`;
    const ownedList = owned.length
      ? `<ul class="dgops-team-list">${owned.map((a) => `<li><img src="${esc(a.img)}" alt="">${esc(a.name)} <small>${esc(playerOwners(a).map((u) => u.name).join(", "))}</small></li>`).join("")}</ul>`
      : `<p class="dgops-empty">No Agent is owned by a player yet. Give each player Owner permission on their Agent.</p>`;
    const folderSel = `<select data-dgops-change="teamFolder" ${dis}><option value="">— choose a folder —</option>${folders.map((f) => `<option value="${f.id}" ${f.id === t.folder ? "selected" : ""}>${esc(folderPath(f))}</option>`).join("")}</select>`;
    const all = game.actors.filter((a) => a.type === "agent");
    const q = this.teamFilter.toLowerCase();
    const shown = all.filter((a) => !q || a.name.toLowerCase().includes(q)).sort((a, b) => Number(playerOwners(b).length > 0) - Number(playerOwners(a).length > 0) || a.name.localeCompare(b.name));
    const picks = new Set(t.ids ?? []);
    const pickList = `<input type="search" placeholder="Filter Agents…" value="${esc(this.teamFilter)}" data-dgops-change="teamFilter" class="dgops-team-filter">
      <div class="dgops-team-picks">${shown
        .map((a) => `<label><input type="checkbox" data-id="${a.id}" ${picks.has(a.id) ? "checked" : ""} ${dis} data-dgops-change="teamPick"> ${esc(a.name)}${playerOwners(a).length ? ` <small>${esc(playerOwners(a).map((u) => u.name).join(", "))}</small>` : ""}${a.folder ? ` <em>${esc(a.folder.name)}</em>` : ""}</label>`)
        .join("")}</div>
      ${gm ? `<div class="dgops-buttons">${btn("teamPickOwned", "Tick the player-owned Agents")}${btn("teamPickNone", "Clear")}</div>` : ""}`;
    const result = activeAgentsFor(t);
    return `<div class="dgops-team">
      ${radio("auto", "Agents the players own (automatic)", `<small>Recommended. Follows ownership, so new Agents join when you give a player Owner permission.</small>${t.mode === "auto" ? ownedList : ""}`)}
      ${radio("folder", "Agents in a folder", `<small>Everything in this folder (and its sub-folders).</small>${t.mode === "folder" ? folderSel : ""}`)}
      ${radio("pick", "Pick them", `<small>Exactly the Agents ticked here.</small>${t.mode === "pick" ? pickList : ""}`)}
      <p class="dgops-team-result"><b>The team right now:</b> ${result.length ? result.map((a) => esc(a.name)).join(", ") : `<span class="dgops-alert">nobody</span>`}</p>
    </div>`;
  }

  setTeam(patch) {
    this.teamPending = { ...this.team(), ...patch };
    this.render();
  }

  change_teamMode(el) {
    this.setTeam({ mode: el.value });
  }

  change_teamFolder(el) {
    this.setTeam({ folder: el.value });
  }

  change_teamPick(el) {
    const ids = new Set(this.team().ids ?? []);
    if (el.checked) ids.add(el.dataset.id);
    else ids.delete(el.dataset.id);
    this.setTeam({ ids: [...ids] });
  }

  change_teamFilter(el) {
    this.teamFilter = el.value;
    this.render();
  }

  on_teamPickOwned() {
    this.setTeam({ ids: ownedAgents().map((a) => a.id) });
  }

  on_teamPickNone() {
    this.setTeam({ ids: [] });
  }

  on_cat(ds) {
    this.cat = ds.cat;
    this.render();
  }

  change_set(el) {
    const key = el.dataset.key;
    const d = DEFS[key];
    let v = d.type === Boolean ? el.checked : d.type === Number ? Number(el.value) : el.value;
    if (v === setting(key)) delete this.pending[key];
    else this.pending[key] = v;
    this.render();
  }

  on_preset(ds) {
    const p = PRESETS[ds.p];
    const target = { ...PRESETS.book.values, ...(ds.p === "book" ? {} : p.values) };
    for (const [k, v] of Object.entries(target)) {
      if (v === setting(k)) delete this.pending[k];
      else this.pending[k] = v;
    }
    ui.notifications.info(`${p.label}: changes are highlighted. Save to apply them.`);
    this.render();
  }

  on_discard() {
    this.pending = {};
    this.teamPending = null;
    this.render();
  }

  async on_save() {
    for (const [k, v] of Object.entries(this.pending)) if (this.editable(k)) await game.settings.set(MODULE_ID, k, v);
    let n = Object.keys(this.pending).length;
    if (this.teamPending && game.user.isGM) {
      await game.settings.set(MODULE_ID, "activeTeam", this.teamPending);
      n++;
    }
    this.teamPending = null;
    this.pending = {};
    if (n) ui.notifications.info(`Delta Green Ops: ${n} setting${n > 1 ? "s" : ""} saved.`);
    this.render();
  }

  async on_welcome() {
    (await import("./welcome.mjs")).openWelcome();
  }
}

/** What a team configuration would give, before it's saved. */
function activeAgentsFor(t) {
  const saved = teamConfig();
  if (JSON.stringify(saved) === JSON.stringify(t)) return activeAgents();
  if (t.mode === "pick") return (t.ids ?? []).map((id) => game.actors.get(id)).filter(Boolean);
  if (t.mode === "folder" && t.folder) {
    return game.actors.filter((a) => {
      if (a.type !== "agent") return false;
      for (let f = a.folder; f; f = f.folder) if (f.id === t.folder) return true;
      return false;
    });
  }
  return ownedAgents();
}

/** Registered as the module's settings menu. */
export class OpsSettingsMenu extends OpsSettings {}

export function openSettings(cat = null) {
  const existing = foundry.applications.instances.get("dgops-settings");
  const app = existing ?? new OpsSettings();
  if (cat) app.cat = cat;
  return app.render({ force: true });
}
