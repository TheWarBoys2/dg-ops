/**
 * Sanity automation (pp.66–75): SAN tests and losses, projection onto Bonds, temporary insanity,
 * Breaking Point and disorders, adaptation, acute episodes, repression, permanent insanity,
 * destroying the Unnatural, and the p.37 Delta Green Bond queue.
 */
import { MODULE_ID, STATUS } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, statValue, skillValue, evalFormula, isAgent } from "../core/system.mjs";
import { update, setStatus, hasStatus, createEmbedded, setWorld, createEffect, effectsWithFlag, deleteEmbedded } from "../core/ops.mjs";
import { postCard, button, registerAction, outcomeBadge, sanWhisper, gmWhisper, list } from "../core/chat.mjs";
import { askOwner, prompt, esc, options, field } from "../core/ui.mjs";
import { bonds, chooseBond, adjustBond, adjustBondByFormula, createBond, maxBond } from "../core/bonds.mjs";
import { gm, registerHandler } from "../core/socket.mjs";
import { registerContinuation, rollsHere } from "../core/requests.mjs";
import { computeSanLoss, resolveProjection, evaluateSanThresholds, stepAdaptation, sanCap, destroyedRestoreFormula, resolveRepression, SAN_PRESETS } from "../rules/sanity.mjs";
import { DISORDERS, disordersForCause, PERMANENT_INSANITY } from "../rules/disorders.mjs";
import { disorderIdFor } from "./readiness.mjs";
import { snapshot } from "../core/snapshot.mjs";
import { teamOnScene } from "../core/team.mjs";
import { runSanPreChecks, runSanResults, sanDialogHtml, sanDialogParams, sanLossSecret } from "../core/extensions.mjs";

/** Players don't get to see what's at stake: no loss formula on cards, loss dice for the Handler only. */
export const lossHidden = (actor, params = {}) => !!(setting("hideSanLoss") || sanLossSecret({ actor, params }));

const CAT_TIP = {
  violence: "Violence: three losses in a row without insanity adapts the Agent, at a cost to CHA and Bonds (p.73).",
  helplessness: "Helplessness: three losses in a row without insanity adapts the Agent, at a cost to POW (p.73).",
  unnatural: "There's no adapting to the Unnatural (p.74).",
};

const CAT_LABEL = { violence: "Violence", helplessness: "Helplessness", unnatural: "Unnatural", other: "Other" };

export function isAdapted(actor, category) {
  const a = actor?.system?.sanity?.adaptations?.[category];
  return !!(a && a.incident1 && a.incident2 && a.incident3);
}

export function disordersOf(actor, { activeOnly = false } = {}) {
  return (actor?.itemTypes?.motivation ?? []).filter((m) => m.system.disorder && !m.system.crossedOut && (!activeOnly || !m.system.disorderCured));
}

function disorderDef(item) {
  const id = disorderIdFor(item);
  const trigger = item.getFlag(MODULE_ID, "trigger");
  const wp = item.getFlag(MODULE_ID, "wpPerTest");
  if (id && DISORDERS[id]) return { id, ...DISORDERS[id], trigger: trigger ?? DISORDERS[id].trigger, wpPerTest: wp ? "1D4" : DISORDERS[id].wpPerTest };
  if (id === "custom") return { id, name: item.name, trigger: trigger ?? "manual", changes: [], wpPerTest: wp ? "1D4" : null };
  return null;
}

/* ------------------------------------------------------------------------ */
/*  The SAN pipeline                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Run a full SAN test and loss.
 * @param {object} p
 * @param {Actor} p.actor
 * @param {string} [p.successLoss="0"]
 * @param {string} [p.failureLoss="1D4"]
 * @param {"violence"|"helplessness"|"unnatural"|"other"} [p.category="other"]
 * @param {number} [p.victims=1]
 * @param {boolean} [p.perVictim=false]
 * @param {string} [p.source]
 * @param {object} [p.outcome]       An already-rolled SAN test outcome to use.
 * @param {number|null} [p.fixedLoss] Skip the test and lose exactly this much (e.g. braving suppression).
 * @param {number} [p.modifier]
 * @param {string[]} [p.tags]       Labels for extensions (e.g. "il:yellowSign"); passed to their hooks.
 * @param {boolean} [p.maxOnFail]   A failed roll takes the greatest possible loss.
 */
