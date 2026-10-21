/**
 * NPC builder: a small wizard for making NPCs on the spot.
 *   1. Who      archetype, how dangerous, how many
 *   2. Details  name, profession, stats, skills
 *   3. Kit      weapons and armour from the Delta Green system's compendiums
 *   4. Place    folder, disposition, tokens on the scene, unaware, save as template
 * Archetype numbers are the module's own rough guides, not book statblocks.
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { esc } from "../core/ui.mjs";
import { DGOpsApp, btn } from "./base.mjs";

const STATS = ["str", "con", "dex", "int", "pow", "cha"];

/** Skill keys the system's NPC sheet has (Unnatural handled separately). */
export const SKILL_LABELS = {
  accounting: "Accounting", alertness: "Alertness", anthropology: "Anthropology", archeology: "Archeology", artillery: "Artillery", athletics: "Athletics",
  bureaucracy: "Bureaucracy", computer_science: "Computer Science", criminology: "Criminology", demolitions: "Demolitions", disguise: "Disguise", dodge: "Dodge",
  drive: "Drive", firearms: "Firearms", first_aid: "First Aid", forensics: "Forensics", heavy_machiner: "Heavy Machinery", heavy_weapons: "Heavy Weapons",
  history: "History", humint: "HUMINT", law: "Law", medicine: "Medicine", melee_weapons: "Melee Weapons", navigate: "Navigate", occult: "Occult",
  persuade: "Persuade", pharmacy: "Pharmacy", psychotherapy: "Psychotherapy", ride: "Ride", search: "Search", sigint: "SIGINT", stealth: "Stealth",
  surgery: "Surgery", survival: "Survival", swim: "Swim", unarmed_combat: "Unarmed Combat",
};

/**
 * Archetypes. stats: base values; skills: the ones that matter (others keep the system default);
 * weapons/armor: compendium item names; sanMod: shift from POW×5.
 */
