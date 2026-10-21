/**
 * Impossible Landscapes: the Handler's Corruption tools (pp.17–18). Everything posts to the
 * Handler only.
 */
import { MODULE_ID } from "../../core/constants.mjs";
import { setWorld } from "../../core/ops.mjs";
import { postCard, gmWhisper, list } from "../../core/chat.mjs";
import { prompt, esc, field, options } from "../../core/ui.mjs";
import { activeAgents, teamOnScene } from "../../core/team.mjs";
import { startingCorruption, rankTargets, thresholdCheck, OPERATIONS, BAND_LABELS, GIFTS, INSIGHTS } from "./rules.mjs";
import { il, corruptionOf, adjustCorruption, setCorruption, sessionOf, cap, currentSession, operation, operationLabel, floorOf } from "./state.mjs";

const gmOnly = () => {
  if (game.user.isGM) return true;
  ui.notifications.warn("Corruption is for the Handler.");
  return false;
};

const sanOf = (a) => Number(a.system?.sanity?.value) || 0;

/** The Agents a scene involves: active Agents on the scene (else the whole team), minus the vanished. */
export function present() {
  return teamOnScene().filter((a) => !il(a).vanished);
}

/** Starting Corruption: one dialog for every Agent not yet set (p.17). */
export async function startingDialog(actors = activeAgents()) {
  if (!gmOnly()) return null;
  const todo = actors.filter((a) => a.type === "agent");
  if (!todo.length) return ui.notifications.info("No Agents on the team.");
  const rows = todo
    .map((a) => {
      const s = startingCorruption(a.system);
      const done = il(a).started;
      const why = [`${s.checks} adaptation check${s.checks === 1 ? "" : "s"}`, `${s.arts} Art skill${s.arts === 1 ? "" : "s"} at 20%+${s.arts ? ` (${s.artNames.map(esc).join(", ")})` : ""}`].join(", ");
      return `<tr><td>${esc(a.name)}${done ? ` <small class="dgops-quiet">(set: ${corruptionOf(a)})</small>` : ""}</td><td class="dgops-quiet">${why}</td><td><input type="number" name="c-${a.id}" value="${done ? corruptionOf(a) : s.total}" min="0" max="10" style="width:4em"></td><td><input type="checkbox" name="use-${a.id}" ${done ? "" : "checked"}></td></tr>`;
    })
    .join("");
  const r = await prompt({
    title: "Starting Corruption",
    width: 620,
    content: `<p>+1 per checked adaptation box (violence and helplessness) and +1 per Art skill at 20% or more (p.17). This only counts at the start of play. Players never see these numbers.</p>
      <table class="dgops-table"><tr><th>Agent</th><th>Counted</th><th>Corruption</th><th>Set</th></tr>${rows}</table>`,
    buttons: [{ action: "ok", label: "Confirm", default: true }, { action: "no", label: "Cancel" }],
  });
  if (r?.action !== "ok") return null;
  const lines = [];
  for (const a of todo) {
    if (!r.data[`use-${a.id}`]) continue;
    const v = await setCorruption(a, r.data[`c-${a.id}`] ?? 0);
    lines.push(`${esc(a.name)}: <b>${v}</b>`);
  }
  if (lines.length) await postCard({ title: "Starting Corruption", subtitle: "Handler only", body: list(lines), whisper: gmWhisper() });
  return lines.length;
}

/** Start a new game session: every Agent's per-session movement goes back to zero. */
export async function newSession({ confirm = true } = {}) {
  if (!gmOnly()) return null;
  if (confirm) {
    const r = await prompt({
      title: "New session",
      content: `<p>Start session ${currentSession() + 1}? Each Agent can then gain or lose up to ${cap()} Corruption again (${esc(operationLabel())}, p.18).</p>${field("Operation", `<select name="op">${options(Object.fromEntries(Object.entries(OPERATIONS).map(([k, v]) => [k, `${v.label} (cap ${v.cap})`])), operation())}</select>`)}`,
      buttons: [{ action: "ok", label: "New session", default: true }, { action: "no", label: "Cancel" }],
    });
    if (r?.action !== "ok") return null;
    if (r.data.op && r.data.op !== operation()) await game.settings.set(MODULE_ID, "ilOperation", r.data.op);
  }
  const n = currentSession() + 1;
  await setWorld("ilSession", n);
  ui.notifications.info(`Impossible Landscapes: session ${n}. Corruption caps reset.`);
  return n;
}