export async function sanTest({
  actor,
  successLoss = "0",
  failureLoss = "1D4",
  category = "other",
  victims = 1,
  perVictim = false,
  source = "",
  outcome = null,
  fixedLoss = null,
  modifier = 0,
  messageMode = undefined,
  manual = false,
  tags = [],
  maxOnFail = false,
}) {
  if (!actor || !["agent", "npc"].includes(actor.type)) {
    ui.notifications.warn("Delta Green Ops: SAN tests need an Agent or NPC.");
    return null;
  }
  const params = { successLoss, failureLoss, category, victims, perVictim, source, fixedLoss, modifier, manual, tags, maxOnFail };
  const pre = fixedLoss == null ? await runSanPreChecks({ actor, params }) : { skip: null, maxOnFail: false, defer: null, notes: [] };
  if (pre.skip) {
    await postCard({ actor, title: `No SAN test${source ? `: ${esc(source)}` : ""}`, body: `<p>${esc(pre.skip)}</p>`, whisper: gmWhisper(), kind: "san" });
    const sanNow = Number(actor.system.sanity?.value) || 0;
    const skipped = { outcome: null, rawLoss: 0, loss: 0, sanAfter: sanNow, tempInsanity: false, breakingPointHit: false, permanentInsanity: false, skipped: true };
    await runSanResults({ actor, params, result: skipped });
    return skipped;
  }
  maxOnFail = maxOnFail || pre.maxOnFail;
  const notes = [...pre.notes];
  const rolls = [];
  const gmRolls = []; // loss dice the players mustn't see
  let rawLoss;
  let o = outcome;
  const snap = snapshot(actor);

  if (fixedLoss != null) {
    rawLoss = Math.max(0, Number(fixedLoss) || 0);
  } else {
    if (!o && (category === "violence" || category === "helplessness") && isAdapted(actor, category)) {
      o = { success: true, critical: false, fumble: false, total: null, auto: true };
      notes.push(`Adapted to ${category}: the SAN roll succeeds automatically.`);
    }
    if (!o) {
      const t = await systemTest(actor, { type: "sanity", key: "sanity", modifier, messageMode, context: { sanTest: true, source } });
      o = t.outcome;
    }
    // Only the loss that applies is rolled (criticals and fumbles need no roll at all).
    const hidden = lossHidden(actor, params);
    const whisper = hidden ? gmWhisper() : sanWhisper(actor);
    const lossOpts = hidden ? { whisper, blind: true } : { whisper };
    let rolledSuccess = 0;
    let rolledFailure = 0;
    if (o.success && !o.critical) {
      const r = await evalFormula(successLoss || "0", {}, lossOpts);
      rolledSuccess = r.total;
      if (r.dice.length) (hidden ? gmRolls : rolls).push(r);
    }
    if (!o.success && !o.fumble) {
      const r = await evalFormula(failureLoss || "0", {}, lossOpts);
      rolledFailure = r.total;
      if (r.dice.length) (hidden ? gmRolls : rolls).push(r);
    }
    rawLoss = computeSanLoss({ outcome: o, successFormula: successLoss, failureFormula: failureLoss, rolledSuccess, rolledFailure, victims, perVictim, maxOnFail });
    if (o.critical && o.success) notes.push("Critical success: least possible loss.");
    if (o.fumble) notes.push("Fumble: greatest possible loss.");
    else if (maxOnFail && !o.success) notes.push("Every failed SAN roll takes the greatest possible loss.");
    if (perVictim && victims > 1 && !o.success) notes.push(`+1 per victim beyond the first (${victims} victims), capped at the die's maximum.`);
  }

  const sys = actor.system;
  const sanBefore = Number(sys.sanity.value) || 0;
  const pow = statValue(actor, "pow");
  let loss = rawLoss;

  // A campaign rule holds the loss back (nothing changes on the sheet); its hook keeps the number.
  if (pre.defer) {
    const held = { outcome: o, rawLoss, loss: 0, sanAfter: sanBefore, tempInsanity: false, breakingPointHit: false, permanentInsanity: false, deferred: true };
    await postCard({
      actor,
      title: `SAN loss held${source ? `: ${esc(source)}` : ""}`,
      subtitle: CAT_LABEL[category] ?? "",
      body: list([o && !o.auto ? `SAN test: ${outcomeBadge(o)} (${o.total})` : "", `Loss: <b>${rawLoss}</b>, not applied yet.`, esc(pre.defer), ...notes.map(esc)]),
      rolls: [...rolls, ...gmRolls],
      whisper: gmWhisper(),
      kind: "san",
    });
    await runSanResults({ actor, params, result: held });
    return held;
  }

  // Projection onto a Bond
  if (loss > 0 && isAgent(actor) && setting("projectionPrompt") && bonds(actor).length && (sys.wp?.value ?? 0) > 0) {
    const proj = await offerProjection(actor, loss, sanBefore);
    if (proj) {
      rolls.push(proj.roll);
      notes.push(proj.note);
      loss = Math.max(0, loss - proj.sanReduction);
    }
  }

  const bp = Number(sys.sanity.currentBreakingPoint ?? 0);
  const t = evaluateSanThresholds({ sanBefore, loss, rawLoss, breakingPoint: bp, pow, insanityCheck: setting("insanityBasis") });
  const updateData = { "system.sanity.value": t.sanAfter };
  if (t.breakingPointHit) updateData["system.sanity.currentBreakingPoint"] = t.newBreakingPoint;

  // Incident log
  if (loss > 0) {
    const logEntries = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "sanLog") ?? []);
    logEntries.push({ t: game.time.worldTime, d: Date.now(), source, category, loss });
    updateData[`flags.${MODULE_ID}.sanLog`] = logEntries.slice(-60);
  }

  // Adaptation
  let adaptResult = null;
  if (isAgent(actor) && (category === "violence" || category === "helplessness")) {
    adaptResult = stepAdaptation(sys.sanity.adaptations[category], {
      lossApplied: loss,
      tempInsanity: t.tempInsanity,
      breakingPointHit: t.breakingPointHit,
      resetOnBreakingPoint: setting("adaptResetOnBP"),
    });
    for (const k of ["incident1", "incident2", "incident3"]) updateData[`system.sanity.adaptations.${category}.${k}`] = adaptResult.state[k];
    if (adaptResult.reset) notes.push(`${CAT_LABEL[category]} adaptation progress resets.`);
    else if (adaptResult.marked && !adaptResult.becameAdapted) notes.push(`${CAT_LABEL[category]} adaptation: ${Object.values(adaptResult.state).filter(Boolean).length}/3.`);
  }

  if (t.breakingPointHit || t.tempInsanity) updateData[`flags.${MODULE_ID}.sleepTest`] = true;
  if (t.breakingPointHit) {
    const pend = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "pendingDisorders") ?? []);
    pend.push({ category, t: game.time.worldTime, source });
    updateData[`flags.${MODULE_ID}.pendingDisorders`] = pend;
  }

  await update(actor, updateData, { dgOpsSan: true });

  // Post-update consequences
  const extra = [];
  if (adaptResult?.becameAdapted) extra.push(await becomeAdapted(actor, category));
  if (t.tempInsanity) await setStatus(actor, STATUS.tempInsane, true);
  const triggered = await triggerAcuteEpisodes(actor, { loss, tempInsanity: t.tempInsanity, breakingPointHit: t.breakingPointHit });

  if (t.tempInsanity || t.breakingPointHit || t.permanentInsanity) {
    const what = t.permanentInsanity ? "went permanently insane" : t.tempInsanity ? "suffered temporary insanity" : "reached the Breaking Point";
    await queueCatastrophe(actor, what);
  }

  // Card
  const priv = sanWhisper(actor);
  const lines = [];
  if (o && !o.auto) lines.push(`SAN test: ${outcomeBadge(o)} (${o.total})`);
  lines.push(`Loss: <b>${loss}</b>${loss !== rawLoss ? ` (from ${rawLoss})` : ""} — SAN ${sanBefore} → <b>${t.sanAfter}</b>`);
  for (const n of notes) lines.push(esc(n));
  for (const e of extra) if (e) lines.push(e);
  const btns = [];
  if (t.tempInsanity) {
    lines.push(`<b class="dgops-alert">Temporary insanity!</b> 5+ SAN lost in one roll. Choose a reaction — or try to repress it.`);
    btns.push(
      button("insanityReaction", "Flee", { args: { actorUuid: actor.uuid, r: "flee" }, owner: actor.uuid, once: "react" }),
      button("insanityReaction", "Struggle", { args: { actorUuid: actor.uuid, r: "struggle" }, owner: actor.uuid, once: "react" }),
      button("insanityReaction", "Submit", { args: { actorUuid: actor.uuid, r: "submit" }, owner: actor.uuid, once: "react" }),
      button("repress", "Repress (1D4 WP + Bond)", { args: { actorUuid: actor.uuid, kind: "temp" }, owner: actor.uuid, once: "repress" }),
      button("talkDown", "Talk down (Psychotherapy)", { args: { actorUuid: actor.uuid, kind: "temp", category }, once: "talkdown" }),
    );
    if (setting("insight") && category === "unnatural") btns.push(button("insight", "Insight: +1D6% Unnatural", { args: { actorUuid: actor.uuid }, once: "insight" }));
  }
  if (t.breakingPointHit) {
    lines.push(`<b class="dgops-alert">Breaking Point reached.</b> A new disorder will develop (assign it now or at the Home scene). Breaking Point resets to ${t.newBreakingPoint}.`);
    btns.push(button("assignDisorder", "Assign disorder", { args: { actorUuid: actor.uuid, category }, once: "assign" }));
    btns.push(button("crossMotivation", "Cross out a motivation", { args: { actorUuid: actor.uuid }, owner: actor.uuid, once: "cross" }));
  }
  if (t.permanentInsanity) {
    lines.push(`<b class="dgops-alert">0 SAN — permanent insanity.</b> The Agent is lost to the Handler.`);
    btns.push(button("permanentInsanity", "Handler takes control", { args: { actorUuid: actor.uuid }, once: "perm" }));
  }
  for (const d of triggered) {
    lines.push(`Acute episode: <b>${esc(d.name)}</b>`);
    btns.push(button("repress", `Repress ${d.name}`, { args: { actorUuid: actor.uuid, kind: "acute", itemId: d.id }, owner: actor.uuid, once: `rep-${d.id}` }));
  }

  await postCard({
    actor,
    title: `SAN loss${source ? `: ${esc(source)}` : ""}`,
    subtitle: CAT_LABEL[category] ?? "",
    body: list(lines) + (btns.length ? `<div class="dgops-buttons">${btns.join("")}</div>` : ""),
    rolls,
    whisper: priv,
    kind: "san",
    tip: CAT_TIP[category] ?? "",
    undo: loss > 0 || rawLoss > 0 ? { actorUuid: actor.uuid, snap } : null,
  });

  const result = { outcome: o, rawLoss, loss, ...t, adapted: adaptResult?.becameAdapted ?? false };
  await runSanResults({ actor, params, result });
  return result;
}

