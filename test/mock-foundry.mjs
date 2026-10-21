/**
 * A small stand-in for the Foundry runtime: just enough for the module's flows to run under Node.
 * Dice are scripted: queue results with dice.push(...) and every die rolled takes the next value
 * (falling back to its maximum when the queue is empty, so tests never depend on chance).
 */

export const dice = {
  queue: [],
  push(...v) {
    this.queue.push(...v);
  },
  next(faces) {
    return this.queue.length ? this.queue.shift() : faces;
  },
};

const getProperty = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setProperty(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (k.startsWith("-=")) return;
    o[k] ??= {};
    o = o[k];
  }
  const last = parts.at(-1);
  if (last.startsWith("-=")) delete o[last.slice(2)];
  else o[last] = value;
}
const deepClone = (v) => (v === undefined ? undefined : structuredClone(v));
function mergeObject(a, b) {
  const out = deepClone(a) ?? {};
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") out[k] = mergeObject(out[k], v);
    else out[k] = deepClone(v);
  }
  return out;
}
let idn = 0;
const randomID = (n = 16) => `id${String(++idn).padStart(n - 2, "0")}`;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------------- Dice ---------------- */

class Roll {
  constructor(formula, data = {}) {
    this.formula = String(formula);
    this.data = data;
    this.dice = [];
  }
  async evaluate() {
    const f = this.formula.replace(/\s+/g, "");
    const expr = f.replace(/(\d*)[dD](\d+)/g, (_, n, faces) => {
      const count = Number(n || 1);
      const results = Array.from({ length: count }, () => dice.next(Number(faces)));
      this.dice.push({ faces: Number(faces), results: results.map((result) => ({ result })) });
      return `(${results.join("+")})`;
    });
    if (!/^[\d+\-*/().]*$/.test(expr)) throw new Error(`mock Roll can't parse ${this.formula}`);
    this.total = expr ? Function(`"use strict"; return (${expr});`)() : 0;
    return this;
  }
  async render() {
    return `<div class="roll">${this.total}</div>`;
  }
}

/** The system's percentile roll: target from the actor's SAN / stat×5 / skill. */
class DGPercentileRoll {
  constructor(formula, data, { rollType, key, actor } = {}) {
    this.type = rollType;
    this.key = key;
    this.actor = actor;
    this.modifier = 0;
    this.options = {};
  }
  get target() {
    const s = this.actor?.system ?? {};
    if (this.type === "sanity") return Number(s.sanity?.value) || 0;
    if (this.type === "stat") return (Number(s.statistics?.[this.key]?.value) || 0) * 5;
    return Number(s.skills?.[this.key]?.proficiency ?? s.typedSkills?.[this.key]?.proficiency) || 0;
  }
  get rollTargetModifier() {
    return 0;
  }
  get effectiveTarget() {
    return Math.max(1, Math.min(99, this.target + this.modifier));
  }
  async evaluate() {
    this.total = dice.next(100);
    return this;
  }
  get isSuccess() {
    return this.total === 1 || (this.total !== 100 && this.total <= this.effectiveTarget);
  }
  get isCritical() {
    return this.total === 1 || this.total === 100 || (this.total % 11 === 0 && this.total < 100);
  }
  async toChat() {
    return ChatMessage.create({ content: `${this.type} ${this.total}`, rolls: [this] });
  }
}
class DGRoll {
  async toMessage(data = {}) {
    return ChatMessage.create(data);
  }
}
class DGLethalityRoll extends DGPercentileRoll {}

/* ---------------- Documents ---------------- */

const actors = new Map();
const messages = [];

class Doc {
  constructor(data) {
    Object.assign(this, deepClone(data));
    this.flags ??= {};
  }
  getFlag(scope, key) {
    return getProperty(this.flags?.[scope] ?? {}, key);
  }
  async setFlag(scope, key, value) {
    setProperty(this.flags, `${scope}.${key}`, deepClone(value));
    return this;
  }
  async update(data, options = {}) {
    const changed = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.includes(".")) setProperty(changed, k, v);
      else changed[k] = v;
    }
    for (const fn of hooks.preUpdateActor ?? []) if (this.documentName === "Actor") fn(this, changed, options, game.user.id);
    const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) && !k.startsWith("-=") ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
    for (const [k, v] of flat(changed)) setProperty(this, k, deepClone(v));
    this.updates = (this.updates ?? 0) + 1;
    return this;
  }
  canUserModify() {
    return true;
  }
  testUserPermission(user) {
    return user.isGM || (this.owners ?? []).includes(user.id);
  }
  get isOwner() {
    return this.testUserPermission(game.user);
  }
}

