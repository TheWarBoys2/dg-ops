/**
 * Impossible Landscapes: Gifts and Insights (pp.259–261). One of each per Agent, unique across the
 * team, stored as Handler-only flags. Reveal whispers the summary to the Agent's player.
 */
import { postCard, button, registerAction, gmWhisper, list } from "../../core/chat.mjs";
import { evalFormula } from "../../core/system.mjs";
import { prompt, esc } from "../../core/ui.mjs";
import { playerOwners } from "../../core/team.mjs";
import { assignGiftsInsights, BAND_LABELS, GIFTS, INSIGHTS } from "./rules.mjs";
import { il, corruptionOf, setIl } from "./state.mjs";
import { present } from "./corruption.mjs";

const line = (kind, i) => {
  const e = (kind === "gift" ? GIFTS : INSIGHTS)[i];
  return e ? `<b>${esc(e.name)}</b>: ${esc(e.text)} <span class="dgops-quiet">(p.${e.page})</span>` : "—";
};

/** Bands already given to Agents outside this batch, so the team stays unique. */
function takenBy(others) {
  return { gifts: others.map((a) => il(a).gift).filter((v) => v != null), insights: others.map((a) => il(a).insight).filter((v) => v != null) };
}

/**
 * Roll or pick Gifts and Insights.
 * @param {Actor[]} actors
 * @param {{team?: Actor[]}} [o]  The whole team, so bands held by Agents not in this batch stay unique.
 */
export async function giftsDialog(actors = present(), { team = actors } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Gifts and Insights are for the Handler.");
  if (!actors.length) return ui.notifications.info("No Agents here.");
  const rows = actors
    .map((a) => {
      const d = il(a);
      return `<tr><td>${esc(a.name)} <small class="dgops-quiet">(Corruption ${corruptionOf(a)})</small></td><td><select name="g-${a.id}"><option value="">roll</option>${GIFTS.map((g, i) => `<option value="${i}" ${d.gift === i ? "selected" : ""}>${BAND_LABELS[i]} ${esc(g.name)}</option>`).join("")}</select></td><td><select name="i-${a.id}"><option value="">roll</option>${INSIGHTS.map((g, i) => `<option value="${i}" ${d.insight === i ? "selected" : ""}>${BAND_LABELS[i]} ${esc(g.name)}</option>`).join("")}</select></td></tr>`;
    })
    .join("");
  const r = await prompt({
    title: "Gifts and Insights",
    width: 640,
    content: `<p>Each Agent gets one Gift and one Insight, ideally none shared (p.259). Leave a column on <i>roll</i> to roll 1D100 + Corruption; a band someone already has moves to the nearest free one. Players aren't told until you reveal them, and they should find out in play.</p>
      <table class="dgops-table"><tr><th>Agent</th><th>Gift</th><th>Insight</th></tr>${rows}</table>`,
    buttons: [{ action: "ok", label: "Assign", default: true }, { action: "no", label: "Cancel" }],
  });
  if (r?.action !== "ok") return null;
  return assignGifts(actors, { picks: Object.fromEntries(actors.map((a) => [a.id, { gift: r.data[`g-${a.id}`], insight: r.data[`i-${a.id}`] }])), team });
}

/** Assign and store. picks[id] = { gift, insight } as band indexes (or "" / undefined to roll). */
export async function assignGifts(actors, { picks = {}, team = actors } = {}) {
  const others = team.filter((t) => !actors.some((a) => a.id === t.id));
  const taken = takenBy(others);
  // Picked bands are reserved first so rolled ones avoid them.
  for (const a of actors) {
    const p = picks[a.id] ?? {};
    if (p.gift !== "" && p.gift != null) taken.gifts.push(Number(p.gift));
    if (p.insight !== "" && p.insight != null) taken.insights.push(Number(p.insight));
  }
  const rolls = [];
  const batch = [];
  for (const a of actors) {
    const p = picks[a.id] ?? {};
    const gr = p.gift === "" || p.gift == null ? await evalFormula("1d100", {}, { whisper: gmWhisper() }) : null;
    const ir = p.insight === "" || p.insight == null ? await evalFormula("1d100", {}, { whisper: gmWhisper() }) : null;
    if (gr) rolls.push(gr);
    if (ir) rolls.push(ir);
    batch.push({ a, p, gr, ir });
  }
  const rolledG = batch.filter((b) => b.gr).map((b) => ({ id: b.a.id, giftRoll: b.gr.total, insightRoll: 1, corruption: corruptionOf(b.a) }));
  const rolledI = batch.filter((b) => b.ir).map((b) => ({ id: b.a.id, giftRoll: 1, insightRoll: b.ir.total, corruption: corruptionOf(b.a) }));
  const g = assignGiftsInsights(rolledG, { gifts: taken.gifts, insights: [] });
  const i = assignGiftsInsights(rolledI, { gifts: [], insights: taken.insights });
  const lines = [];
  const btns = [];
  for (const { a, p, gr, ir } of batch) {
    const gift = gr ? g.find((x) => x.id === a.id).gift : Number(p.gift);
    const insight = ir ? i.find((x) => x.id === a.id).insight : Number(p.insight);
    await setIl(a, { gift, insight, giftsRevealed: false });
    const gNote = gr ? ` <span class="dgops-quiet">(rolled ${gr.total}+${corruptionOf(a)})</span>` : "";
    const iNote = ir ? ` <span class="dgops-quiet">(rolled ${ir.total}+${corruptionOf(a)})</span>` : "";
    lines.push(`<b>${esc(a.name)}</b><br>Gift: ${line("gift", gift)}${gNote}<br>Insight: ${line("insight", insight)}${iNote}`);
    btns.push(button("ilRevealGift", `Reveal to ${a.name}'s player`, { args: { actorUuid: a.uuid }, once: `reveal-${a.id}` }));
  }
  await postCard({ title: "Gifts and Insights", subtitle: "Handler only", body: list(lines) + `<div class="dgops-buttons">${btns.join("")}</div>`, rolls, whisper: gmWhisper(), tip: "They aren't obvious at first: let them come out in play (p.259)." });
  return batch.map(({ a }) => ({ id: a.id, gift: il(a).gift, insight: il(a).insight }));
}

/** Whisper an Agent's Gift and Insight to their player (and the Handler). */
export async function revealGift(actor) {
  const d = il(actor);
  if (d.gift == null) return ui.notifications.warn(`${actor.name} has no Gift yet.`);
  const ids = new Set(gmWhisper());
  for (const u of playerOwners(actor)) ids.add(u.id);
  await postCard({ actor, title: "Something has changed", body: `<p>Gift: ${line("gift", d.gift)}</p><p>Insight: ${line("insight", d.insight)}</p>`, whisper: [...ids] });
  await setIl(actor, { giftsRevealed: true });
  return true;
}

export function registerGiftActions() {
  registerAction("ilRevealGift", async ({ args }) => {
    if (!game.user.isGM) return false;
    const actor = await fromUuid(args.actorUuid);
    if (!actor) return false;
    await revealGift(actor);
    return "Revealed";
  });
}
