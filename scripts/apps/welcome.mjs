/**
 * First-run setup guide for the Handler.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { esc } from "../core/ui.mjs";
import { PRESETS, setting } from "../core/settings.mjs";
import { update } from "../core/ops.mjs";
import { analyzeActor, STATUS_LABEL } from "../features/readiness.mjs";
import { applyFix } from "./kit.mjs";
import { DGOpsApp, btn } from "./base.mjs";
import { activeAgents, teamConfig } from "../core/team.mjs";

const VERSION = "1.1.0";
const STEPS = ["Welcome", "Automation", "Your table", "Ready"];

export class Welcome extends DGOpsApp {
  static BANNER = "Orientation";

  static DEFAULT_OPTIONS = {
    id: "dgops-welcome",
    classes: ["dgops-welcome"],
    window: { title: "Delta Green Ops — Setup", icon: "fas fa-folder-open" },
    position: { width: 660, height: "auto" },
  };

  step = 0;
  preset = "book";
  showAll = false;

  async renderBody() {
    const crumbs = `<ol class="dgops-steps">${STEPS.map((s, i) => `<li class="${i === this.step ? "on" : i < this.step ? "done" : ""}">${s}</li>`).join("")}</ol>`;
    const body = [this.s0, this.s1, this.s2, this.s3][this.step].call(this);
    const dismissed = !!game.settings.get(MODULE_ID, "welcomed");
    const nav = `<footer class="dgops-wizard-foot">
      ${this.step ? btn("back", "Back") : `<span></span>`}
      <label class="dgops-dontshow"><input type="checkbox" ${dismissed ? "checked" : ""} data-dgops-change="dontShow"> Don't show this when I log in</label>
      ${this.step < 3 ? btn("next", "Next", {}, "primary") : btn("finish", "Finish", {}, "primary")}
    </footer>`;
    return `<div class="dgops-panel">${crumbs}<section class="dgops-sheet">${body}</section>${nav}</div>`;
  }

  s0() {
    return `<h2>Delta Green Ops</h2>
      <p class="dgops-lede">This module runs the procedures the Agent's Handbook leaves to the Handler: SAN losses and Bonds, combat resolution, injuries, hazards, chases and Home scenes. You keep making the calls; it does the bookkeeping.</p>
      <dl class="dgops-where">
        <dt><i class="fas fa-briefcase-medical"></i> Ops button on every sheet</dt><dd>Green, amber or red: shows the actor's condition, what's automated, and fixes problems in one click.</dd>
        <dt><i class="fas fa-message"></i> Buttons on chat cards</dt><dd>Resolve an attack, apply SAN loss to a roll, repress insanity, undo. Each says what it will do before you click.</dd>
        <dt><i class="fas fa-folder-open"></i> Handler Console</dt><dd>In the token tools on the left: the team at a glance, every tool, the Home scene and the game clock.</dd>
        <dt><i class="fas fa-crosshairs"></i> Token HUD</dt><dd>Attack, aim, take cover, reload or escape a pin, straight from the token.</dd>
      </dl>`;
  }

  s1() {
    return `<h2>How much should it automate?</h2>
      <p class="dgops-lede">You can change any single rule later in the settings.</p>
      <div class="dgops-presets pick">${Object.entries(PRESETS)
        .map(([k, p]) => `<label class="dgops-preset ${this.preset === k ? "on" : ""}"><input type="radio" name="preset" value="${k}" ${this.preset === k ? "checked" : ""} data-dgops-change="preset"><b>${esc(p.label)}${k === "book" ? " (recommended)" : ""}</b><p>${esc(p.blurb)}</p></label>`)
        .join("")}</div>`;
  }

  change_preset(el) {
    this.preset = el.value;
    this.render();
  }

  s2() {
    const team = activeAgents();
    const everyone = game.actors.filter((a) => a.type === "agent");
    const list = this.showAll ? everyone : team;
    const mode = { auto: "Agents your players own", folder: "Agents in the chosen folder", pick: "Agents you picked" }[teamConfig().mode];
    const rows = list.length
      ? list
          .map((a) => {
            const r = analyzeActor(a);
            const owner = game.users.filter((u) => !u.isGM && a.testUserPermission(u, "OWNER")).map((u) => u.name).join(", ");
            return `<tr><td>${esc(a.name)}</td><td>${owner ? esc(owner) : `<span class="dgops-quiet">no player</span>`}</td><td><span class="dgops-stamp small" data-status="${r.status}">${STATUS_LABEL[r.status]}</span></td><td>${btn("kit", "Open kit", { uuid: a.uuid })}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="dgops-empty">${everyone.length ? "No Agent is on the team yet. Give each player Owner permission on their Agent, or pick the team in Ops settings." : "No Agents yet. Create them with the system's character wizard, then come back."}</td></tr>`;
    const scene = canvas?.scene;
    const units = scene?.grid?.units ?? scene?.gridUnits ?? "";
    const metric = /^(m|meters?|metres?)$/i.test(String(units).trim());
    return `<h2>Check your table</h2>
      <h3>The team <small class="dgops-quiet">(${esc(mode)}: ${team.length})</small></h3>
      <div class="dgops-scroll"><table class="dgops-table">${rows}</table></div>
      <div class="dgops-buttons">
        ${team.length ? btn("fixTeam", "Fix what can be fixed automatically") : ""}
        ${btn("team", "Change who's on the team")}
        ${everyone.length > team.length ? btn("toggleAll", this.showAll ? "Show just the team" : `Show all ${everyone.length} Agents`, {}, "subtle") : ""}
      </div>
      <h3>Scene distances</h3>
      ${
        scene
          ? metric
            ? `<p>${esc(scene.name)} measures in metres, so kill radii and ranges line up with the book.</p>`
            : `<p>${esc(scene.name)} measures in “${esc(units || "no unit")}”. Kill radii in the book are metres, so the module reads one grid unit as one metre.</p>${btn("metres", "Use metres on this scene")}`
          : `<p class="dgops-quiet">No scene is active. Kill radii read scene units as metres.</p>`
      }`;
  }

  s3() {
    return `<h2>You're ready</h2>
      <p class="dgops-lede">Two things to try at your next session:</p>
      <ol class="dgops-steps-list">
        <li><b>Something horrible happens.</b> Select the Agents' tokens, open the Console and choose <i>SAN test</i>. A SAN card goes to chat and each player rolls their own; you see the numbers, the table sees who held together.</li>
        <li><b>A fight breaks out.</b> A player targets an enemy and clicks a weapon on their sheet. The attack window walks them through it, then the chat card shows each target with a <i>Resolve</i> button: the target defends from their own card, and damage is rolled from the same row.</li>
      </ol>
      <p>If something looks wrong on a sheet, its Ops button will say why. Everything else lives in the <b>Delta Green Ops</b> macro compendiums (Compendium tab): drag the ones you use to the hotbar.</p>`;
  }

  on_next() {
    this.step = Math.min(3, this.step + 1);
    this.render();
  }

  on_back() {
    this.step = Math.max(0, this.step - 1);
    this.render();
  }

  async on_kit(ds) {
    (await import("./kit.mjs")).openKit(await fromUuid(ds.uuid));
  }

  async on_fixTeam() {
    for (const a of activeAgents()) {
      const r = analyzeActor(a);
      for (const n of r.notes) if (n.fix && ["resetBP", "linkToken"].includes(n.fix.kind)) await applyFix(a, n.fix);
      for (const i of r.items) for (const n of i.notes) if (n.fix?.kind === "addEpisodeEffect") await applyFix(a, { ...n.fix, itemId: i.item.id });
    }
    ui.notifications.info("Fixed what could be fixed. Anything left needs a decision: open that Agent's kit.");
    this.render();
  }

  on_toggleAll() {
    this.showAll = !this.showAll;
    this.render();
  }

  async on_team() {
    (await import("./settings.mjs")).openSettings("team");
  }

  async change_dontShow(el) {
    await game.settings.set(MODULE_ID, "welcomed", el.checked ? VERSION : "");
  }

  async on_metres() {
    const scene = canvas.scene;
    await update(scene, scene.grid?.units !== undefined ? { "grid.units": "m" } : { gridUnits: "m" });
    this.render();
  }

  async on_finish() {
    const p = PRESETS[this.preset];
    const target = { ...PRESETS.book.values, ...(this.preset === "book" ? {} : p.values) };
    for (const [k, v] of Object.entries(target)) if (setting(k) !== v) await game.settings.set(MODULE_ID, k, v);
    await game.settings.set(MODULE_ID, "welcomed", VERSION);
    this.close();
  }
}

export function openWelcome() {
  const existing = foundry.applications.instances.get("dgops-welcome");
  if (existing) return existing.render({ force: true });
  return new Welcome().render({ force: true });
}

export function shouldWelcome() {
  return game.user.isGM && !game.settings.get(MODULE_ID, "welcomed");
}