async function offerProjection(actor, loss, sanBefore) {
  const priv = (() => {
    try {
      return game.settings.get("deltagreen", "keepSanityPrivate");
    } catch {
      return false;
    }
  })();
  const bp = actor.system.sanity.currentBreakingPoint;
  const after = sanBefore - loss;
  const warnings = [];
  if (loss >= 5) warnings.push(`<b>Temporary insanity</b> — unless projecting brings the loss under 5${loss - 4 > 4 ? " (it can't this time)" : ""}.`);
  if (!priv && after <= bp) warnings.push(`<b>Breaking Point</b> (${bp}) — a new disorder${sanBefore - Math.max(0, loss - 4) > bp ? ", unless you project enough" : ""}.`);
  const scale = Math.max(sanBefore, 1);
  const bar = priv
    ? ""
    : `<div class="dgops-projbar"><span class="keep" style="width:${(Math.max(0, after) / scale) * 100}%"></span><span class="save" style="width:${(Math.min(4, loss) / scale) * 100}%" data-tooltip="Projection can save up to 4"></span><span class="lose" style="width:${(Math.max(0, loss - 4) / scale) * 100}%"></span><b class="bp" style="left:${(bp / scale) * 100}%" data-tooltip="Breaking Point ${bp}"></b></div>
       <p class="dgops-proj-nums">SAN ${sanBefore} → <b>${after}</b>, or as high as ${Math.min(sanBefore, after + 4)} if you project.</p>`;
  const opts = bonds(actor)
    .map((b, i) => `<label class="dgops-radio"><input type="radio" name="bond" value="${b.id}" ${i === 0 ? "checked" : ""}> ${esc(b.name)} <em>(${b.system.score})</em></label>`)
    .join("");
  const r = await askOwner(actor, {
    title: `${actor.name} is about to lose ${loss} SAN`,
    content: `${bar}${warnings.length ? `<ul class="dgops-warn-list">${warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
      <p>Project onto a Bond: spend 1D4 WP (you have ${actor.system.wp.value}) to cut the loss by the amount rolled. The Bond takes the same damage, and you'll describe how the relationship suffers (p.74).</p>
      <h4>Which Bond?</h4>${opts}`,
    buttons: [
      { action: "project", label: "Project onto the Bond", default: true },
      { action: "no", label: `Take all ${loss}` },
    ],
  });
  if (r?.action !== "project") return null;
  const bond = actor.items.get(r.data.bond) ?? bonds(actor)[0];
  const roll = await evalFormula("1d4", {}, { whisper: sanWhisper(actor) });
  const res = resolveProjection({ wpCurrent: actor.system.wp.value, wpRoll: roll.total, loss });
  await update(actor, { "system.wp.value": res.wpAfter });
  if (res.applies) {
    await adjustBond(actor, bond, -res.bondLoss, { reason: "projection" });
    return { ...res, roll, note: `Projected onto ${bond.name}: spent ${roll.total} WP, SAN loss −${res.sanReduction}, Bond −${res.bondLoss}.` };
  }
  return { ...res, roll, note: `Tried to project but spent the last of their WP (${roll.total}): no reduction.` };
}

async function becomeAdapted(actor, category) {
  const roll = await evalFormula("1d6");
  if (category === "violence") {
    const cha = actor.system.statistics.cha.value;
    // The system shifts every Bond by the same CHA change automatically.
    await update(actor, { "system.statistics.cha.value": Math.max(0, cha - roll.total) });
    await postCard({ actor, title: "Adapted to violence", body: `<p>${esc(actor.name)} is now adapted to violence: SAN rolls against violence always succeed. Empathy suffers: CHA and every Bond −${roll.total}.</p>`, rolls: [roll] });
    return `<b>Adapted to violence</b>: CHA and every Bond −${roll.total}.`;
  }
  const pow = actor.system.statistics.pow.value;
  const newPow = Math.max(0, pow - roll.total);
  const data = { "system.statistics.pow.value": newPow };
  if (actor.system.wp.value > newPow) data["system.wp.value"] = newPow;
  await update(actor, data);
  await postCard({ actor, title: "Adapted to helplessness", body: `<p>${esc(actor.name)} is now adapted to helplessness: SAN rolls against helplessness always succeed. Personal drive suffers: POW −${roll.total}.</p>`, rolls: [roll] });
  return `<b>Adapted to helplessness</b>: POW −${roll.total}.`;
}

async function triggerAcuteEpisodes(actor, { loss, tempInsanity, breakingPointHit }) {
  if (!setting("autoAcute") || !isAgent(actor)) return [];
  const hits = [];
  for (const item of disordersOf(actor, { activeOnly: true })) {
    if (item.system.acuteEpisode) continue;
    const def = disorderDef(item);
    if (!def) continue;
    if ((def.trigger === "san2" && loss >= 2) || (def.trigger === "insanityOrBP" && (tempInsanity || breakingPointHit))) hits.push(item);
  }
  for (const item of hits) await update(item, { "system.acuteEpisode": true });
  return hits;
}

/* ------------------------------------------------------------------------ */
/*  Delta Green Bond queue (p.37)                                            */
/* ------------------------------------------------------------------------ */

export function teamPresent(exclude = null) {
  return teamOnScene().filter((a) => a.id !== exclude?.id);
}

export async function queueCatastrophe(actor, what) {
  if (!setting("dgBonds") || !isAgent(actor)) return;
  const q = foundry.utils.deepClone(game.settings.get(MODULE_ID, "queue") ?? { catastrophes: [] });
  q.catastrophes ??= [];
  const present = teamPresent().map((a) => a.uuid);
  q.catastrophes.push({ id: foundry.utils.randomID(), t: game.time.worldTime, actorUuid: actor.uuid, name: actor.name, what, present });
  await setWorld("queue", q);
}

export async function resolveCatastrophe(id) {
  const q = foundry.utils.deepClone(game.settings.get(MODULE_ID, "queue") ?? { catastrophes: [] });
  const c = q.catastrophes.find((x) => x.id === id);
  if (!c) return;
  const present = (await Promise.all(c.present.map((u) => fromUuid(u)))).filter((a) => a && a.type === "agent" && (a.system.health.value > 0));
  const results = [];
  for (const agent of present) {
    const others = present.filter((p) => p.id !== agent.id);
    if (!others.length) continue;
    const { outcome } = await systemTest(agent, { type: "sanity", key: "sanity", context: { dgBondTest: true } });
    if (outcome.success) {
      results.push(`${esc(agent.name)}: holds it together alone.`);
      continue;
    }
    const parts = [];
    for (const mate of others.slice(0, 5)) {
      const existing = agent.itemTypes.bond.find((b) => b.getFlag(MODULE_ID, "dgActor") === mate.uuid || b.name === mate.name);
      if (existing) {
        const r = await adjustBondByFormula(agent, existing, "1d4");
        parts.push(`${esc(mate.name)} +${r.amount}`);
        const other = await chooseBond(agent, { nonDG: true, title: "Lose 1 from which Bond?", reason: `Deepening the Bond with ${mate.name} costs 1 point from another Bond.` });
        if (other) await adjustBond(agent, other, -1, { reason: "Delta Green Bond" });
      } else {
        const b = await createBond(agent, { name: mate.name, score: Math.ceil(maxBond(agent) / 2), dg: true });
        if (b) await update(b, { [`flags.${MODULE_ID}.dgActor`]: mate.uuid });
        parts.push(`new Bond with ${esc(mate.name)}`);
        const other = await chooseBond(agent, { nonDG: true, title: "Lose 1D4 from which Bond?", reason: `A new Delta Green Bond with ${mate.name} costs 1D4 from another Bond.` });
        if (other) await adjustBondByFormula(agent, other, "-1d4", { reason: "Delta Green Bond" });
      }
    }
    results.push(`${esc(agent.name)}: ${parts.join(", ")}`);
  }
  q.catastrophes = q.catastrophes.filter((x) => x.id !== id);
  await setWorld("queue", q);
  await postCard({ title: "Delta Green Bonds", subtitle: esc(`${c.name} ${c.what}`), body: list(results.length ? results : ["No one else was present."]) });
}

/* ------------------------------------------------------------------------ */
/*  Disorders                                                                */
/* ------------------------------------------------------------------------ */

export async function assignDisorder(actor, { category = "other" } = {}) {
  const pend = actor.getFlag(MODULE_ID, "pendingDisorders") ?? [];
  const cause = category !== "other" ? category : pend[0]?.category ?? "other";
  const defs = disordersForCause(null);
  const suggested = new Set(disordersForCause(cause).map((d) => d.id));
  const opts = defs
    .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)))
    .map((d) => `<option value="${d.id}">${esc(d.name)}${suggested.has(d.id) ? " ★" : ""}</option>`)
    .join("");
  const r = await prompt({
    title: `Assign a disorder — ${actor.name}`,
    content: `<p>Cause: <b>${CAT_LABEL[cause] ?? cause}</b>. ★ = typical for this cause (pp.70–72). Negotiate the shape with the player.</p>
      ${field("Disorder", `<select name="id">${opts}<option value="custom">Custom…</option></select>`)}
      ${field("Custom name", `<input type="text" name="custom" placeholder="Only for Custom">`)}
      ${field("Details", `<input type="text" name="detail" placeholder="e.g. alcohol; fear of fire; blindness">`)}`,
    buttons: [{ action: "ok", label: "Assign", default: true }],
    width: 480,
  });
  if (!r) return null;
  const def = r.data.id === "custom" ? null : { id: r.data.id, ...DISORDERS[r.data.id] };
  const baseName = def ? def.name : r.data.custom || "Disorder";
  const name = r.data.detail ? `${baseName} (${r.data.detail})` : baseName;

  // Relapse of cured disorders (p.79)
  const cured = disordersOf(actor).filter((m) => m.system.disorderCured);
  let relapseNote = "";
  if (cured.length) {
    const { outcome } = await systemTest(actor, { type: "sanity", key: "sanity", context: { relapse: true } });
    if (!outcome.success) {
      for (const c of cured) await update(c, { "system.disorderCured": false });
      relapseNote = `<p><b>Relapse:</b> ${cured.map((c) => esc(c.name)).join(", ")} return in full force.</p>`;
    } else relapseNote = `<p>Cured disorders stay in remission.</p>`;
  }

  const itemData = {
    type: "motivation",
    name,
    system: { disorder: name, description: `<p>${esc(def?.summary ?? "")}</p>`, acuteEpisode: false },
    flags: { [MODULE_ID]: { disorder: def?.id ?? "custom", trigger: def?.trigger ?? "manual" } },
  };
  if (def?.changes?.length) {
    itemData.effects = [{ name: `${def.name}: acute episode`, img: "icons/svg/daze.svg", transfer: true, changes: def.changes, flags: { [MODULE_ID]: { disorderEffect: true } } }];
  }
  await createEmbedded(actor, "Item", [itemData]);
  const rest = pend.slice(1);
  await update(actor, { [`flags.${MODULE_ID}.pendingDisorders`]: rest });
  await postCard({ actor, title: `New disorder: ${esc(name)}`, body: `<p>${esc(def?.summary ?? "")}</p>${relapseNote}` });
  return name;
}

registerAction("assignDisorder", async ({ args }) => {
  if (!game.user.isGM) {
    ui.notifications.info("The Handler assigns disorders.");
    return false;
  }
  const actor = await fromUuid(args.actorUuid);
  const r = await assignDisorder(actor, { category: args.category });
  return r ? `Assigned ${r}` : false;
});

registerAction("crossMotivation", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const motivations = actor.itemTypes.motivation.filter((m) => !m.system.disorder && !m.system.crossedOut);
  if (!motivations.length) {
    ui.notifications.info("No motivations left to cross out.");
    return "None left";
  }
  const r = await prompt({
    title: "Cross out a motivation",
    content: `<p>Each time an Agent hits the Breaking Point, one motivation goes as a symptom of the trauma (p.38).</p>${motivations
      .map((m, i) => `<label class="dgops-radio"><input type="radio" name="m" value="${m.id}" ${i === 0 ? "checked" : ""}> ${esc(m.name)}</label>`)
      .join("")}`,
  });
  if (!r) return false;
  const m = actor.items.get(r.data.m);
  await update(m, { "system.crossedOut": true });
  return `Crossed out ${m.name}`;
});

registerAction("permanentInsanity", async ({ args }) => {
  if (!game.user.isGM) return false;
  const actor = await fromUuid(args.actorUuid);
  const r = await prompt({
    title: `Permanent insanity — ${actor.name}`,
    content: `${field("Form", `<select name="form">${options(PERMANENT_INSANITY)}</select>`)}
      <label class="dgops-radio"><input type="checkbox" name="take" checked> Remove player ownership now (the Agent becomes an NPC)</label>
      <p class="hint">Or keep the player at the wheel for a hidden-psychopath arc (p.73).</p>`,
  });
  if (!r) return false;
  if (r.data.take) {
    const ownership = { default: 0 };
    for (const u of game.users) if (u.isGM) ownership[u.id] = 3;
    await actor.update({ ownership });
  }
  await postCard({ actor, title: "Lost", body: `<p>${esc(actor.name)}: ${esc(PERMANENT_INSANITY[r.data.form])}</p>`, whisper: gmWhisper() });
  return "Resolved";
});

registerAction("insanityReaction", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const con = statValue(actor, "con");
  const txt = {
    flee: `Flee: move away from the source at top speed for up to ${con} turns (CON), then collapse exhausted — or stop once safe.`,
    struggle: "Struggle: lash out at the nearest threat until killed, unconscious or restrained.",
    submit: "Submit: catatonic and paralyzed until the Handler says otherwise. Remembering details later needs an INT×5 test.",
  }[args.r];
  await postCard({ actor, title: "Temporary insanity", body: `<p><b>${esc(actor.name)}</b> — ${esc(txt)}</p>` });
  if (args.r === "flee") await update(actor, { [`flags.${MODULE_ID}.fleeTurns`]: con });
  return args.r;
});

registerAction("insight", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const roll = await evalFormula("1d6");
  const un = actor.system.skills.unnatural.proficiency + roll.total;
  const data = { "system.skills.unnatural.proficiency": Math.min(99, un) };
  const cap = sanCap({ unnatural: un, maxBonus: actor.system.sanity.maxBonus ?? 0 });
  if (actor.system.sanity.value > cap) data["system.sanity.value"] = cap;
  await update(actor, data, { dgOpsSan: true });
  await postCard({ actor, title: "Insight", body: `<p>${esc(actor.name)} gains ${roll.total}% Unnatural (now ${Math.min(99, un)}%). Max SAN is now ${cap}.</p>`, rolls: [roll] });
  return `+${roll.total}%`;
});

/** Repress temporary insanity or an acute episode (p.75). */
export async function repress(actor, { kind = "temp", itemId = null } = {}) {
  const wp = actor.system.wp.value;
  const content = `<p>Spend 1D4 WP. If ${esc(actor.name)} still has at least 1 WP, a Bond takes the same damage and you roll SAN. Success: behave normally (p.75). WP: ${wp}.</p>
    ${bonds(actor).map((b, i) => `<label class="dgops-radio"><input type="radio" name="bond" value="${b.id}" ${i === 0 ? "checked" : ""}> ${esc(b.name)} <em>(${b.system.score})</em></label>`).join("")}
    ${kind === "acute" ? field("Self-medicating?", `<select name="drug"><option value="none">No</option><option value="benzo">Benzodiazepine (+20% now, −20% to tests)</option><option value="drink">Heavy drinking / marijuana (+10% now, −20% to tests)</option></select>`) : ""}`;
  const r = await askOwner(actor, { title: "Repress", content, buttons: [{ action: "ok", label: "Repress", default: true }, { action: "no", label: "Cancel" }] });
  if (r?.action !== "ok") return false;
  if (!bonds(actor).length) {
    ui.notifications.warn("No Bonds left to draw strength from.");
    return false;
  }
  const bond = actor.items.get(r.data.bond) ?? bonds(actor)[0];
  const roll = await evalFormula("1d4");
  const res = resolveRepression({ wpCurrent: wp, wpRoll: roll.total });
  await update(actor, { "system.wp.value": res.wpAfter });
  if (!res.canAttempt) {
    await postCard({ actor, title: "Repression fails", body: `<p>${esc(actor.name)} spends ${roll.total} WP and has nothing left.</p>`, rolls: [roll] });
    return "No WP left";
  }
  await adjustBond(actor, bond, -res.bondLoss, { reason: "repression" });
  let mod = 0;
  if (r.data.drug === "benzo") mod = 20;
  if (r.data.drug === "drink") mod = 10;
  if (mod) await applyIntoxication(actor, r.data.drug === "benzo" ? "Sedated (benzodiazepine)" : "Intoxicated");
  const { outcome } = await systemTest(actor, { type: "sanity", key: "sanity", modifier: mod, context: { repress: true } });
  if (outcome.success) {
    if (kind === "temp") await setStatus(actor, STATUS.tempInsane, false);
    if (kind === "acute" && itemId) await update(actor.items.get(itemId), { "system.acuteEpisode": false });
  }
  await postCard({
    actor,
    title: outcome.success ? "Repressed" : "Repression fails",
    body: `<p>${esc(actor.name)} draws on ${esc(bond.name)} (−${res.bondLoss}, WP −${roll.total}). ${outcome.success ? "They keep it together — for now." : "It takes hold anyway."} Describe later how the Bond strains under the weight.</p>`,
    rolls: [roll],
  });
  return outcome.success ? "Repressed" : "Failed";
}

registerAction("repress", async ({ args }) => repress(await fromUuid(args.actorUuid), args));

async function applyIntoxication(actor, name) {
  const pen = ["system.rollTarget.allSkills", "system.rollTarget.statistics"].map((key) => ({ key, type: "add", value: "-20", phase: "final" }));
  await createEffect(actor, { name, img: "icons/svg/tankard.svg", changes: pen, flags: { intox: true } });
  const { schedule } = await import("../core/scheduler.mjs");
  await schedule({ type: "removeEffectFlag", delay: 3 * 3600, actorUuid: actor.uuid, data: { flag: "intox" }, label: `${name} wears off` });
}

/** Talk someone down with Psychotherapy (pp.69–70). */
registerAction("talkDown", async ({ args }) => {
  const patient = await fromUuid(args.actorUuid);
  const mine = game.actors.filter((a) => a.type === "agent" && a.isOwner && a.id !== patient.id);
  const tokenActors = canvas.tokens?.controlled?.map((t) => t.actor).filter((a) => a && a.id !== patient.id) ?? [];
  const pool = [...new Map([...tokenActors, ...mine].map((a) => [a.id, a])).values()];
  if (!pool.length) {
    ui.notifications.warn("Select or own another Agent to attempt Psychotherapy.");
    return false;
  }
  const r = await prompt({
    title: `Talk down ${patient.name}`,
    content: `<p>Only possible if circumstances are calm. Takes a few minutes.</p>${field("Therapist", `<select name="a">${pool.map((a) => `<option value="${a.id}">${esc(a.name)} (${skillValue(a, "psychotherapy")}%)</option>`).join("")}</select>`)}`,
  });
  if (!r) return false;
  const therapist = game.actors.get(r.data.a) ?? pool[0];
  const { outcome } = await systemTest(therapist, { type: "skill", key: "psychotherapy", context: { talkDown: patient.uuid } });
  if (outcome.success) {
    if (args.kind === "temp") await setStatus(patient, STATUS.tempInsane, false);
    if (args.itemId) await update(patient.items.get(args.itemId), { "system.acuteEpisode": false });
  }
  if (args.category === "unnatural") {
    await sanTest({ actor: therapist, successLoss: "0", failureLoss: "1", category: "unnatural", source: "Psychotherapy on someone touched by the Unnatural" });
  }
  return outcome.success ? `Talked down by ${therapist.name}` : `${therapist.name} failed`;
});

/* ------------------------------------------------------------------------ */
/*  Destroying the Unnatural (p.75)                                          */
/* ------------------------------------------------------------------------ */

export async function destroyedUnnatural(unnatural = null) {
  const unnaturals = game.actors.filter((a) => a.type === "unnatural");
  const agents = teamPresent();
  const r = await prompt({
    title: "The Unnatural is destroyed",
    content: `${field("Threat", `<select name="u">${(unnatural ? [unnatural] : unnaturals).map((u) => `<option value="${u.uuid}">${esc(u.name)} (${esc(u.system.sanity?.successLoss)}/${esc(u.system.sanity?.failedLoss)})</option>`).join("")}<option value="">Custom…</option></select>`)}
      ${field("Custom restore", `<input type="text" name="custom" placeholder="e.g. 1D6">`)}
      <p>Agents directly involved in putting it down:</p>
      ${agents.map((a) => `<label class="dgops-radio"><input type="checkbox" data-multi name="agents" value="${a.uuid}" checked> ${esc(a.name)}</label>`).join("")}`,
  });
  if (!r) return;
  const u = r.data.u ? await fromUuid(r.data.u) : null;
  const formula = u ? destroyedRestoreFormula(u.system.sanity?.successLoss) : r.data.custom || "0";
  const lines = [];
  const rolls = [];
  for (const uuid of r.data.agents ?? []) {
    const a = await fromUuid(uuid);
    if (!a) continue;
    const roll = await evalFormula(formula);
    rolls.push(roll);
    const cap = sanCap({ unnatural: a.system.skills.unnatural.proficiency, maxBonus: a.system.sanity.maxBonus ?? 0 });
    const after = Math.min(cap, a.system.sanity.value + roll.total);
    await update(a, { "system.sanity.value": after });
    lines.push(`${esc(a.name)} regains ${after - a.system.sanity.value} SAN.`);
  }
  await postCard({ title: `Destroyed: ${esc(u?.name ?? "the Unnatural")}`, body: `<p>Gaining any control over the Unnatural is a kind of victory. Restore: ${esc(formula)} each (capped at 99 − Unnatural).</p>${list(lines)}`, rolls, whisper: gmWhisper() });
}

/* ------------------------------------------------------------------------ */
/*  Quick SAN dialog                                                         */
/* ------------------------------------------------------------------------ */

export async function sanDialog(actors, defaults = {}) {
  const presetOpts = SAN_PRESETS.map((p) => `<option value="${p.id}">${esc(`[${CAT_LABEL[p.category]}] ${p.label} — ${p.success}/${p.failure}`)}</option>`).join("");
  const r = await prompt({
    title: "SAN test",
    width: 560,
    content: `<p>For: <b>${actors.map((a) => esc(a.name)).join(", ")}</b></p>
      <p class="hint">Posts a SAN card to chat. Each player clicks to roll their own; you see the numbers, everyone sees who held together.</p>
      ${field("Preset (pp.67–68)", `<select name="preset"><option value="">— custom —</option>${presetOpts}</select>`)}
      ${field("Loss", `<input type="text" name="s" value="${esc(defaults.successLoss ?? "0")}" style="width:5em"> / <input type="text" name="f" value="${esc(defaults.failureLoss ?? "1D4")}" style="width:5em">`)}
      ${field("Category", `<select name="cat">${options(CAT_LABEL, defaults.category ?? "unnatural")}</select>`)}
      ${field("Victims", `<input type="number" name="victims" value="1" min="1" style="width:5em"> <label><input type="checkbox" name="perVictim"> +1 per extra victim</label>`)}
      ${field("Source", `<input type="text" name="source" value="${esc(defaults.source ?? "")}">`)}
      ${field("Modifier", `<input type="number" name="mod" value="0" step="10" style="width:5em">`)}
      ${sanDialogHtml()}`,
    buttons: [{ action: "ok", label: "Post SAN test", default: true }],
  });
  if (!r) return;
  let { s, f, cat, perVictim, source } = r.data;
  if (r.data.preset) {
    const p = SAN_PRESETS.find((x) => x.id === r.data.preset);
    s = p.success;
    f = p.failure;
    cat = p.category;
    perVictim = !!p.perVictim;
    source ||= p.label;
  }
  return sanGroupCard(actors, { successLoss: s, failureLoss: f, category: cat, victims: r.data.victims ?? 1, perVictim, source, modifier: r.data.mod ?? 0, ...sanDialogParams(r.data) });
}

/** One card, a Roll button per Agent. Numbers go to the Handler; everyone sees pass or fail. */
export async function sanGroupCard(actors, params) {
  const list_ = actors.filter((a) => ["agent", "npc"].includes(a?.type));
  if (!list_.length) return null;
  const { createGroupCard } = await import("../core/requests.mjs");
  const stake = list_.some((a) => lossHidden(a, params)) ? "" : `${esc(params.successLoss || "0")}/${esc(params.failureLoss || "0")} · `;
  return createGroupCard({
    title: `SAN test${params.source ? `: ${esc(params.source)}` : ""}`,
    subtitle: `${stake}${CAT_LABEL[params.category] ?? ""}`,
    kind: "san",
    tip: CAT_TIP[params.category] ?? "",
    rows: list_.map((actor) => ({ actor, run: "sanRow", args: { params }, button: "Roll SAN" })),
    reveal: "passfail",
  });
}

registerContinuation("sanRow", async ({ params }, ctx) => {
  const r = await sanTest({ actor: ctx.actor, ...params });
  if (!r) return { label: "No test" };
  if (r.skipped) return { pass: true, outcome: null, label: "No test needed", gm: "skipped by a campaign rule" };
  if (r.deferred) return { pass: !!r.outcome?.success, outcome: r.outcome?.auto ? null : r.outcome, label: r.outcome?.success ? "Passed" : "Failed", gm: esc(`rolled ${r.outcome?.total}, ${r.rawLoss} held`) };
  const o = r.outcome;
  const roll = o?.auto ? "adapted" : `rolled ${o?.total}`;
  return {
    pass: !!o?.success,
    outcome: o?.auto ? null : o,
    label: `${o?.success ? "Passed" : "Failed"}: −${r.loss} SAN`,
    gm: esc(`${roll}, lost ${r.loss}${r.tempInsanity ? ", temporary insanity" : ""}${r.breakingPointHit ? ", Breaking Point" : ""}`),
  };
});

/**
 * Run the SAN pipeline for an actor. Losses with no roll (fixed costs, already-rolled outcomes) are
 * applied straight away. A test that needs dice is rolled here only if this user rolls for the
 * actor (its player, or the Handler for NPCs set to roll automatically); otherwise a SAN card goes
 * to chat for the player to click.
 */
export async function runForActor(actor, params) {
  const noDice = params.fixedLoss != null || params.outcome;
  if (noDice || rollsHere(actor)) {
    if (actor.isOwner) return sanTest({ actor, ...params });
    return gm("sanTestRemote", actor.uuid, params);
  }
  await sanGroupCard([actor], params);
  return null;
}

registerHandler("sanTestRemote", async (uuid, params) => {
  const actor = await fromUuid(uuid);
  const r = await sanTest({ actor, ...params });
  return r ? { loss: r.loss, rawLoss: r.rawLoss, deferred: !!r.deferred } : null;
});

registerAction("sanPreset", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  const p = SAN_PRESETS.find((x) => x.id === args.preset);
  if (!actor || !p) return false;
  await runForActor(actor, { successLoss: p.success, failureLoss: p.failure, category: p.category, source: p.label });
  return "Rolled";
});

registerAction("sanCustom", async ({ args }) => {
  const actor = await fromUuid(args.actorUuid);
  await runForActor(actor, args.params);
  return "Rolled";
});

/** From a SAN roll card the player already made on the sheet: apply a loss to that outcome. */
registerAction("applySanToRoll", async ({ message }) => {
  const info = message.getFlag(MODULE_ID, "roll");
  const actor = await fromUuid(info.actorUuid);
  const r = await prompt({
    title: "Apply SAN loss to this roll",
    content: `<p>${esc(actor.name)} rolled ${info.total}: ${outcomeBadge(info)}</p>
      ${field("Preset", `<select name="preset"><option value="">— custom —</option>${SAN_PRESETS.map((p) => `<option value="${p.id}">${esc(`${p.label} — ${p.success}/${p.failure}`)}</option>`).join("")}</select>`)}
      ${field("Loss", `<input type="text" name="s" value="0" style="width:5em"> / <input type="text" name="f" value="1D4" style="width:5em">`)}
      ${field("Category", `<select name="cat">${options(CAT_LABEL, "unnatural")}</select>`)}
      ${field("Victims", `<input type="number" name="victims" value="1" min="1" style="width:5em"> <label><input type="checkbox" name="perVictim"> per-victim</label>`)}
      ${field("Source", `<input type="text" name="source">`)}`,
  });
  if (!r) return false;
  let { s, f, cat, perVictim, source } = r.data;
  if (r.data.preset) {
    const p = SAN_PRESETS.find((x) => x.id === r.data.preset);
    ({ success: s, failure: f, category: cat } = p);
    perVictim = !!p.perVictim;
    source ||= p.label;
  }
  await sanTest({ actor, successLoss: s, failureLoss: f, category: cat, victims: r.data.victims, perVictim, source, outcome: { success: info.success, critical: info.critical, fumble: info.fumble, total: info.total } });
  return "Applied";
});

/** From the system's SAN-damage card (unnatural/tome/ritual): run the full test with those formulas. */
registerAction("sanFromDamageCard", async ({ message }) => {
  const info = message.getFlag(MODULE_ID, "roll");
  const parts = String(info.formula ?? "").replace(/[{}]/g, "").split(",").map((s) => s.trim());
  const actors = canvas.tokens.controlled.map((t) => t.actor).filter((a) => a && ["agent", "npc"].includes(a.type));
  const fallback = game.user.character ? [game.user.character] : [];
  const targets = actors.length ? actors : fallback;
  if (!targets.length) {
    ui.notifications.warn("Select the Agents' tokens first.");
    return false;
  }
  const src = (await fromUuid(info.itemUuid ?? info.actorUuid))?.name ?? "";
  await sanGroupCard(targets, { successLoss: parts[0] ?? "0", failureLoss: parts[1] ?? "1D4", category: "unnatural", source: src });
  return false;
});

/* ------------------------------------------------------------------------ */
/*  WP states (p.47)                                                         */
/* ------------------------------------------------------------------------ */

export async function syncWpState(actor) {
  if (!actor || !["agent", "npc"].includes(actor.type)) return;
  const wp = Number(actor.system.wp?.value ?? 0);
  const existing = effectsWithFlag(actor, "lowWp");
  const want = setting("lowWpPenalty") && wp >= 1 && wp <= 2;
  if (want && !existing.length) {
    await createEffect(actor, {
      name: "Emotional breakdown (WP 1–2)",
      img: `modules/${MODULE_ID}/assets/icons/breakdown.svg`,
      statuses: [STATUS.breakdown],
      changes: ["system.rollTarget.allSkills", "system.rollTarget.sanity", "system.rollTarget.statistics"].map((key) => ({ key, type: "add", value: "-20", phase: "final" })),
      flags: { lowWp: true },
    });
  } else if (!want && existing.length) {
    await deleteEmbedded(actor, "ActiveEffect", existing.map((e) => e.id));
  }
  const lost = wp <= 0;
  if (hasStatus(actor, STATUS.lostControl) !== lost) await setStatus(actor, STATUS.lostControl, lost);
}

/** Depression and similar: WP cost per test during an acute episode. */
export async function wpPerTestHook(roll, message) {
  if (!setting("depressionWp")) return;
  const actor = roll.actor;
  if (!isAgent(actor) || !["stat", "skill", "weapon", "special-training"].includes(roll.type)) return;
  if (message.getFlag(MODULE_ID, "roll")?.context?.noWpCost) return;
  const active = disordersOf(actor, { activeOnly: true }).filter((m) => m.system.acuteEpisode && (disorderDef(m)?.wpPerTest || m.getFlag(MODULE_ID, "wpPerTest")));
  if (!active.length) return;
  const r = await evalFormula("1d4");
  const after = Math.max(0, actor.system.wp.value - r.total);
  await update(actor, { "system.wp.value": after });
  await postCard({ actor, title: "Depressive episode", body: `<p>Every test costs ${esc(actor.name)} 1D4 WP: −${r.total} (WP ${after}).</p>`, rolls: [r] });
}

/* ------------------------------------------------------------------------ */
/*  Manual SAN edits                                                         */
/* ------------------------------------------------------------------------ */

/**
 * preUpdateActor: when someone lowers an Agent's SAN by hand (sheet field, token bar), take the
 * change out of the update and run it through the SAN pipeline instead, so projection, temporary
 * insanity, the Breaking Point and adaptation all happen as if it were a SAN loss.
 */
export function interceptManualSan(actor, changed, options, userId) {
  if (userId !== game.user.id || options?.dgOpsSan || options?.dgOpsUndo) return;
  if (!setting("manualSan") || actor.type !== "agent") return;
  const next = foundry.utils.getProperty(changed, "system.sanity.value");
  if (next === undefined || next === null) return;
  const before = Number(actor.system.sanity?.value) || 0;
  const loss = before - Number(next);
  if (!(loss > 0)) return;
  delete changed.system.sanity.value;
  sanTest({ actor, fixedLoss: loss, category: "other", source: "SAN lowered by hand", manual: true }).catch((e) => console.error(e));
}

export { CAT_LABEL, disorderDef };
