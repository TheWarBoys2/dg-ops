/**
 * Chat cards and button actions.
 * Buttons: <button data-dgops="action" data-args='{"…"}' data-owner="ActorUuid" data-once="key">.
 */
import { MODULE_ID } from "./constants.mjs";
import { esc } from "./ui.mjs";
import { gm, registerHandler } from "./socket.mjs";
import { showRoll } from "./dice.mjs";
import { modeRecipients, visibilityOf } from "./mode.mjs";

const actions = new Map();

export function registerAction(name, fn) {
  actions.set(name, fn);
}

export function outcomeBadge(o) {
  if (!o) return "";
  if (o.success && o.critical) return `<span class="dgops-badge crit">Critical success</span>`;
  if (o.success) return `<span class="dgops-badge success">Success</span>`;
  if (o.fumble) return `<span class="dgops-badge fumble">Fumble</span>`;
  return `<span class="dgops-badge fail">Failure</span>`;
}

/** What each card button does, shown as a tooltip unless a specific tip is given. */
export const ACTION_TIPS = {
  atkResolve: "Checks how the target can defend, then whether it lands.",
  applySanToRoll: "Pick the SAN loss for this roll. The player can project onto a Bond before it lands.",
  sanFromDamageCard: "Runs the full SAN test, with these losses, for every selected token.",
  applyDamageCard: "Applies this damage to your targets after armour, cover and protection.",
  applyLethalityCard: "Applies this Lethality roll to your targets after cover and protection.",
  repress: "Spend 1D4 WP and lean on a Bond, then roll SAN. Success: behave normally (p.75).",
  talkDown: "Another Agent rolls Psychotherapy to talk them down. Only if things are calm (p.69).",
  insanityReaction: "The Agent's panic response (p.69).",
  assignDisorder: "Handler: choose the disorder. Typical ones for this kind of trauma are starred.",
  crossMotivation: "Each Breaking Point costs one personal motivation (p.38).",
  permanentInsanity: "Handler takes control of the Agent (p.73).",
  sanPreset: "Roll this SAN test. The player can project onto a Bond.",
  stunRecover: "CON×5: success means acting normally next turn (p.55).",
  permanentInjury: "Handler picks the stat (or injury) the wound costs (p.55).",
  undo: "Handler: put the actor back exactly as they were before this card.",
  insight: "Optional rule: +1D6% Unnatural (p.69).",
  escapePin: "STR×5 or Unarmed Combat, opposed by whoever is pinning them.",
};

export function button(action, label, { args = {}, owner = null, once = null, icon = null, cls = "", tip = null } = {}) {
  const t = tip ?? ACTION_TIPS[action];
  return `<button type="button" class="dgops-btn ${cls}" data-dgops="${esc(action)}" data-args='${esc(JSON.stringify(args))}'${owner ? ` data-owner="${esc(owner)}"` : ""}${once ? ` data-once="${esc(once)}"` : ""}${t ? ` data-tooltip="${esc(t)}"` : ""}>${icon ? `<i class="${esc(icon)}"></i> ` : ""}${esc(label)}</button>`;
}

export function gmWhisper() {
  return ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
}

/**
 * Post a card.
 * @param {object} p
 * @param {Actor} [p.actor]
 * @param {string} p.title
 * @param {string} p.body  HTML
 * @param {Roll[]} [p.rolls]
 * @param {string[]|null} [p.whisper]
 * @param {boolean} [p.blind]
 * @param {object} [p.flags]
 */
const KIND_ICON = { san: "fas fa-brain", combat: "fas fa-crosshairs", damage: "fas fa-droplet", medical: "fas fa-kit-medical", home: "fas fa-house", money: "fas fa-sack-dollar", alert: "fas fa-triangle-exclamation", info: "fas fa-folder" };