export const ARCHETYPES = {
  civilian: { label: "Civilian", icon: "fas fa-user", blurb: "Bystander, witness, neighbour.", stats: { str: 10, con: 10, dex: 10, int: 10, pow: 10, cha: 10 }, skills: { alertness: 30, athletics: 30, dodge: 30, drive: 30, persuade: 30 }, weapons: [], armor: "", profession: "Civilian" },
  cop: { label: "Police officer", icon: "fas fa-shield-halved", blurb: "Patrol officer or deputy.", stats: { str: 11, con: 11, dex: 11, int: 10, pow: 11, cha: 11 }, skills: { alertness: 50, criminology: 40, dodge: 35, drive: 50, firearms: 45, law: 30, melee_weapons: 40, persuade: 40, search: 40, unarmed_combat: 50 }, weapons: ["Medium Pistol", "Baton"], armor: "Kevlar Vest", profession: "Police officer" },
  fed: { label: "Federal agent", icon: "fas fa-id-badge", blurb: "FBI, DEA, ATF, Marshals.", stats: { str: 11, con: 11, dex: 11, int: 12, pow: 11, cha: 11 }, skills: { alertness: 50, bureaucracy: 50, criminology: 50, dodge: 35, drive: 40, firearms: 50, humint: 50, law: 40, persuade: 50, search: 50, unarmed_combat: 50 }, weapons: ["Medium Pistol"], armor: "Kevlar Vest", profession: "Federal agent" },
  soldier: { label: "Soldier", icon: "fas fa-person-rifle", blurb: "Infantry, guard, contractor.", stats: { str: 12, con: 12, dex: 11, int: 10, pow: 11, cha: 9 }, skills: { alertness: 50, athletics: 50, dodge: 40, firearms: 60, first_aid: 30, heavy_weapons: 30, melee_weapons: 40, navigate: 40, stealth: 40, survival: 40, unarmed_combat: 50 }, weapons: ["Rifle (Light)", "Knife"], armor: "Tactical Body Armor", profession: "Soldier" },
  thug: { label: "Criminal", icon: "fas fa-mask", blurb: "Gang member, enforcer, burglar.", stats: { str: 12, con: 11, dex: 11, int: 9, pow: 9, cha: 9 }, skills: { alertness: 40, athletics: 40, criminology: 30, dodge: 35, drive: 40, firearms: 35, melee_weapons: 50, persuade: 30, stealth: 35, unarmed_combat: 55 }, weapons: ["Light Pistol", "Knife"], armor: "", profession: "Criminal" },
  cultist: { label: "Cultist", icon: "fas fa-user-secret", blurb: "True believer. Has seen things.", stats: { str: 10, con: 10, dex: 10, int: 10, pow: 11, cha: 9 }, skills: { alertness: 40, dodge: 30, firearms: 30, melee_weapons: 40, occult: 40, persuade: 40, stealth: 40, unarmed_combat: 40 }, unnatural: 5, sanMod: -25, weapons: ["Knife"], armor: "", profession: "Cultist" },
  leader: { label: "Cult leader", icon: "fas fa-book-skull", blurb: "Charismatic, dangerous, far gone.", stats: { str: 9, con: 10, dex: 10, int: 13, pow: 14, cha: 14 }, skills: { alertness: 50, dodge: 30, firearms: 30, humint: 50, occult: 70, persuade: 65, psychotherapy: 30, stealth: 30 }, unnatural: 20, sanMod: -45, weapons: ["Light Pistol"], armor: "", profession: "Cult leader" },
  scholar: { label: "Scientist / academic", icon: "fas fa-flask", blurb: "Researcher, professor, analyst.", stats: { str: 9, con: 10, dex: 10, int: 14, pow: 11, cha: 10 }, skills: { alertness: 40, anthropology: 30, computer_science: 40, history: 40, occult: 20, persuade: 30, search: 50 }, weapons: [], armor: "", profession: "Scientist" },
  medic: { label: "Medic / doctor", icon: "fas fa-user-doctor", blurb: "EMT, nurse, physician.", stats: { str: 10, con: 11, dex: 12, int: 13, pow: 11, cha: 11 }, skills: { alertness: 40, first_aid: 60, medicine: 50, persuade: 40, pharmacy: 40, psychotherapy: 20, surgery: 40 }, weapons: [], armor: "", profession: "Medic" },
  custom: { label: "Blank", icon: "fas fa-pen", blurb: "System defaults. Build it yourself.", stats: { str: 10, con: 10, dex: 10, int: 10, pow: 10, cha: 10 }, skills: {}, weapons: [], armor: "", profession: "" },
};

export const THREAT = {
  pushover: { label: "Pushover", stat: -2, skill: -15 },
  average: { label: "Average", stat: 0, skill: 0 },
  seasoned: { label: "Seasoned", stat: 1, skill: 10 },
  elite: { label: "Elite", stat: 2, skill: 20 },
};