class MockItem extends Doc {
  documentName = "Item";
}

class MockActor extends Doc {
  documentName = "Actor";
  constructor(data) {
    super(data);
    this.id ??= randomID();
    this.uuid = `Actor.${this.id}`;
    this.items = new Map((data.items ?? []).map((i) => [i.id, new MockItem(i)]));
    this.items.filter = (fn) => [...this.items.values()].filter(fn);
    this.statuses = new Set();
    this.effects = [];
    this.folder = null;
  }
  get itemTypes() {
    const out = { bond: [], motivation: [], tome: [] };
    for (const i of this.items.values()) (out[i.type] ??= []).push(i);
    return out;
  }
  get hasPlayerOwner() {
    return false;
  }
  get prototypeToken() {
    return { texture: { src: this.img } };
  }
  getActiveTokens() {
    return [];
  }
  async toggleStatusEffect(id, { active }) {
    if (active) this.statuses.add(id);
    else this.statuses.delete(id);
  }
  async createEmbeddedDocuments(name, data) {
    if (name === "ActiveEffect") {
      const docs = data.map((d) => new Doc({ id: randomID(), ...d }));
      this.effects.push(...docs);
      return docs;
    }
    const docs = data.map((d) => new MockItem({ id: randomID(), ...d }));
    for (const d of docs) this.items.set(d.id, d);
    return docs;
  }
  async updateEmbeddedDocuments() {
    return [];
  }
  async deleteEmbeddedDocuments(name, ids) {
    this.effects = this.effects.filter((e) => !ids.includes(e.id));
  }
}

export function makeAgent({ name = "Agent", san = 50, pow = 10, bp = 40, hp = 10, unnatural = 0, adapt = {}, arts = {}, owners = [], flags = {}, type = "agent" } = {}) {
  const adaptations = Object.fromEntries(["violence", "helplessness"].map((c) => [c, { incident1: (adapt[c] ?? 0) >= 1, incident2: (adapt[c] ?? 0) >= 2, incident3: (adapt[c] ?? 0) >= 3 }]));
  const typedSkills = Object.fromEntries(Object.entries(arts).map(([label, proficiency], i) => [`art${i}`, { label, group: "Art", proficiency }]));
  const a = new MockActor({
    name,
    type,
    img: "",
    owners,
    flags: deepClone(flags),
    system: {
      sanity: { value: san, max: 99, currentBreakingPoint: bp, adaptations, maxBonus: 0 },
      health: { value: hp, max: hp, protection: 0 },
      wp: { value: pow, max: pow },
      statistics: Object.fromEntries(["str", "con", "dex", "int", "pow", "cha"].map((k) => [k, { value: k === "pow" ? pow : 10 }])),
      skills: { unnatural: { proficiency: unnatural, label: "Unnatural" }, occult: { proficiency: 10, label: "Occult" }, psychotherapy: { proficiency: 10 } },
      typedSkills,
      physical: { firstAidAttempted: false, wounds: "" },
    },
  });
  actors.set(a.id, a);
  return a;
}

/* ---------------- Settings, users, hooks ---------------- */

const settingDefs = new Map();
const settingValues = new Map();
const hooks = {};

const gmUser = { id: "gm", name: "Handler", isGM: true, isActiveGM: true, active: true };
const playerUser = { id: "p1", name: "Player", isGM: false, active: true };

export function resetWorld() {
  actors.clear();
  messages.length = 0;
  dice.queue.length = 0;
  for (const k of [...settingValues.keys()]) if (k.startsWith("dg-ops.")) settingValues.delete(k);
  game.time.worldTime = 0;
  game.user = gmUser;
}

export function chat() {
  return messages;
}

/** Answers for DialogV2.wait, in order. Each is { action, data } or a function(spec) → that. */
export const dialogs = [];

