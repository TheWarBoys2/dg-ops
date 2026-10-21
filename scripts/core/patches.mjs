/**
 * Non-destructive patches to the Delta Green system's roll classes.
 *  - 0 WP: every test fails, including SAN (p.47)
 *  - one-shot modifiers (distraction −20, aim +20 for attacks)
 *  - attack bonus cap +40 (p.52)
 *  - chat flags describing the roll, and post-roll hooks for automation
 */
import { MODULE_ID, STATUS, warn } from "./constants.mjs";
import { rollClasses } from "./system.mjs";
import { waitForMessageDice } from "./dice.mjs";
import { setting } from "./settings.mjs";
import { capAttackModifiers } from "../rules/dice.mjs";

const postRollHandlers = [];
export function onRoll(fn) {
  postRollHandlers.push(fn);
}

/** Extra flags written onto a roll's chat message (e.g. the attack rows). fn(roll) → object | null. */
const flagProviders = [];
export function addFlagProvider(fn) {
  flagProviders.push(fn);
}

const TESTABLE = new Set(["stat", "skill", "sanity", "weapon", "special-training"]);

function wrapGetter(cls, prop, wrapper) {
  const desc = Object.getOwnPropertyDescriptor(cls.prototype, prop);
  if (!desc?.get) {
    warn(`cannot patch ${cls.name}.${prop}`);
    return;
  }
  Object.defineProperty(cls.prototype, prop, {
    configurable: true,
    get() {
      if (this._dgOpsFrozen && prop in this._dgOpsFrozen) return this._dgOpsFrozen[prop];
      return wrapper.call(this, desc.get.bind(this));
    },
  });
}

/** Aiming: +20% to the attack the turn after aiming (p.50). Shown as the Aiming status. */
export function aimActive(actor) {
  if (!actor?.statuses?.has?.(STATUS.aiming)) return false;
  const aim = actor.getFlag?.(MODULE_ID, "aim");
  const combat = game.combat;
  if (!aim || !combat?.started || aim.combatId !== combat.id) return true;
  return combat.round <= (aim.round ?? 0) + 1;
}

export function distracted(actor) {
  return !!actor?.statuses?.has?.(STATUS.distracted);
}

export function applyPatches() {
  const { DGPercentileRoll, DGRoll, DGLethalityRoll } = rollClasses();
  if (!DGPercentileRoll || !DGRoll) {
    ui.notifications.error("Delta Green Ops: couldn't find the Delta Green roll classes. Is the system at 2.0.1?");
    return false;
  }

  wrapGetter(DGPercentileRoll, "isSuccess", function (orig) {
    const v = orig();
    if (!v) return v;
    if (this instanceof DGLethalityRoll) return v;
    if (!TESTABLE.has(this.type)) return v;
    if (setting("zeroWpAutoFail") && this.actor && ["agent", "npc"].includes(this.actor.type) && Number(this.actor.system?.wp?.value) === 0) return false;
    return v;
  });

  wrapGetter(DGPercentileRoll, "rollTargetModifier", function (orig) {
    const ae = Number(orig()) || 0;
    if (this instanceof DGLethalityRoll || this.type === "luck") return ae;
    const actor = this.actor;
    if (!actor?.getFlag) return ae;
    const distraction = distracted(actor) && TESTABLE.has(this.type) ? -20 : 0;
    const aim = this.type === "weapon" && aimActive(actor) ? 20 : 0;
    this._dgParts = [ae, distraction, aim];
    return ae + distraction + aim;
  });

  wrapGetter(DGPercentileRoll, "effectiveTarget", function (orig) {
    const v = orig();
    if (this instanceof DGLethalityRoll || (this.type !== "weapon" && !this.options?.dgOps?.attack) || !setting("attackCap")) return v;
    const base = parseInt(this.target);
    if (!Number.isFinite(base)) return v;
    const rtm = Number(this.rollTargetModifier) || 0;
    const rtmParts = this._dgParts ?? [rtm];
    const ctxMods = this.options?.dgOps?.mods;
    // Attack-assistant rolls carry their individual modifiers so bonuses can be capped before penalties.
    const mods = Array.isArray(ctxMods) ? [...ctxMods, ...rtmParts] : [Number(this.modifier) || 0, ...rtmParts];
    const total = capAttackModifiers(mods);
    if (!total) return base;
    return Math.max(1, Math.min(99, base + total));
  });

  const origToMessage = DGRoll.prototype.toMessage;
  DGRoll.prototype.toMessage = async function (messageData = {}, options = {}) {
    try {
      const info = describeRoll(this);
      const extra = {};
      for (const fn of flagProviders) {
        try {
          Object.assign(extra, fn(this) ?? {});
        } catch (e) {
          warn("flag provider failed", e);
        }
      }
      messageData.flags = foundry.utils.mergeObject(messageData.flags ?? {}, { [MODULE_ID]: { roll: info, ...extra } });
    } catch (e) {
      warn("describeRoll failed", e);
    }
    const message = await origToMessage.call(this, messageData, options);
    if (message instanceof ChatMessage) {
      // Consequences (fumble cards, ammo, guard…) wait for the dice to land.
      await waitForMessageDice(message.id);
      for (const fn of postRollHandlers) {
        try {
          await fn(this, message);
        } catch (e) {
          warn("post-roll handler failed", e);
        }
      }
    }
    return message;
  };
  return true;
}

/** Serializable description of a system roll for chat flags. */
export function describeRoll(roll) {
  const { DGPercentileRoll, DGLethalityRoll, DGDamageRoll, DGSanityDamageRoll } = rollClasses();
  const base = {
    cls: roll.constructor.name,
    type: roll.type,
    key: roll.key,
    total: roll.total,
    actorUuid: roll.actor?.uuid ?? null,
    itemUuid: roll.item?.uuid ?? null,
    tokenUuid: roll.options?.token?.uuid ?? null,
    context: roll.options?.dgOps ?? {},
    targets: [...(game.user.targets ?? [])].map((t) => t.document?.uuid).filter(Boolean),
  };
  if (DGLethalityRoll && roll instanceof DGLethalityRoll) {
    const nl = roll.nonLethalDamage;
    return { ...base, lethality: true, rating: Number(roll.target) + (Number(roll.modifier) || 0), dice: nl ? [nl.die1, nl.die2] : null };
  }
  if (DGPercentileRoll && roll instanceof DGPercentileRoll) {
    const success = !!roll.isSuccess;
    const crit = !!roll.isCritical;
    // Freeze the result: post-roll handlers clear one-shot modifiers (aim, distraction) that the
    // live getters would otherwise re-read.
    roll._dgOpsFrozen = { isSuccess: success, effectiveTarget: roll.effectiveTarget, rollTargetModifier: roll.rollTargetModifier };
    return { ...base, percentile: true, target: roll.target, effectiveTarget: roll.effectiveTarget, success, critical: success && crit, fumble: !success && crit };
  }
  if (DGSanityDamageRoll && roll instanceof DGSanityDamageRoll) {
    return { ...base, sanityDamage: true, results: roll.damageResults, formula: roll.formula };
  }
  if (DGDamageRoll && roll instanceof DGDamageRoll) {
    return { ...base, damage: true, formula: roll.formula };
  }
  return base;
}
