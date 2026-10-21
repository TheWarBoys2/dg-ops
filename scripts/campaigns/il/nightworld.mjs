/**
 * Impossible Landscapes: SAN loss held while an Agent is in the Night World. The test is rolled as
 * usual but nothing comes off the sheet; the loss goes into flags.dg-ops.il.nightWorld and the
 * Handler applies the total (as one loss) when the Agent comes back. A house rule, not the book's.
 *
 *  nightWorld   { inside, held, log: [{ amount, source, category, t }] }
 */
import { postCard, gmWhisper, list } from "../../core/chat.mjs";
import { prompt, esc, options } from "../../core/ui.mjs";
import { gm, registerHandler } from "../../core/socket.mjs";
import { runForActor } from "../../features/sanity.mjs";
import { addSanDialogField } from "../../core/extensions.mjs";
import { il, setIl } from "./state.mjs";

export const TAG = "il:nightWorld";
const CATS = { unnatural: "Unnatural", violence: "Violence", helplessness: "Helplessness", other: "Other" };

export function nightWorldOf(actor) {
  const n = il(actor).nightWorld ?? {};
  return { inside: !!n.inside, held: Math.max(0, Number(n.held) || 0), log: Array.isArray(n.log) ? n.log : [] };
}

const gmOnly = () => {
  if (game.user.isGM) return true;
  ui.notifications.warn("The Night World tally is for the Handler.");
  return false;
};

/** Add to (or take from) an Agent's held loss. Runs on the Handler's client so players never see it. */
export async function holdLoss(actor, amount, { source = "", category = "unnatural" } = {}) {
  if (!actor) return null;
  if (!game.user.isGM) return gm("ilNightHold", actor.uuid, amount, { source, category });
  const n = nightWorldOf(actor);
  const held = Math.max(0, n.held + (Number(amount) || 0));
  const log = [...n.log, { amount: held - n.held, source, category, t: game.time.worldTime }].slice(-40);
  await setIl(actor, { nightWorld: { ...n, held, log } });
  return held;
}

export async function setInside(actor, inside) {
  if (!gmOnly() || !actor) return null;
  const n = nightWorldOf(actor);
  await setIl(actor, { nightWorld: { ...n, inside: !!inside } });
  return !!inside;
}

/** Most of the held loss came from this category (used as the default when applying it). */
function mainCategory(log) {
  const by = {};
  for (const e of log) if (e.amount > 0) by[e.category] = (by[e.category] ?? 0) + e.amount;
  return Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unnatural";
}

/**
 * Leaving the Night World: lose the held total as one loss (so 5+ can mean temporary insanity, and
 * Breaking Points count), then clear the tally.
 */
export async function applyHeld(actor, { amount = null, category = null, leave = true } = {}) {
  if (!gmOnly() || !actor) return null;
  const n = nightWorldOf(actor);
  const loss = Math.max(0, Number(amount ?? n.held) || 0);
  const cat = category ?? mainCategory(n.log);
  await setIl(actor, { nightWorld: { inside: leave ? false : n.inside, held: 0, log: [] } });
  if (!loss) {
    ui.notifications.info(`${actor.name}: nothing held.`);
    return null;
  }
  return runForActor(actor, { fixedLoss: loss, category: cat, source: "Leaving the Night World" });
}