const FIRST = ["Alex", "Amira", "Ben", "Carla", "Dale", "Dana", "Darnell", "Elena", "Eli", "Frank", "Grace", "Hector", "Ivy", "Jamal", "Jen", "Joe", "Kara", "Kenji", "Lena", "Luis", "Marcus", "Maria", "Mike", "Nadia", "Nate", "Olga", "Pat", "Priya", "Quinn", "Ray", "Rosa", "Sam", "Sean", "Tasha", "Tom", "Uma", "Vic", "Wes", "Yusuf", "Zoe"];
const LAST = ["Adams", "Baker", "Bauer", "Castillo", "Chen", "Cole", "Diaz", "Doyle", "Ellis", "Fischer", "Garcia", "Grant", "Hale", "Ito", "Jensen", "Kaur", "Kowalski", "Larsen", "Lopez", "Meyer", "Morales", "Nguyen", "Novak", "Okafor", "Owens", "Park", "Patel", "Quinn", "Reyes", "Rossi", "Shaw", "Silva", "Stone", "Tanaka", "Turner", "Vance", "Walsh", "Weber", "Young", "Zimmer"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const randomName = () => `${pick(FIRST)} ${pick(LAST)}`;
const roll3d6 = () => [0, 0, 0].reduce((s) => s + 1 + Math.floor(Math.random() * 6), 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function templates() {
  try {
    return game.settings.get(MODULE_ID, "npcTemplates") ?? {};
  } catch {
    return {};
  }
}

/** The finished choices for one NPC, from an archetype and threat level. */
export function fromArchetype(key, threat = "average") {
  const tpl = templates()[key];
  const a = tpl ?? ARCHETYPES[key] ?? ARCHETYPES.custom;
  const t = THREAT[threat] ?? THREAT.average;
  const stats = Object.fromEntries(STATS.map((s) => [s, clamp((a.stats?.[s] ?? 10) + (tpl ? 0 : t.stat), 3, 18)]));
  const skills = Object.fromEntries(Object.entries(a.skills ?? {}).map(([k, v]) => [k, clamp(v + (tpl ? 0 : t.skill), 0, 99)]));
  return {
    archetype: key,
    threat,
    name: "",
    profession: a.profession ?? "",
    description: "",
    stats,
    skills,
    unnatural: a.unnatural ?? 0,
    sanMod: a.sanMod ?? 0,
    weapons: [...(a.weapons ?? [])],
    armor: a.armor ?? "",
  };
}

export function derived(d) {
  const hp = Math.ceil((d.stats.str + d.stats.con) / 2);
  const san = clamp(d.stats.pow * 5 + (Number(d.sanMod) || 0), 0, 99 - (Number(d.unnatural) || 0));
  return { hp, wp: d.stats.pow, san, bp: Math.max(0, san - d.stats.pow) };
}

/* ------------------------------------------------------------------------ */
/*  Compendium gear                                                         */
/* ------------------------------------------------------------------------ */

const GEAR_PACKS = { firearms: "deltagreen.firearms", melee: "deltagreen.hand-to-hand-weapons", armor: "deltagreen.armor" };

export async function gearIndex() {
  const out = { firearms: [], melee: [], armor: [] };
  for (const [k, id] of Object.entries(GEAR_PACKS)) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const idx = await pack.getIndex();
    out[k] = [...idx].map((e) => ({ id: e._id, name: e.name, pack: id })).filter((e) => e.name !== "Unarmed Attack").sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

async function gearItem(name) {
  for (const id of Object.values(GEAR_PACKS)) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const idx = await pack.getIndex();
    const hit = [...idx].find((e) => e.name.toLowerCase() === String(name).toLowerCase());
    if (!hit) continue;
    const doc = await pack.getDocument(hit._id);
    const data = doc.toObject();
    delete data._id;
    data.system = { ...(data.system ?? {}), equipped: true };
    if (data.name === "Unarmed Attack") data.flags = { ...(data.flags ?? {}), deltagreen: { ...(data.flags?.deltagreen ?? {}), SystemName: "unarmed-attack" } };
    return data;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/*  Creating                                                                */
/* ------------------------------------------------------------------------ */

async function folderFor(name) {
  if (!name) return null;
  const existing = game.folders.find((f) => f.type === "Actor" && f.name === name);
  if (existing) return existing.id;
  const F = foundry.utils.getDocumentClass?.("Folder") ?? globalThis.Folder;
  const f = await F.create({ name, type: "Actor", color: "#1a1a1a" });
  return f?.id ?? null;
}

/**
 * Create NPCs.
 * @param {object} d   builder choices (see fromArchetype)
 * @param {object} o   { count, vary, folder, disposition, place, unaware, open }
 */
export async function createNpcs(d, o = {}) {
  const count = clamp(Number(o.count) || 1, 1, 20);
  const folder = await folderFor(o.folder ?? "Ops NPCs");
  const items = [];
  for (const n of ["Unarmed Attack", ...d.weapons, ...(d.armor ? [d.armor] : [])]) {
    const it = await gearItem(n);
    if (it) items.push(it);
  }
  const ActorCls = foundry.utils.getDocumentClass?.("Actor") ?? globalThis.Actor;
  const made = [];
  for (let i = 0; i < count; i++) {
    const stats = { ...d.stats };
    if (o.vary && count > 1 && i > 0) for (const s of STATS) stats[s] = clamp(stats[s] + Math.floor(Math.random() * 3) - 1, 3, 18);
    const one = { ...d, stats };
    const dv = derived(one);
    let name = d.name?.trim();
    if (!name) name = d.profession ? `${randomName()} (${d.profession})` : randomName();
    else if (count > 1) name = `${name} ${i + 1}`;
    const skills = Object.fromEntries(Object.entries(one.skills).map(([k, v]) => [k, { proficiency: v }]));
    skills.unnatural = { proficiency: Number(one.unnatural) || 0 };
    const data = {
      name,
      type: "npc",
      folder,
      system: {
        statistics: Object.fromEntries(STATS.map((s) => [s, { value: stats[s] }])),
        health: { value: dv.hp, max: dv.hp },
        wp: { value: dv.wp, max: dv.wp },
        sanity: { value: dv.san, currentBreakingPoint: dv.bp },
        skills,
        biography: { profession: d.profession ?? "" },
        shortDescription: d.description ?? "",
      },
      prototypeToken: { name, actorLink: false, disposition: Number(o.disposition ?? -1) },
      items: items.map((x) => foundry.utils.deepClone(x)),
      flags: { [MODULE_ID]: { builtBy: { archetype: d.archetype, threat: d.threat } } },
    };
    made.push(await ActorCls.create(data));
  }
  if (o.place && canvas?.scene) await placeTokens(made, { unaware: o.unaware });
  else if (o.unaware) for (const a of made) await a.toggleStatusEffect?.(STATUS.unaware, { active: true });
  if (o.open && made[0]?.sheet) made[0].sheet.render(true);
  ui.notifications.info(`Created ${made.length} NPC${made.length > 1 ? "s" : ""}${o.place ? " and placed them on the scene" : ""}.`);
  return made;
}

/** Drop tokens in a tight block at the centre of the current view. */
async function placeTokens(actors, { unaware = false } = {}) {
  const size = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const c = canvas.stage?.pivot ?? { x: (canvas.dimensions?.width ?? 2000) / 2, y: (canvas.dimensions?.height ?? 2000) / 2 };
  const cols = Math.ceil(Math.sqrt(actors.length));
  const data = [];
  actors.forEach((a, i) => {
    const x = Math.round((c.x + ((i % cols) - (cols - 1) / 2) * size) / size) * size;
    const y = Math.round((c.y + (Math.floor(i / cols) - (cols - 1) / 2) * size) / size) * size;
    const td = a.prototypeToken?.toObject?.() ?? { ...(a.prototypeToken ?? {}) };
    data.push({ ...td, name: a.name, actorId: a.id, x, y });
  });
  const tokens = await canvas.scene.createEmbeddedDocuments("Token", data);
  if (unaware) for (const t of tokens) await t.actor?.toggleStatusEffect?.(STATUS.unaware, { active: true });
  return tokens;
}

/* ------------------------------------------------------------------------ */
/*  The window                                                              */
/* ------------------------------------------------------------------------ */

const STEPS = ["Who", "Details", "Kit", "Place"];

export class NpcBuilder extends DGOpsApp {
  static BANNER = "Form DD-12 · Persons of interest";

  static DEFAULT_OPTIONS = {
    id: "dgops-npc-builder",
    classes: ["dgops-npcb"],
    window: { title: "NPC builder", icon: "fas fa-user-plus" },
    position: { width: 600, height: "auto" },
  };

  step = 0;
  d = fromArchetype("thug");
  o = { count: 1, vary: true, folder: "Ops NPCs", disposition: -1, place: true, unaware: false, open: false, saveAs: "" };
  gear = null;

  async renderBody() {
    this.gear ??= await gearIndex();
    const crumbs = `<ol class="dgops-wiz__steps">${STEPS.map((s, i) => `<li class="${i === this.step ? "on" : i < this.step ? "done" : ""}">${s}</li>`).join("")}</ol>`;
    const body = [this.s0, this.s1, this.s2, this.s3][this.step].call(this);
    const dv = derived(this.d);
    const foot = `<footer class="dgops-sum dgops-npcb__foot">
      <div class="dgops-npcb__sum"><b>${esc(ARCHETYPES[this.d.archetype]?.label ?? templates()[this.d.archetype]?.label ?? "NPC")}</b> · ${esc(THREAT[this.d.threat]?.label ?? "")} · HP ${dv.hp} · WP ${dv.wp} · SAN ${dv.san}${this.o.count > 1 ? ` · ×${this.o.count}` : ""}</div>
      <div class="dgops-buttons">${this.step ? btn("back", "Back") : ""}${this.step < 3 ? btn("next", "Next", {}, "") : ""}${btn("create", this.o.count > 1 ? `Create ${this.o.count}` : "Create", {}, "primary")}</div>
    </footer>`;
    return `<form class="dgops-panel dgops-wiz">${crumbs}${body}${foot}</form>`;
  }

  /* ---- 1. Who ---- */
  s0() {
    const tpls = templates();
    const card = (k, a, tpl = false) => `<button type="button" class="dgops-wiz__card ${this.d.archetype === k ? "on" : ""}" data-dgops-app="arch" data-key="${esc(k)}"><i class="${tpl ? "fas fa-bookmark" : a.icon}"></i><span><b>${esc(a.label)}</b><small>${esc(tpl ? "Your template" : a.blurb)}</small></span></button>`;
    const cards = Object.entries(ARCHETYPES).map(([k, a]) => card(k, a)).join("") + Object.entries(tpls).map(([k, a]) => card(k, a, true)).join("");
    const threat = Object.entries(THREAT)
      .map(([k, t]) => `<label class="${this.d.threat === k ? "on" : ""}"><input type="radio" name="threat" value="${k}" ${this.d.threat === k ? "checked" : ""} data-dgops-change="threat">${t.label}</label>`)
      .join("");
    return `<h3>Who are they?</h3><div class="dgops-wiz__cards dgops-npcb__arch">${cards}</div>
      <div class="dgops-npcb__row"><div><h3>How dangerous?</h3><div class="dgops-seg">${threat}</div></div>
      <div><h3>How many?</h3><input type="number" min="1" max="20" value="${this.o.count}" data-dgops-change="count" style="width:5em"></div></div>
      ${Object.keys(tpls).length ? `<p class="dgops-quiet">${btn("forgetTemplate", "Forget the selected template", {}, "subtle")}</p>` : ""}`;
  }

  on_arch(ds) {
    const keep = { name: this.d.name, threat: this.d.threat };
    this.d = { ...fromArchetype(ds.key, keep.threat), name: keep.name };
    this.render();
  }

  change_threat(el) {
    const name = this.d.name;
    this.d = { ...fromArchetype(this.d.archetype, el.value), name };
    this.render();
  }

  change_count(el) {
    this.o.count = clamp(Number(el.value) || 1, 1, 20);
    this.render();
  }

  async on_forgetTemplate() {
    const t = templates();
    if (!t[this.d.archetype]) return;
    delete t[this.d.archetype];
    await game.settings.set(MODULE_ID, "npcTemplates", t);
    this.d = fromArchetype("thug", this.d.threat);
    this.render();
  }

  /* ---- 2. Details ---- */
  s1() {
    const dv = derived(this.d);
    const stats = STATS.map((s) => `<label class="dgops-npcb__stat"><span>${s.toUpperCase()}</span><input type="number" min="3" max="18" value="${this.d.stats[s]}" data-stat="${s}" data-dgops-change="stat"><small>×5 = ${this.d.stats[s] * 5}%</small></label>`).join("");
    const skillRows = Object.entries(this.d.skills)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<label class="dgops-npcb__skill"><span>${esc(SKILL_LABELS[k] ?? k)}</span><input type="number" min="0" max="99" value="${v}" data-skill="${k}" data-dgops-change="skill"><a data-dgops-app="dropSkill" data-skill="${k}" data-tooltip="Back to the system default"><i class="fas fa-xmark"></i></a></label>`)
      .join("");
    const addable = Object.entries(SKILL_LABELS).filter(([k]) => !(k in this.d.skills));
    return `<div class="dgops-npcb__row">
        <label class="dgops-wiz__field" style="flex:2"><span>Name ${this.o.count > 1 ? "<small>(numbered)</small>" : "<small>(blank = random)</small>"}</span><span class="dgops-npcb__name"><input type="text" value="${esc(this.d.name)}" data-dgops-change="name" placeholder="Random">${btn("randomName", '<i class="fas fa-dice"></i>', {}, "")}</span></label>
        <label class="dgops-wiz__field" style="flex:1"><span>Profession</span><input type="text" value="${esc(this.d.profession)}" data-dgops-change="profession"></label>
      </div>
      <label class="dgops-wiz__field"><span>One line for the sheet</span><input type="text" value="${esc(this.d.description)}" data-dgops-change="description" placeholder="e.g. Nervous. Chain-smokes. Knows the night shift."></label>
      <h3>Statistics</h3>
      <div class="dgops-npcb__stats">${stats}</div>
      <div class="dgops-buttons">${btn("roll3d6", '<i class="fas fa-dice"></i> Roll 3D6 each')}${btn("resetStats", "Archetype values", {}, "subtle")}</div>
      <p class="dgops-npcb__derived">HP <b>${dv.hp}</b> · WP <b>${dv.wp}</b> · SAN <b>${dv.san}</b> · Breaking Point <b>${dv.bp}</b> · Unnatural <input type="number" min="0" max="99" value="${this.d.unnatural}" data-dgops-change="unnatural" style="width:4em">%</p>
      <h3>Skills <small class="dgops-quiet">(anything not listed keeps the system's default)</small></h3>
      <div class="dgops-npcb__skills">${skillRows || `<p class="dgops-empty">Only system defaults.</p>`}</div>
      <div class="dgops-buttons"><select data-dgops-change="addSkill"><option value="">+ Add a skill…</option>${addable.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>`;
  }

  change_name(el) {
    this.d.name = el.value;
  }
  change_profession(el) {
    this.d.profession = el.value;
  }
  change_description(el) {
    this.d.description = el.value;
  }
  change_stat(el) {
    this.d.stats[el.dataset.stat] = clamp(Number(el.value) || 3, 3, 18);
    this.render();
  }
  change_skill(el) {
    this.d.skills[el.dataset.skill] = clamp(Number(el.value) || 0, 0, 99);
  }
  change_unnatural(el) {
    this.d.unnatural = clamp(Number(el.value) || 0, 0, 99);
    this.render();
  }
  change_addSkill(el) {
    if (el.value) this.d.skills[el.value] = 40;
    this.render();
  }
  on_dropSkill(ds) {
    delete this.d.skills[ds.skill];
    this.render();
  }
  on_randomName() {
    this.d.name = randomName();
    this.render();
  }
  on_roll3d6() {
    for (const s of STATS) this.d.stats[s] = roll3d6();
    this.render();
  }
  on_resetStats() {
    this.d.stats = fromArchetype(this.d.archetype, this.d.threat).stats;
    this.render();
  }

  /* ---- 3. Kit ---- */
  s2() {
    const g = this.gear;
    const chosen = new Set(this.d.weapons);
    const list = (arr) => arr.map((e) => `<label><input type="checkbox" data-weapon="${esc(e.name)}" ${chosen.has(e.name) ? "checked" : ""} data-dgops-change="weapon"> ${esc(e.name)}</label>`).join("") || `<p class="dgops-empty">Compendium not found.</p>`;
    return `<p class="dgops-quiet">From the Delta Green system's compendiums. Every NPC also gets Unarmed Attack.</p>
      <div class="dgops-two">
        <div><h3>Firearms</h3><div class="dgops-npcb__gear">${list(g.firearms)}</div></div>
        <div><h3>Hand-to-hand</h3><div class="dgops-npcb__gear">${list(g.melee)}</div></div>
      </div>
      <h3>Armour</h3><select data-dgops-change="armor"><option value="">None</option>${g.armor.map((e) => `<option ${e.name === this.d.armor ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>`;
  }

  change_weapon(el) {
    const s = new Set(this.d.weapons);
    if (el.checked) s.add(el.dataset.weapon);
    else s.delete(el.dataset.weapon);
    this.d.weapons = [...s];
  }
  change_armor(el) {
    this.d.armor = el.value;
    this.render();
  }

  /* ---- 4. Place ---- */
  s3() {
    const o = this.o;
    const disp = { "-1": "Hostile", 0: "Neutral", 1: "Friendly", "-2": "Secret" };
    return `<div class="dgops-npcb__row">
        <label class="dgops-wiz__field"><span>Folder</span><input type="text" value="${esc(o.folder)}" data-opt="folder" data-dgops-change="opt"></label>
        <label class="dgops-wiz__field"><span>Token disposition</span><select data-opt="disposition" data-dgops-change="opt">${Object.entries(disp).map(([k, l]) => `<option value="${k}" ${String(o.disposition) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <label class="dgops-check"><input type="checkbox" data-opt="place" ${o.place ? "checked" : ""} data-dgops-change="opt"> Put their tokens on the scene (middle of your view)</label>
      <label class="dgops-check"><input type="checkbox" data-opt="unaware" ${o.unaware ? "checked" : ""} data-dgops-change="opt"> Unaware (can be surprised)</label>
      ${o.count > 1 ? `<label class="dgops-check"><input type="checkbox" data-opt="vary" ${o.vary ? "checked" : ""} data-dgops-change="opt"> Vary their statistics a little (±1)</label>` : ""}
      <label class="dgops-check"><input type="checkbox" data-opt="open" ${o.open ? "checked" : ""} data-dgops-change="opt"> Open the sheet afterwards</label>
      <h3>Template</h3>
      <label class="dgops-wiz__field"><span>Save these choices as a template called…</span><input type="text" value="${esc(o.saveAs)}" data-opt="saveAs" data-dgops-change="opt" placeholder="e.g. Fairfield deputy"></label>`;
  }

  change_opt(el) {
    const k = el.dataset.opt;
    this.o[k] = el.type === "checkbox" ? el.checked : k === "disposition" ? Number(el.value) : el.value;
  }

  on_next() {
    this.step = Math.min(3, this.step + 1);
    this.render();
  }
  on_back() {
    this.step = Math.max(0, this.step - 1);
    this.render();
  }

  async on_create() {
    if (!game.user.isGM) return ui.notifications.warn("Only the Handler can create NPCs.");
    if (this.o.saveAs?.trim()) {
      const t = templates();
      const key = `tpl-${this.o.saveAs.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      t[key] = { label: this.o.saveAs.trim(), stats: { ...this.d.stats }, skills: { ...this.d.skills }, unnatural: this.d.unnatural, sanMod: this.d.sanMod, weapons: [...this.d.weapons], armor: this.d.armor, profession: this.d.profession };
      await game.settings.set(MODULE_ID, "npcTemplates", t);
    }
    const made = await createNpcs(this.d, this.o);
    this.close();
    return made;
  }
}

export function openNpcBuilder() {
  const existing = foundry.applications.instances.get("dgops-npc-builder");
  if (existing) return existing.render({ force: true });
  return new NpcBuilder().render({ force: true });
}
