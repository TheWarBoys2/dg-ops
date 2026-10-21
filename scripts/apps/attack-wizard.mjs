/**
 * Attack wizard. Opens when a weapon is clicked on a sheet (or from the Ops Kit) and walks through:
 *   1. Weapon     (only when opened without one)
 *   2. Action     Attack / Called shot / Pin / Disarm
 *   3. Called shot location (only for called shots)
 *   4. Situation  dropdowns at their defaults, the targets and their conditions, the final chance, Roll.
 * Anything that stops the attack (stunned, pinned, unconscious…) is shown instead of the Roll button.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { esc } from "../core/ui.mjs";
import { setting } from "../core/settings.mjs";
import { activeTokenDoc } from "../core/system.mjs";
import { CALLED_SHOTS, COMBAT_MODIFIERS, FIRE_MODES } from "../rules/combat.mjs";
import {
  attackDefaults,
  computeAttack,
  rollAttack,
  fireModesFor,
  capacityOf,
  actionsFor,
  targetConditions,
  conditionChips,
  attackerState,
  escapePin,
  suppressChoice,
  distanceBetween,
} from "../features/combat.mjs";
import { DGOpsApp, btn } from "./base.mjs";

const ACTIONS = {
  attack: { label: "Attack", icon: "fas fa-crosshairs", text: "Hit them and roll damage." },
  called: { label: "Called shot", icon: "fas fa-bullseye", text: "Aim past cover or for a weak spot. −20% or −40%." },
  pin: { label: "Pin", icon: "fas fa-hands-holding", text: "Hold them down. A pinned target can only try to escape. Needs both hands." },
  disarm: { label: "Disarm", icon: "fas fa-hand-back-fist", text: "Knock the weapon away or take it. Needs both hands." },
};

const sel = (name, entries, value) =>
  `<select name="${name}" data-dgops-change="field">${Object.entries(entries)
    .map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(value) ? "selected" : ""}>${esc(typeof v === "object" ? v.label : v)}</option>`)
    .join("")}</select>`;

const row = (label, control, hint = "") => `<label class="dgops-wiz__field"><span>${esc(label)}</span>${control}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;

const BAND_TEXT = { pointBlank: "point-blank", normal: "within base range", beyond: "beyond base range", beyond2: "far beyond base range", out: "out of range" };

export class AttackWizard extends DGOpsApp {
  static BANNER = "Form DD-114";

  static DEFAULT_OPTIONS = {
    classes: ["dgops-wizard"],
    window: { title: "Attack", icon: "fas fa-crosshairs", resizable: false },
    position: { width: 480 },
  };

  constructor(actor, itemId = null, token = null) {
    super({ id: `dgops-attack-${actor.id}` });
    this.actor = actor;
    this.token = token ?? activeTokenDoc(actor);
    this.touched = new Set();
    this.setWeapon(itemId);
    this.step = this.item ? "action" : "weapon";
    this._onTarget = () => this.refreshTargets();
    this._hook = Hooks.on("targetToken", this._onTarget);
  }

  get title() {
    return `${this.actor.name}: ${this.item?.name ?? "attack"}`;
  }

  setWeapon(itemId) {
    const weapons = this.weapons();
    this.item = (itemId && this.actor.items.get(itemId)) || (weapons.length === 1 ? weapons[0] : null);
    if (this.item) this.d = attackDefaults(this.actor, this.item, this.targets(), this.token);
  }

  weapons() {
    return this.actor.itemTypes.weapon.filter((w) => w.system.equipped !== false);
  }

  targets() {
    return [...(game.user.targets ?? [])].map((t) => t.document).filter(Boolean);
  }

  /** New targets: re-read the defaults the user hasn't changed. */
  refreshTargets() {
    if (!this.item || !this.rendered) return;
    const fresh = attackDefaults(this.actor, this.item, this.targets(), this.token);
    for (const k of ["tm", "tr", "range", "surprise", "distance", "band"]) if (!this.touched.has(k)) this.d[k] = fresh[k];
    this.render();
  }

  async close(options) {
    Hooks.off("targetToken", this._hook);
    return super.close(options);
  }

  async renderBody() {
    const steps = this.item ? ["action", ...(this.d.action === "called" ? ["called"] : []), "situation"] : ["weapon"];
    const crumbs = steps
      .map((s, i) => `<li class="${s === this.step ? "on" : steps.indexOf(this.step) > i ? "done" : ""}">${{ weapon: "Weapon", action: "Action", called: "Called shot", situation: "Situation" }[s]}</li>`)
      .join("");
    const body = this[`step_${this.step}`]();
    return `<form class="dgops-panel dgops-wiz">
      <ol class="dgops-wiz__steps">${crumbs}</ol>
      ${this.headerHtml()}
      ${body}
    </form>`;
  }

  headerHtml() {
    const targets = this.targets();
    const who = targets.length
      ? targets
          .map((t) => `<span class="dgops-wiz__target"><img src="${esc(t.texture?.src ?? t.actor?.img)}" alt="">${esc(t.name)}</span>`)
          .join("")
      : `<span class="dgops-quiet">No target yet: target a token (T while hovering) and it appears here.</span>`;
    return `<div class="dgops-wiz__versus"><span class="dgops-wiz__target me"><img src="${esc(this.token?.texture?.src ?? this.actor.img)}" alt="">${esc(this.actor.name)}</span><i class="fas fa-angles-right"></i>${who}</div>`;
  }

  /* ---- Step: weapon ---- */
  step_weapon() {
    const cards = this.weapons()
      .map((w) => {
        const cap = capacityOf(w);
        const rounds = cap ? ` · ${w.getFlag(MODULE_ID, "rounds") ?? cap}/${cap} rds` : "";
        const hit = w.system.isLethal ? `Lethality ${w.system.lethality}%` : esc(w.system.damage || "—");
        return `<button type="button" class="dgops-wiz__card" data-dgops-app="pickWeapon" data-id="${w.id}"><img src="${esc(w.img)}" alt=""><span><b>${esc(w.name)}</b><small>${hit}${rounds}</small></span></button>`;
      })
      .join("");
    return `<h3>Which weapon?</h3><div class="dgops-wiz__cards">${cards || `<p class="dgops-quiet">No equipped weapons.</p>`}</div>`;
  }

  on_pickWeapon(data) {
    this.setWeapon(data.id);
    this.step = "action";
    this.render();
  }

  /* ---- Step: action ---- */
  step_action() {
    const allowed = actionsFor(this.item);
    const cards = allowed
      .map((k) => {
        const a = ACTIONS[k];
        return `<button type="button" class="dgops-wiz__card ${this.d.action === k ? "on" : ""}" data-dgops-app="pickAction" data-action-key="${k}"><i class="${a.icon}"></i><span><b>${a.label}</b><small>${esc(a.text)}</small></span></button>`;
      })
      .join("");
    const hint = allowed.length === 2 ? `<p class="dgops-quiet">Pin and disarm need Unarmed Combat with both hands free. Use the unarmed attack for those.</p>` : "";
    return `<h3>What does ${esc(this.actor.name)} do?</h3><div class="dgops-wiz__cards">${cards}</div>${hint}${this.weapons().length > 1 ? `<div class="dgops-wiz__nav">${btn("back", "<i class=\"fas fa-arrow-left\"></i> Change weapon", { to: "weapon" }, "subtle")}</div>` : ""}`;
  }

  on_pickAction(data) {
    this.d.action = data.actionKey;
    this.step = this.d.action === "called" ? "called" : "situation";
    this.render();
  }

  /* ---- Step: called shot ---- */
  step_called() {
    const opt = setting("optionalCritEffects");
    const cards = Object.entries(CALLED_SHOTS)
      .filter(([k, v]) => k !== "none" && (opt || !v.effect))
      .map(([k, v]) => {
        const label = v.label.replace(/^Optional:\s*/, "").replace(/\s*\(.*$/, "");
        const what = { partial: "Shoot around cover that hides part of them.", mostly: "Only a sliver is showing.", stun: "A hit stuns them instead of the usual effect.", fleshWound: "Wound without killing: half damage.", headShot: "A hit counts as a critical." }[k] ?? "";
        return `<button type="button" class="dgops-wiz__card ${this.d.called === k ? "on" : ""}" data-dgops-app="pickCalled" data-key="${k}"><b class="dgops-wiz__mod">${v.mod}%</b><span><b>${esc(label)}</b><small>${esc(what)}</small></span></button>`;
      })
      .join("");
    return `<h3>Called shot</h3><div class="dgops-wiz__cards">${cards}</div><div class="dgops-wiz__nav">${btn("back", "<i class=\"fas fa-arrow-left\"></i> Back", { to: "action" }, "subtle")}</div>`;
  }

  on_pickCalled(data) {
    this.d.called = data.key;
    this.step = "situation";
    this.render();
  }

  on_back(data) {
    if (data.to === "weapon") this.item = null;
    this.step = data.to;
    this.render();
  }

  /* ---- Step: situation ---- */
  step_situation() {
    const actor = this.actor;
    const item = this.item;
    const modes = fireModesFor(item);
    if (!modes[this.d.fireMode]) this.d.fireMode = "single";
    const c = computeAttack(actor, item, this.d);
    const melee = c.prof.melee;
    const targets = this.targets();
    const state = attackerState(actor);
    const fields = [];

    if (Object.keys(modes).length > 1) fields.push(row("Fire", sel("fireMode", modes, this.d.fireMode), FIRE_MODES[this.d.fireMode]?.ammo > 1 ? `${FIRE_MODES[this.d.fireMode].ammo} rounds` : ""));
    if (melee) fields.push(row("Target", sel("tm", COMBAT_MODIFIERS.targetMelee, this.d.tm)));
    else {
      const band = this.d.distance !== null && this.d.distance !== undefined ? `${Math.round(this.d.distance)} m: ${BAND_TEXT[this.d.band] ?? ""}` : "";
      fields.push(row("Range", sel("range", COMBAT_MODIFIERS.range, this.d.range), band));
      fields.push(row("Target", sel("tr", COMBAT_MODIFIERS.targetRanged, this.d.tr)));
    }
    fields.push(row(actor.type === "agent" ? "Agent" : "Attacker", sel("att", COMBAT_MODIFIERS.attacker, this.d.att)));
    fields.push(row("Visibility", sel("vis", COMBAT_MODIFIERS.visibility, this.d.vis)));
    const cap = capacityOf(item);
    if (!melee && cap) fields.push(row("Ammunition", sel("ammo", { std: "Standard", hp: "Hollow point (+1 dmg, armor ×2)", ap: "Armor piercing (armor −5, dmg −1)" }, this.d.ammo)));

    const checks = [];
    checks.push(`<label data-tooltip="The target is unaware and the fight hasn't started: +20%, and any success is a critical (p.53)."><input type="checkbox" name="surprise" ${this.d.surprise ? "checked" : ""} data-dgops-change="field"> Surprise attack</label>`);
    if (c.prof.explosive) checks.push(`<label data-tooltip="Explosives only need to land in the zone: +20% (p.57)."><input type="checkbox" name="blast" ${this.d.blast ? "checked" : ""} data-dgops-change="field"> Throwing into a blast zone</label>`);
    checks.push(`<label class="dgops-wiz__other">Other modifier <input type="number" name="mod" value="${Number(this.d.mod) || 0}" step="10" data-dgops-change="field"></label>`);

    // Targets and what the automation already knows about them
    const tRows = targets
      .map((t) => {
        const tc = targetConditions(t, { melee });
        const chips = conditionChips(tc, { melee })
          .map((ch) => `<span class="dgops-chip ${ch.tone}">${esc(ch.text)}</span>`)
          .join("");
        const dist = this.token ? distanceBetween(this.token, t) : null;
        const far = melee && dist !== null && dist > 2.5 ? `<span class="dgops-chip warn">${Math.round(dist)} m away</span>` : "";
        return `<div class="dgops-trow"><img src="${esc(t.texture?.src ?? t.actor?.img)}" alt=""><span class="dgops-trow__name">${esc(t.name)}</span><span class="dgops-trow__act">${chips}${far}</span></div>`;
      })
      .join("");
    const multi = targets.length > 1 && !c.prof.killRadius ? `<p class="dgops-note">One attack hits one target (p.54). Only ${esc(targets[0].name)} will be attacked.</p>` : "";

    // Ammo check
    let ammoWarn = "";
    if (cap) {
      const rounds = item.getFlag(MODULE_ID, "rounds") ?? cap;
      const need = FIRE_MODES[this.d.fireMode]?.ammo ?? 1;
      if (rounds < need) ammoWarn = `<p class="dgops-note warn">${rounds ? `Only ${rounds} round${rounds === 1 ? "" : "s"} left.` : "Empty: reloading takes an action."}</p>`;
    }

    // Blocks and warnings about the attacker
    const blocks = state.blocks.map((b) => `<p class="dgops-note bad">${esc(b.text)}</p>`).join("");
    const warns = state.warns.filter((w) => w.kind !== "suppressed").map((w) => `<p class="dgops-note warn">${esc(w.text)}</p>`).join("");
    const suppressed = state.warns.find((w) => w.kind === "suppressed");

    const breakdown = c.parts.length
      ? c.parts.map((p) => `<li${p.auto ? ` class="auto" data-tooltip="Comes from a condition on the sheet"` : ""}><span>${esc(p.label)}</span><b>${p.mod > 0 ? "+" : "−"}${Math.abs(p.mod)}</b></li>`).join("")
      : "";
    const first = targets[0];
    const autoHit = first && !c.prof.killRadius && targetConditions(first).helpless;
    let action;
    if (state.blocks.length) {
      const pinned = state.blocks.find((b) => b.kind === "pinned");
      action = `${pinned ? btn("escape", "Try to escape", {}, "primary big") : ""}${game.user.isGM ? btn("roll", "Roll anyway", {}, "subtle") : ""}`;
    } else if (suppressed && !this.d.paySan) {
      action = `<p class="dgops-note warn">${esc(suppressed.text)}</p><div class="dgops-buttons">${btn("suppress", "Get to cover", { c: "cover" })}${btn("suppress", "Go prone", { c: "prone" })}${btn("braveFire", "Spend 1 SAN and attack", {}, "primary")}</div>`;
    } else if (autoHit) action = btn("roll", `<i class="fas fa-skull"></i> ${esc(first.name)} is helpless: hit automatically`, {}, "primary big");
    else action = btn("roll", `<i class="fas fa-dice-d20"></i> Roll ${c.target}%`, {}, "primary big");

    const actLabel = this.d.action === "called" ? `Called shot: ${CALLED_SHOTS[this.d.called]?.label.replace(/^Optional:\s*/, "").replace(/\s*\(.*$/, "")}` : ACTIONS[this.d.action]?.label;
    return `
      <div class="dgops-wiz__chosen"><b>${esc(item.name)}</b> · ${esc(actLabel)} ${btn("back", "Change", { to: "action" }, "subtle")}</div>
      ${tRows ? `<div class="dgops-wiz__targets">${tRows}</div>` : ""}${multi}
      <div class="dgops-wiz__fields">${fields.join("")}</div>
      <div class="dgops-row dgops-toggles">${checks.join("")}</div>
      ${blocks}${warns}${ammoWarn}
      <footer class="dgops-sum">
        <ul class="dgops-breakdown"><li><span>${esc(c.skillLabel)}</span><b>${c.base}%</b></li>${breakdown}</ul>
        <div class="dgops-final">
          ${c.capped ? `<p class="dgops-note">Bonuses stack to +40% at most; penalties have no limit (p.52).</p>` : ""}
          ${action}
        </div>
      </footer>
      ${setting("tips") ? `<p class="dgops-tip">Shift-click a weapon on the sheet to roll it without this window.</p>` : ""}`;
  }

  change_field(el) {
    if (el?.name) this.touched.add(el.name);
    Object.assign(this.d, this.formData());
    this.render();
  }

  async on_roll() {
    Object.assign(this.d, this.formData());
    this.close();
    await rollAttack(this.actor, this.item, this.d, { targets: this.targets().slice(0, 1), token: this.token });
  }

  async on_braveFire() {
    this.d.paySan = true;
    this.render();
  }

  async on_suppress(data) {
    this.close();
    await suppressChoice(this.actor, data.c);
  }

  async on_escape() {
    this.close();
    await escapePin(this.actor);
  }
}

export async function openAttackWizard(actor, itemId = null, token = null) {
  const existing = foundry.applications.instances.get(`dgops-attack-${actor.id}`);
  if (existing) await existing.close();
  return new AttackWizard(actor, itemId, token).render({ force: true });
}