export async function postCard({ actor = null, title, body, rolls = [], whisper = null, blind = false, flags = {}, subtitle = "", kind = "info", tip = "", details = "", undo = null, followMode = null }) {
  // Cards that report dice follow the chat box's roll mode, unless the module has to whisper them.
  if (!whisper?.length && (followMode ?? rolls.filter(Boolean).length > 0)) {
    const m = modeRecipients();
    whisper = m.whisper;
    blind = blind || m.blind;
  }
  const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
  // Dice land before the card appears. Rolls already shown by rollFormula() aren't animated again,
  // and they're rendered inline rather than attached, so Dice So Nice doesn't roll them twice.
  const shown = rolls.filter(Boolean);
  for (const r of shown) await showRoll(r, { whisper });
  let diceHtml = "";
  for (const r of shown) {
    try {
      diceHtml += await r.render();
    } catch {
      /* unrenderable roll */
    }
  }
  if (diceHtml) details = `${details}<div class="dgops-dice">${diceHtml}</div>`;
  const undoBtn = undo ? `<div class="dgops-undo">${button("undo", "Undo", { once: "undo", icon: "fas fa-rotate-left", cls: "subtle" })}</div>` : "";
  const portrait = portraitFor(actor);
  const content = `<div class="dgops-card" data-kind="${kind}">
    <header class="dgops-card__header"><img class="dgops-card__portrait" src="${esc(portrait)}" alt=""><div class="dgops-card__head"><span class="dgops-card__title">${title}</span>${subtitle ? `<span class="dgops-card__sub">${subtitle}</span>` : ""}<span class="dgops-card__meta"></span></div><i class="${KIND_ICON[kind] ?? KIND_ICON.info}"></i></header>
    <section class="dgops-card__body">${body}</section>
    ${details ? `<section class="dgops-card__details">${details}</section>` : ""}
    ${tip ? `<p class="dgops-card__tip">${tip}</p>` : ""}
    ${undoBtn}
  </div>`;
  if (undo) flags = foundry.utils.mergeObject(flags, { [MODULE_ID]: { undo } });
  const data = {
    speaker,
    content,
    flags: foundry.utils.mergeObject({ [MODULE_ID]: { card: true } }, flags),
  };
  if (whisper?.length) data.whisper = whisper;
  if (blind) data.blind = true;
  // Foundry always shows a whisper to whoever posted it, so a Handler-only card set off on a
  // player's client (their own SAN roll, say) is posted by the Handler's client instead.
  if (!game.user.isGM && whisper?.length && !whisper.includes(game.user.id) && whisper.every((id) => game.users.get(id)?.isGM)) {
    const id = await gm("gmPostCard", data);
    return (id && game.messages?.get?.(id)) || { id };
  }
  return ChatMessage.create(data);
}

registerHandler("gmPostCard", async (data) => (await ChatMessage.create(data))?.id ?? null);

const DG_ICON = "systems/deltagreen/assets/img/green_delta_icon.webp";

/** Portrait for a card header: the speaking token's image, else the actor's, else the Delta Green mark. */
function portraitFor(actor) {
  if (!actor) return DG_ICON;
  const token = actor.isToken ? actor.token : actor.getActiveTokens?.(true, true)?.[0];
  const src = token?.texture?.src ?? actor.prototypeToken?.texture?.src ?? actor.img;
  return src && !/mystery-man/.test(src) ? src : actor.img || DG_ICON;
}

/** Render-time: make our cards look like the system's (hide Foundry's header, fill ours). */
function dressCard(message, element) {
  const card = element.querySelector(".dgops-card");
  if (!card) return;
  let on = true;
  try {
    on = game.settings.get(MODULE_ID, "systemCards");
  } catch {
    /* settings not ready */
  }
  if (!on) return;
  element.classList?.add("dgops-card-message");
  const meta = card.querySelector(".dgops-card__meta");
  if (!meta || meta.dataset.filled) return;
  meta.dataset.filled = "1";
  const bits = [];
  const alias = message.alias ?? message.speaker?.alias;
  if (alias) bits.push(esc(alias));
  const author = message.author?.name;
  if (author && author !== alias) bits.push(esc(author));
  try {
    if (message.timestamp) bits.push(`<time>${esc(foundry.utils.timeSince(message.timestamp))}</time>`);
  } catch {
    /* no timeSince */
  }
  meta.innerHTML = bits.join(" · ");
}

const VIS_ICON = { public: "fas fa-globe", gm: "fas fa-user-secret", private: "fas fa-user-secret", blind: "fas fa-eye-slash", self: "fas fa-user" };