/** Who does it pick? Highest Corruption, ties to the lowest SAN (p.17). */
export async function whoDoesItPick(actors = present()) {
  if (!gmOnly()) return null;
  const ranked = rankTargets(actors.map((a) => ({ id: a.id, corruption: corruptionOf(a), san: sanOf(a), actor: a })));
  if (!ranked.length) {
    ui.notifications.info("No Agents here.");
    return null;
  }
  const top = ranked[0];
  await postCard({
    actor: top.actor,
    title: "Who does it pick?",
    subtitle: "Handler only",
    body: `<p><b>${esc(top.actor.name)}</b> (Corruption ${top.corruption}, SAN ${top.san}).</p>${list(ranked.map((r, i) => `${i + 1}. ${esc(r.actor.name)}: Corruption ${r.corruption}, SAN ${r.san}`))}`,
    tip: "Highest Corruption; on a tie, the lowest SAN (p.17).",
    whisper: gmWhisper(),
  });
  return top.actor;
}

/**
 * A location with a Corruption threshold (p.18). Lists who can see it; if anyone qualifies, the
 * whole group sees it and the others rise to the threshold.
 */
export async function thresholdDialog(actors = present()) {
  if (!gmOnly()) return null;
  if (!actors.length) return ui.notifications.info("No Agents here.");
  const r = await prompt({
    title: "Corruption threshold",
    content: `${field("Threshold", `<input type="number" name="min" value="1" min="0" max="10" style="width:4em">`)}
      <p>Who is there together?</p>
      ${actors.map((a) => `<label class="dgops-radio"><input type="checkbox" data-multi name="ids" value="${a.id}" checked> ${esc(a.name)} <em>(${corruptionOf(a)})</em></label>`).join("")}
      <label class="dgops-radio"><input type="checkbox" name="pull" checked> Raise lower-Corruption Agents to the threshold</label>`,
    buttons: [{ action: "ok", label: "Check", default: true }],
  });
  if (!r) return null;
  const group = actors.filter((a) => (r.data.ids ?? []).includes(a.id));
  return threshold(group, Number(r.data.min) || 0, { pull: !!r.data.pull });
}

export async function threshold(group, min, { pull = true } = {}) {
  const res = thresholdCheck(group.map((a) => ({ id: a.id, corruption: corruptionOf(a) })), min);
  const name = (id) => esc(group.find((a) => a.id === id)?.name ?? id);
  const lines = [];
  if (!res.open) lines.push(`Nobody here has Corruption ${min}+. The place stays hidden.`);
  else {
    lines.push(`Everyone present experiences it: ${res.eligible.map(name).join(", ")}.`);
    for (const p of res.pulled) {
      if (pull) await adjustCorruption(group.find((a) => a.id === p.id), p.to - p.from, { rule: true, quiet: true, reason: `Threshold ${min}` });
      lines.push(`${name(p.id)}: ${p.from} → <b>${p.to}</b>${pull ? "" : " (not applied)"}`);
    }
  }
  await postCard({ title: `Corruption threshold ${min}`, subtitle: "Handler only", body: list(lines), tip: "Those with enough Corruption drag the others in with them (p.18).", whisper: gmWhisper() });
  return res;
}