/** The Handler's dialog: see the tally, change it, or apply it. */
export async function nightWorldDialog(actors) {
  if (!gmOnly()) return null;
  const agents = (actors ?? []).filter((a) => a?.type === "agent");
  if (!agents.length) return ui.notifications.warn("Select Agents' tokens or pick them on the Console roster.");
  const rows = agents
    .map((a) => {
      const n = nightWorldOf(a);
      const recent = n.log.slice(-4).map((e) => `${e.amount >= 0 ? "+" : ""}${e.amount} ${esc(e.source || "")}`).join("; ");
      return `<tr><td>${esc(a.name)}${n.inside ? ` <em>(inside)</em>` : ""}</td><td><input type="number" name="h-${a.id}" value="${n.held}" min="0" style="width:4.5em"></td><td><select name="c-${a.id}">${options(CATS, mainCategory(n.log))}</select></td><td class="dgops-quiet">${recent || "nothing yet"}</td></tr>`;
    })
    .join("");
  const r = await prompt({
    title: "Night World: held SAN loss",
    width: 640,
    content: `<p>SAN loss rolled in the Night World waits here. Change a number to correct it; Apply takes it all as one loss and marks the Agent as out.</p>
      <table class="dgops-table"><tr><th>Agent</th><th>Held</th><th>Applied as</th><th>Recent</th></tr>${rows}</table>
      <label class="dgops-radio"><input type="checkbox" name="inside"> Mark them as in the Night World (every SAN test is held until they leave)</label>`,
    buttons: [
      { action: "save", label: "Save", default: true },
      { action: "apply", label: "Apply now (they've left)" },
      { action: "no", label: "Cancel" },
    ],
  });
  if (!r || r.action === "no") return null;
  for (const a of agents) {
    const want = Math.max(0, Number(r.data[`h-${a.id}`]) || 0);
    const n = nightWorldOf(a);
    if (want !== n.held) await holdLoss(a, want - n.held, { source: "Handler's correction" });
    if (r.action === "apply") await applyHeld(a, { amount: want, category: r.data[`c-${a.id}`] });
    else if (r.data.inside && !n.inside) await setInside(a, true);
  }
  return r.action;
}

/* ---------------- SAN hooks ---------------- */

export function sanPreCheck({ actor, params }) {
  if (actor?.type !== "agent") return null;
  // Opening a Soul Bottle needs the result straight away (it decides whether they vanish).
  if (params.tags?.includes("il:openBottle")) return null;
  if (params.tags?.includes(TAG) || nightWorldOf(actor).inside) return { defer: "In the Night World: held until they leave." };
  return null;
}

export async function sanResult({ actor, params, result }) {
  if (!result?.deferred || actor?.type !== "agent") return;
  if (!(params.tags?.includes(TAG) || nightWorldOf(actor).inside)) return;
  if (result.rawLoss > 0) await holdLoss(actor, result.rawLoss, { source: params.source || "SAN test", category: params.category });
}

/* ---------------- Console ---------------- */

export function consoleStrip(a) {
  if (!game.user.isGM || a.type !== "agent") return "";
  const n = nightWorldOf(a);
  if (!n.inside && !n.held) return "";
  return `<div class="dgops-il dgops-il--night" data-tooltip="SAN loss held in the Night World">
    <span class="dgops-il__label"><i class="fas fa-moon"></i> Night World${n.inside ? "" : " (out)"}</span><b class="dgops-il__num">${n.held}</b>
    <span class="dgops-il__btns"><a data-dgops-app="ilNightMinus" data-uuid="${a.uuid}" data-tooltip="Held −1">−</a><a data-dgops-app="ilNightPlus" data-uuid="${a.uuid}" data-tooltip="Held +1">+</a><a data-dgops-app="ilNightApply" data-uuid="${a.uuid}" data-tooltip="They've left: lose it all now">Apply</a></span>
  </div>`;
}

export function registerNightWorld() {
  addSanDialogField({
    html: () => `<label class="dgops-radio"><input type="checkbox" name="ilNightWorld"> In the Night World: hold the loss until they leave</label>`,
    read: (data) => (data?.ilNightWorld ? { tags: [TAG] } : null),
  });
  registerHandler("ilNightHold", async (uuid, amount, o) => holdLoss(await fromUuid(uuid), amount, o ?? {}));
}

/** A Handler card listing everyone's held loss (macro). */
export async function nightWorldReport(actors) {
  const rows = (actors ?? []).filter((a) => a?.type === "agent").map((a) => [a, nightWorldOf(a)]).filter(([, n]) => n.held || n.inside);
  await postCard({ title: "Night World", subtitle: "Handler only", body: rows.length ? list(rows.map(([a, n]) => `${esc(a.name)}: <b>${n.held}</b> held${n.inside ? " (inside)" : ""}`)) : "<p>Nobody has SAN loss held.</p>", whisper: gmWhisper() });
}