/** A small "who can see this" mark on our cards and the system's cards (both hide Foundry's header). */
function visibilityMark(message, element) {
  if (element.querySelector(".dgops-vis")) return;
  const v = visibilityOf(message);
  const mark = document.createElement("span");
  mark.className = `dgops-vis dgops-vis--${v.kind}`;
  mark.dataset.tooltip = v.tip;
  mark.innerHTML = `<i class="${VIS_ICON[v.kind]}"></i> ${esc(v.text)}`;
  const ours = element.querySelector(".dgops-card__header");
  if (ours) return ours.append(mark);
  const sys = element.querySelector(".dg-chat-card__metadata");
  if (sys) return sys.prepend(mark);
  if (v.kind !== "public") element.querySelector(".message-header .message-metadata")?.prepend(mark);
}

/** Whisper to owners of an actor + GM when SAN is private, else public. */
export function sanWhisper(actor) {
  let priv = false;
  try {
    priv = game.settings.get("deltagreen", "keepSanityPrivate");
  } catch {
    /* setting missing */
  }
  if (!priv || !actor) return null;
  const ids = new Set(gmWhisper());
  for (const u of game.users) if (actor.testUserPermission(u, "OWNER")) ids.add(u.id);
  return [...ids];
}

registerHandler("markButtonUsed", async (messageId, once, label) => {
  const message = game.messages.get(messageId);
  if (!message) return;
  const used = foundry.utils.deepClone(message.getFlag(MODULE_ID, "used") ?? {});
  used[once] = label ?? true;
  await message.setFlag(MODULE_ID, "used", used);
});

async function markUsed(message, once, label) {
  if (message.isOwner) {
    const used = foundry.utils.deepClone(message.getFlag(MODULE_ID, "used") ?? {});
    used[once] = label ?? true;
    return message.setFlag(MODULE_ID, "used", used);
  }
  return gm("markButtonUsed", message.id, once, label);
}

/** Wire up buttons on render. */
export function onRenderMessage(message, element) {
  dressCard(message, element);
  try {
    visibilityMark(message, element);
  } catch {
    /* never block rendering */
  }
  const used = message.getFlag(MODULE_ID, "used") ?? {};
  let showTips = true;
  let compact = false;
  let undoOn = true;
  try {
    showTips = game.settings.get(MODULE_ID, "tips");
    compact = game.settings.get(MODULE_ID, "compactCards");
    undoOn = game.settings.get(MODULE_ID, "undo");
  } catch {
    /* settings not ready */
  }
  if (!showTips) element.querySelectorAll(".dgops-card__tip").forEach((el) => el.remove());
  if (!game.user.isGM || !undoOn) element.querySelectorAll(".dgops-undo").forEach((el) => el.remove());
  const det = element.querySelector(".dgops-card__details");
  if (det && compact && !det.dataset.wired) {
    det.dataset.wired = "1";
    det.hidden = true;
    const t = document.createElement("a");
    t.className = "dgops-details-toggle";
    t.textContent = "Details";
    t.addEventListener("click", () => {
      det.hidden = !det.hidden;
      t.textContent = det.hidden ? "Details" : "Hide details";
    });
    det.before(t);
  }
  for (const btn of element.querySelectorAll("[data-dgops]")) {
    const once = btn.dataset.once;
    if (once && used[once]) {
      btn.disabled = true;
      btn.classList.add("used");
      if (typeof used[once] === "string") btn.title = used[once];
      continue;
    }
    const ownerUuid = btn.dataset.owner;
    if (ownerUuid) {
      const owner = fromUuidSync(ownerUuid, { strict: false });
      if (owner && !owner.isOwner && !game.user.isGM) {
        btn.disabled = true;
        btn.title = "Only the owner or Handler can use this.";
        continue;
      }
    }
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const fn = actions.get(btn.dataset.dgops);
      if (!fn) return;
      let args = {};
      try {
        args = JSON.parse(btn.dataset.args || "{}");
      } catch {
        /* ignore */
      }
      btn.disabled = true;
      try {
        const result = await fn({ message, args, button: btn });
        if (once && result !== false) await markUsed(message, once, typeof result === "string" ? result : true);
      } catch (e) {
        console.error(e);
        ui.notifications.error(`Delta Green Ops: ${e.message}`);
      } finally {
        if (!once) btn.disabled = false;
      }
    });
  }
}

export function list(items) {
  return `<ul class="dgops-list">${items.filter(Boolean).map((i) => `<li>${i}</li>`).join("")}</ul>`;
}