/** Ask for an amount and adjust selected Agents (macro). */
export async function adjustDialog(actors) {
  if (!gmOnly()) return null;
  if (!actors?.length) return ui.notifications.warn("Select Agents' tokens or pick them on the Console roster.");
  const r = await prompt({
    title: "Corruption",
    content: `<p>For: <b>${actors.map((a) => esc(`${a.name} (${corruptionOf(a)})`)).join(", ")}</b></p>
      ${field("Change", `<input type="number" name="d" value="1" min="-10" max="10" style="width:4em">`)}
      ${field("Why", `<select name="why">${options({ investigate: "Puzzled out something of the King (+)", disengage: "Pulled away from Carcosa (−)", rule: "A rule says so (not capped)", correction: "Fixing a mistake (not counted)" }, "investigate")}</select>`)}
      ${field("Note", `<input type="text" name="note" placeholder="e.g. read the letter">`)}`,
    buttons: [{ action: "ok", label: "Apply", default: true }],
  });
  if (!r) return null;
  const d = Number(r.data.d) || 0;
  for (const a of actors) await adjustCorruption(a, d, { rule: r.data.why === "rule", correction: r.data.why === "correction", reason: r.data.note || r.data.why });
  return d;
}

/* ---------------- Console ---------------- */

/** The Corruption strip on each roster card (Handler only). */
export function consoleCard(a) {
  if (!game.user.isGM || a.type !== "agent") return "";
  const d = il(a);
  const c = corruptionOf(a);
  const s = sessionOf(a);
  const k = cap();
  const pips = Array.from({ length: 10 }, (_, i) => `<i class="${i < c ? "on" : ""}${i < floorOf(a) ? " floor" : ""}"></i>`).join("");
  const tags = [];
  if (!d.started) tags.push(`<span class="flag" data-tooltip="Starting Corruption not confirmed yet">unset</span>`);
  if (d.beacon) tags.push(`<span class="flag bad" data-tooltip="Corruption 10: a beacon to the King (p.18)">Beacon</span>`);
  if (d.repeater) tags.push(`<span class="flag bad" data-tooltip="Hit 0 SAN at Corruption 10 (p.18)">Repeater</span>`);
  if (d.vanished) tags.push(`<span class="flag bad" data-tooltip="Opened their bottle and hit 0 SAN (p.344)">Vanished</span>`);
  if (d.corruptionFloor) tags.push(`<span class="flag" data-tooltip="Opened their Soul Bottle: never below 5 (p.344)">Floor 5</span>`);
  if (d.bottleDestroyed) tags.push(`<span class="flag warn" data-tooltip="Bottle destroyed: every failed SAN roll takes the maximum (p.344)">No bottle</span>`);
  if (d.yellowSign?.failed) tags.push(`<span class="flag${d.yellowSign.shared ? "" : " warn"}" data-tooltip="${d.yellowSign.shared ? "Has seen and shared the Yellow Sign" : "Has seen the Yellow Sign and must share it (p.347)"}">Sign${d.yellowSign.shared ? "" : "!"}</span>`);
  if (d.gift != null) tags.push(`<span class="flag" data-tooltip="${esc(`Gift: ${GIFTS[d.gift]?.name} · Insight: ${INSIGHTS[d.insight]?.name}${d.giftsRevealed ? " (revealed)" : ""}`)}">Gift</span>`);
  const hit = s.gained >= k || s.lost >= k;
  return `<div class="dgops-il" data-tooltip="Corruption: the Handler's eyes only">
    <span class="dgops-il__label">Corruption</span><span class="dgops-il__pips">${pips}</span><b class="dgops-il__num">${c}</b>
    <span class="dgops-il__btns"><a data-dgops-app="ilMinus" data-uuid="${a.uuid}" data-tooltip="Correction −1 (not counted)">−</a><a data-dgops-app="ilPlus" data-uuid="${a.uuid}" data-tooltip="Correction +1 (not counted)">+</a><a data-dgops-app="ilInvestigate" data-uuid="${a.uuid}" data-tooltip="Investigates the King: +1">Investigate</a><a data-dgops-app="ilDisengage" data-uuid="${a.uuid}" data-tooltip="Pulls away: −1">Disengage</a></span>
    <span class="dgops-il__session ${hit ? "hit" : ""}" data-tooltip="This session: gained ${s.gained}, lost ${s.lost}; cap ${k}">+${s.gained}/−${s.lost} of ${k}</span>
    ${tags.length ? `<span class="dgops-il__tags">${tags.join("")}</span>` : ""}
  </div>`;
}

export { BAND_LABELS };