class ApplicationV2 {
  render() {
    return this;
  }
}

const g = globalThis;
g.foundry = {
  utils: { getProperty, setProperty, hasProperty: (o, p) => getProperty(o, p) !== undefined, deepClone, mergeObject, randomID, escapeHTML, timeSince: () => "now" },
  applications: {
    api: {
      ApplicationV2,
      DialogV2: {
        async wait(spec) {
          const a = dialogs.shift();
          if (!a) return null;
          return typeof a === "function" ? a(spec) : a;
        },
      },
    },
    instances: new Map(),
  },
};
g.Roll = Roll;
g.CONFIG = { Dice: { rolls: [DGPercentileRoll, DGRoll, DGLethalityRoll] }, statusEffects: [], Actor: { sheetClasses: {} } };
g.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({ alias: actor?.name ?? "Handler" }),
  getWhisperRecipients: (who) => (who === "GM" ? [gmUser] : []),
  async create(data) {
    const m = { id: randomID(), ...data, author: game.user, getFlag: (s, k) => getProperty(m.flags?.[s] ?? {}, k) };
    m.update = async (patch) => {
      for (const [k, v] of Object.entries(patch)) setProperty(m, k, v);
      return m;
    };
    messages.push(m);
    return m;
  },
};
g.ui = { notifications: { warns: [], infos: [], warn(m) { this.warns.push(m); }, info(m) { this.infos.push(m); }, error(m) { this.warns.push(m); } } };
g.Hooks = {
  on(name, fn) {
    (hooks[name] ??= []).push(fn);
  },
  once(name, fn) {
    (hooks[name] ??= []).push(fn);
  },
  callAll(name, ...args) {
    for (const fn of hooks[name] ?? []) fn(...args);
  },
};
g.canvas = { scene: null, tokens: { controlled: [] } };
g.fromUuid = async (u) => actors.get(String(u).replace(/^Actor\./, "")) ?? null;
g.fromUuidSync = (u) => actors.get(String(u).replace(/^Actor\./, "")) ?? null;
g.document = { body: { classList: { add() {}, remove() {} } } };

const users = [gmUser, playerUser];
users.activeGM = gmUser;
users.get = (id) => users.find((u) => u.id === id);

g.game = {
  system: { id: "deltagreen", version: "2.0.1" },
  user: gmUser,
  users,
  time: { worldTime: 0, async advance(s) { this.worldTime += s; } },
  modules: new Map([["dg-ops", { id: "dg-ops", api: null }]]),
  // Messages are delivered to the addressed user by briefly becoming them, so a player's client
  // can call the Handler's and get an answer within one process.
  socket: {
    listeners: [],
    on(_name, fn) {
      this.listeners.push(fn);
    },
    emit(_name, msg) {
      setTimeout(async () => {
        const me = game.user;
        game.user = users.get(msg.to) ?? me;
        try {
          for (const fn of this.listeners) await fn(msg);
        } finally {
          game.user = me;
        }
      }, 0);
    },
  },
  actors: {
    filter: (fn) => [...actors.values()].filter(fn),
    get: (id) => actors.get(id),
    find: (fn) => [...actors.values()].find(fn),
  },
  messages: { get: (id) => messages.find((m) => m.id === id) },
  combat: null,
  settings: {
    register(scope, key, def) {
      settingDefs.set(`${scope}.${key}`, def);
    },
    registerMenu() {},
    get(scope, key) {
      const k = `${scope}.${key}`;
      if (settingValues.has(k)) return deepClone(settingValues.get(k));
      if (!settingDefs.has(k)) throw new Error(`setting ${k} not registered`);
      return deepClone(settingDefs.get(k).default);
    },
    async set(scope, key, value) {
      settingValues.set(`${scope}.${key}`, deepClone(value));
      return value;
    },
    isRegistered: (scope, key) => settingDefs.has(`${scope}.${key}`),
  },
};

/** Set a world value before anything is registered (as a saved world would have it). */
export function preset(key, value) {
  settingValues.set(`dg-ops.${key}`, value);
}

export function asPlayer() {
  game.user = playerUser;
}
export function asGM() {
  game.user = gmUser;
}

export { hooks, settingDefs };
