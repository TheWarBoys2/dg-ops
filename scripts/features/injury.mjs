/**
 * Damage application and its consequences (p.55): stun, unconsciousness, death, permanent injury,
 * First Aid eligibility reset, injury SAN tests, catastrophes for the Delta Green Bond queue.
 *
 * Damage is applied by whoever's client resolved it (document changes go through the Handler where
 * needed). Any test the victim has to make, such as CON×5 against permanent injury, is requested
 * from their player in chat rather than rolled for them.
 */
import { MODULE_ID, STATUS, STAT_KEYS } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { update, setStatus, createEffect } from "../core/ops.mjs";
import { postCard, button, registerAction, list, outcomeBadge } from "../core/chat.mjs";
import { systemTest, statValue, isAgent } from "../core/system.mjs";
import { requestTest, registerContinuation } from "../core/requests.mjs";
import { prompt, esc, options, field } from "../core/ui.mjs";
import { damageOutcome, permanentInjuryReduction, PERMANENT_INJURY_EFFECTS } from "../rules/combat.mjs";
import { queueCatastrophe } from "./sanity.mjs";
import { snapshot } from "../core/snapshot.mjs";
import { DISEASES } from "../rules/hazards.mjs";

/** Once-per-fight SAN incident tracking (p.67: in combat, test the first time each trauma happens). */
function incidentKey(actor, key) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const seen = actor.getFlag(MODULE_ID, "fightIncidents") ?? {};
  if (seen.combatId === combat.id && seen[key]) return false;
  return { ...((seen.combatId === combat.id && seen) || { combatId: combat.id }), [key]: true };
}

/**
 * Apply damage to an actor and handle every consequence.
 * @param {Actor} actor
 * @param {number} amount   Infinity = reduced to 0 HP outright.
 * @param {object} [opts]
 * @param {string} [opts.source]
 * @param {boolean} [opts.attack]  Damage came from being shot/stabbed/strangled.
 * @param {boolean} [opts.stun]    Force a stun (called shot, taser…).
 * @param {boolean} [opts.quiet]   No card unless there is something to click.
 * @param {string[]} [opts.notes]  Extra lines (how the damage was worked out).
 * @param {Roll[]} [opts.rolls]    Dice to show inline on the card (already animated).
 * @returns {Promise<object>} damage outcome
 */
export async function applyDamage(actor, amount, opts = {}) {
  if (!actor) return null;
  const hpBefore = Number(actor.system.health?.value ?? 0);
  const snap = snapshot(actor);
  const lines = [];
  const btns = [];

  if (actor.type === "vehicle") {
    const max = Number(actor.system.health.max ?? 0);
    const dmg = amount === Infinity ? hpBefore : Math.max(0, amount);
    const after = Math.max(0, hpBefore - dmg);
    await update(actor, { "system.health.value": after });
    lines.push(`${esc(actor.name)}: ${hpBefore} → <b>${after}</b> HP`);
    if (after <= 0) lines.push("<b>Demolished.</b> It will never function again.");
    else if (after <= max / 2) {
      lines.push("At half HP or less: operating it needs a Drive or Pilot test; a fumble disables it until repaired (p.95).");
      await update(actor, { [`flags.${MODULE_ID}.crippled`]: true });
    }
    if (!opts.quiet) await postCard({ actor, title: `Damage${opts.source ? `: ${esc(opts.source)}` : ""}`, body: list(lines.concat(opts.notes ?? [])), rolls: opts.rolls ?? [], kind: "damage" });
    return { hpAfter: after, applied: dmg };
  }

  const out = damageOutcome({ hpBefore, damage: amount });
  const data = { "system.health.value": out.hpAfter };
  if (out.applied > 0 && isAgent(actor)) data["system.physical.firstAidAttempted"] = false;
  if (out.applied > 0) data[`flags.${MODULE_ID}.-=aim`] = null;
  if (out.dead) data[`flags.${MODULE_ID}.deathTime`] = game.time.worldTime;
  await update(actor, data);
  if (out.applied > 0) await setStatus(actor, STATUS.aiming, false);
  lines.push(`${esc(actor.name)}: ${hpBefore} → <b>${out.hpAfter}</b> HP (−${out.applied})`);

  if (out.dead) {
    await setStatus(actor, STATUS.dead, true, true);
    lines.push(`<b class="dgops-alert">Dead.</b> Resuscitation is possible within ${statValue(actor, "con")} minutes (CON) if the Handler allows it (First Aid).`);
    if (isAgent(actor)) await queueCatastrophe(actor, "died");
  } else {
    if (out.stunned || opts.stun) {
      await setStatus(actor, STATUS.stun, true);
      lines.push(opts.stun && !out.stunned ? "Stunned." : "Stunned: a single attack took half or more of current HP. CON×5 on their turn to recover.");
    }
    if (out.unconscious) {
      await setStatus(actor, STATUS.unconscious, true);
      lines.push("<b>Unconscious</b> (2 HP or fewer): helpless. Attacks hit automatically and can kill outright. Wakes at 3+ HP or after an hour.");
      if (isAgent(actor)) await queueCatastrophe(actor, "was incapacitated");
    }
  }

  const checkPermanent = out.permanentInjuryCheck && ["agent", "npc"].includes(actor.type) && (isAgent(actor) || !actor.isToken);
  if (checkPermanent) lines.push("Down to 2 HP or fewer: a CON×5 test decides whether the wound is permanent.");

  // Injury SAN tests (p.67)
  if (isAgent(actor) && setting("injurySan") && out.applied > 0 && !out.dead) {
    const offer = [];
    if (opts.attack) offer.push({ key: "stabbedShot", label: "SAN 0/1D4 (shot, stabbed or strangled)" });
    if (out.hpAfter <= 2) offer.push({ key: "twoHP", label: "SAN 0/1D6 (reduced to 2 HP or fewer)" });
    const incidents = {};
    for (const o of offer) {
      const k = incidentKey(actor, o.key);
      if (k === false) continue;
      if (k) Object.assign(incidents, k);
      btns.push(button("sanPreset", o.label, { args: { actorUuid: actor.uuid, preset: o.key }, owner: actor.uuid, once: o.key }));
    }
    if (Object.keys(incidents).length) await update(actor, { [`flags.${MODULE_ID}.fightIncidents`]: incidents });
  }

  // Persistent disease resurgence (p.62)
  const diseases = actor.getFlag(MODULE_ID, "persistentDiseases") ?? [];
  if (diseases.length && out.applied > (actor.system.health.max ?? 0) / 2) {
    btns.push(button("diseaseResurgence", "CON×5 vs disease resurgence", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: "resurge" }));
  }

  if (!opts.quiet || btns.length || out.applied > 0) {
    await postCard({
      actor,
      title: `Damage${opts.source ? `: ${esc(opts.source)}` : ""}`,
      body: list(lines.concat(opts.notes ?? [])) + (btns.length ? `<div class="dgops-buttons">${btns.join("")}</div>` : ""),
      rolls: opts.rolls ?? [],
      kind: "damage",
      undo: out.applied > 0 ? { actorUuid: actor.uuid, snap } : null,
    });
  }

  // The victim rolls their own CON test, so this is a request (or rolled here if it's theirs to roll).
  if (checkPermanent) {
    await requestTest(
      actor,
      { type: "stat", key: "con", context: { permanentInjury: true, noWpCost: true } },
      { title: `${actor.name}: is the wound permanent?`, reason: "<p>Reduced to 2 HP or fewer. Roll CON×5: failure means a permanent injury (p.55).</p>", then: "permInjuryAfter", thenArgs: { actorUuid: actor.uuid }, blocking: false },
    );
  }
  return out;
}

registerContinuation("permInjuryAfter", async ({ actorUuid, outcome }) => {
  const actor = await fromUuid(actorUuid);
  if (!actor) return null;
  if (outcome.success) {
    await postCard({ actor, title: "No permanent injury", body: `<p>${esc(actor.name)} ${outcomeBadge(outcome)} (${outcome.total}): the wound will heal.</p>`, kind: "damage" });
    return { permanent: false };
  }
  const btns = [button("permanentInjury", "Handler: choose the permanent injury", { args: { actorUuid, total: outcome.total }, once: "perminj" })];
  if (isAgent(actor) && setting("injurySan") && incidentKey(actor, "permInjury") !== false) {
    btns.push(button("sanPreset", "SAN 0/1D6 (permanent injury)", { args: { actorUuid, preset: "permInjury" }, owner: actorUuid, once: "permsan" }));
  }
  await postCard({ actor, title: "Permanent injury", body: `<p><b>${esc(actor.name)}</b> fails CON×5 (${outcome.total}): the wound is permanent.</p><div class="dgops-buttons">${btns.join("")}</div>`, kind: "alert" });
  return { permanent: true, total: outcome.total };
});

registerAction("permanentInjury", async ({ args }) => {
  if (!game.user.isGM) {
    ui.notifications.info("The Handler chooses the permanent injury.");
    return false;
  }
  const actor = await fromUuid(args.actorUuid);
  const statOpts = Object.fromEntries(STAT_KEYS.map((k) => [k, `${k.toUpperCase()} (${actor.system.statistics[k].value})`]));
  const effects = setting("optionalInjuries") ? PERMANENT_INJURY_EFFECTS : { stat: PERMANENT_INJURY_EFFECTS.stat };
  const r = await prompt({
    title: `Permanent injury — ${actor.name}`,
    content: `${field("Kind", `<select name="kind">${options(effects)}</select>`)}
      ${field("Stat reduced", `<select name="stat">${options(statOpts, "dex")}</select>`, "Reduced by the lowest d10 of the failed CON roll, minimum 3. HP adjusts if STR or CON drop.")}`,
  });
  if (!r) return false;
  if (r.data.kind === "stat") {
    const cur = actor.system.statistics[r.data.stat].value;
    const { by, newValue } = permanentInjuryReduction({ conRollTotal: args.total, statValue: cur });
    await update(actor, { [`system.statistics.${r.data.stat}.value`]: newValue });
    if (["str", "con"].includes(r.data.stat)) {
      const max = Math.ceil((statValue(actor, "str") + statValue(actor, "con")) / 2) + (actor.system.health.maxBonus ?? 0);
      if (actor.system.health.value > max) await update(actor, { "system.health.value": max });
    }
    await logInjury(actor, `${r.data.stat.toUpperCase()} −${cur - newValue}`);
    await postCard({ actor, title: "Permanent injury", body: `<p>${esc(actor.name)}: ${r.data.stat.toUpperCase()} ${cur} → ${newValue} (lowest die ${by}).</p>`, kind: "damage" });
    return `${r.data.stat.toUpperCase()} −${cur - newValue}`;
  }
  const label = PERMANENT_INJURY_EFFECTS[r.data.kind];
  await createEffect(actor, {
    name: label.split(":")[0],
    img: "icons/svg/blood.svg",
    disabled: true,
    description: `<p>${esc(label)}. Enable this effect when a test depends on it.</p>`,
    changes: [{ key: "system.rollTarget.allSkills", type: "add", value: "-20", phase: "final" }, { key: "system.rollTarget.statistics", type: "add", value: "-20", phase: "final" }],
    flags: { permanentInjury: r.data.kind },
  });
  await logInjury(actor, label);
  await postCard({ actor, title: "Permanent injury", body: `<p>${esc(actor.name)}: ${esc(label)}. A toggleable −20% effect was added for the tests it affects.</p>`, kind: "damage" });
  return label;
});

async function logInjury(actor, text) {
  const injuries = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "injuries") ?? []);
  injuries.push({ text, t: game.time.worldTime });
  const wounds = actor.system.physical?.wounds ?? "";
  const data = { [`flags.${MODULE_ID}.injuries`]: injuries };
  if (isAgent(actor)) data["system.physical.wounds"] = wounds ? `${wounds}; ${text}` : text;
  await update(actor, data);
}

registerAction("diseaseResurgence", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const diseases = actor.getFlag(MODULE_ID, "persistentDiseases") ?? [];
  const { outcome } = await systemTest(actor, { type: "stat", key: "con", context: { resurgence: true } });
  if (!outcome.success) {
    const { startDisease } = await import("./hazards.mjs");
    for (const d of diseases) await startDisease(actor, d.key ?? "hiv", { resurgence: true, def: d.def ?? DISEASES[d.key] });
  }
  return outcome.success ? "Held off" : "Resurgence";
});

registerAction("stunRecover", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const { outcome } = await systemTest(actor, { type: "stat", key: "con", context: { stunRecover: true } });
  if (outcome.success) await setStatus(actor, STATUS.stun, false);
  await postCard({ actor, title: "Stun", body: `<p>${esc(actor.name)} ${outcome.success ? "shakes it off and acts normally next turn" : "is still stunned"}.</p>` });
  return outcome.success ? "Recovered" : "Still stunned";
});
