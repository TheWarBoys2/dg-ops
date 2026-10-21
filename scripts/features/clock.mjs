/**
 * The game clock as the Handler sees it: what date and time it is, setting it, and reminders the
 * Handler schedules by hand.
 *
 * The clock is game.time.worldTime plus an offset kept in the world setting `clock`
 * ({ mode: "auto" | "day" | "date", offset }). Relabelling ("it's actually Tuesday") only changes
 * the offset, so nothing on the schedule moves. Moving the clock changes worldTime, so everything
 * due in between happens.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { postCard, gmWhisper } from "../core/chat.mjs";
import { prompt, esc, field, options } from "../core/ui.mjs";
import { schedule, registerEventType } from "../core/scheduler.mjs";
import { activeAgents } from "../core/team.mjs";

const DAY = 86400;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const UNITS = { 60: "minutes", 3600: "hours", 86400: "days", 604800: "weeks" };

const pad = (n) => String(n).padStart(2, "0");

export function clockConfig() {
  try {
    const c = game.settings.get(MODULE_ID, "clock") ?? {};
    return { mode: ["day", "date"].includes(c.mode) ? c.mode : "auto", offset: Number(c.offset) || 0 };
  } catch {
    return { mode: "auto", offset: 0 };
  }
}

/** Seconds on the Handler's clock for a worldTime: Unix seconds in date mode, seconds since Day 1 otherwise. */
export const shown = (t = game.time.worldTime) => t + clockConfig().offset;

/** Pure formatting, so it's testable without Foundry. */
export function formatShown(s, mode) {
  if (mode === "date") {
    const d = new Date(s * 1000);
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const day = Math.floor(s / DAY);
  const r = ((s % DAY) + DAY) % DAY;
  return `Day ${day + 1}, ${pad(Math.floor(r / 3600))}:${pad(Math.floor((r % 3600) / 60))}`;
}

/** The clock as text. With nothing set, the world's calendar (if any) or Day N, as before. */
export function clockText(t = game.time.worldTime) {
  const { mode, offset } = clockConfig();
  if (mode === "auto") {
    try {
      const c = game.time.calendar;
      if (c?.timeToComponents && c?.format) return c.format(t);
    } catch {
      /* fall back */
    }
  }
  return formatShown(t + offset, mode === "date" ? "date" : "day");
}

/** Clock seconds from form inputs: a date ("2026-03-14") or a day number, plus "HH:MM". */
export function parseShown({ date = "", day = null, time = "" }, mode) {
  const [h, m] = String(time || "00:00").split(":").map((x) => Number(x) || 0);
  const tod = h * 3600 + m * 60;
  if (mode === "date") {
    const ms = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(ms) ? ms / 1000 + tod : null;
  }
  const n = Number(day);
  return Number.isFinite(n) && n >= 1 ? (n - 1) * DAY + tod : null;
}

/** The inputs for a clock second, to prefill the dialogs. */
export function inputsFor(s, mode) {
  if (mode === "date") {
    const d = new Date(s * 1000);
    return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, day: 1 };
  }
  const r = ((s % DAY) + DAY) % DAY;
  return { date: "", day: Math.floor(s / DAY) + 1, time: `${pad(Math.floor(r / 3600))}:${pad(Math.floor((r % 3600) / 60))}` };
}

/** Plain-English length of a span, e.g. "3 days 4 h". */
export function spanText(sec) {
  const a = Math.abs(sec);
  const d = Math.floor(a / DAY);
  const h = Math.floor((a % DAY) / 3600);
  const m = Math.round((a % 3600) / 60);
  return [d ? `${d} day${d === 1 ? "" : "s"}` : "", h ? `${h} h` : "", m && !d ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

async function moveTo(worldTime) {
  if (typeof game.time.set === "function") return game.time.set(worldTime);
  return game.time.advance(worldTime - game.time.worldTime);
}

/**
 * Set the clock.
 * @param {object} o
 * @param {number} o.to          Clock seconds (see shown()).
 * @param {"day"|"date"} o.mode  How the clock reads from now on.
 * @param {boolean} [o.move]     true: game time moves and everything due in between happens.
 *                               false: only the label changes; the schedule keeps its place.
 */
export async function setClock({ to, mode, move = false }) {
  if (!game.user.isGM) return ui.notifications.warn("The Handler sets the clock.");
  if (!Number.isFinite(to)) return ui.notifications.warn("That isn't a date and time I can read.");
  const now = game.time.worldTime;
  const cfg = clockConfig();
  const wasMode = cfg.mode === "date" ? "date" : "day";
  if (!move || mode !== wasMode) {
    // A new mode can't be compared with the old one, so switching only relabels.
    await game.settings.set(MODULE_ID, "clock", { mode, offset: to - now });
    return { moved: 0 };
  }
  const delta = to - shown(now);
  if (delta) await moveTo(now + delta);
  return { moved: delta };
}

export async function setClockDialog() {
  if (!game.user.isGM) return ui.notifications.warn("The Handler sets the clock.");
  const cfg = clockConfig();
  const cur = cfg.mode === "date" ? "date" : "day";
  const v = inputsFor(shown(), cur);
  const r = await prompt({
    title: "Set date & time",
    width: 480,
    content: `<p>Now: <b>${esc(clockText())}</b></p>
      ${field("Show the clock as", `<select name="mode">${options({ date: "A calendar date", day: "Day 1, Day 2…" }, cur === "day" && cfg.mode === "auto" ? "date" : cur)}</select>`)}
      ${field("Date", `<input type="date" name="date" value="${esc(v.date)}">`, "For a calendar date.")}
      ${field("Day", `<input type="number" name="day" value="${v.day}" min="1" style="width:5em">`, "For Day 1, Day 2…")}
      ${field("Time", `<input type="time" name="time" value="${esc(v.time)}">`)}
      <label class="dgops-radio"><input type="radio" name="how" value="move" ${cfg.mode === "auto" ? "" : "checked"}> Move the clock: time passes, and everything scheduled before then happens (poisons, healing, reminders, daily upkeep)</label>
      <label class="dgops-radio"><input type="radio" name="how" value="label" ${cfg.mode === "auto" ? "checked" : ""}> Just relabel it: it's that time now, and nothing on the schedule moves</label>
      <p class="hint">Switching between a date and Day numbers always relabels. Moving back in time doesn't undo anything that already happened.</p>`,
    buttons: [{ action: "ok", label: "Set", default: true }, { action: "no", label: "Cancel" }],
  });
  if (r?.action !== "ok") return null;
  const mode = r.data.mode === "day" ? "day" : "date";
  const to = parseShown(r.data, mode);
  if (to == null) return ui.notifications.warn(mode === "date" ? "Pick a date." : "Day must be 1 or more.");
  const move = r.data.how === "move";
  if (move && mode === cur && cfg.mode !== "auto") {
    const delta = to - shown();
    if (delta > 60 * DAY) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "A long jump" }, content: `<p>That moves the clock forward ${esc(spanText(delta))}. Daily upkeep and everything else on the schedule will run for every day in between. Go ahead?</p>` });
      if (!ok) return null;
    }
  }
  const res = await setClock({ to, mode, move });
  ui.notifications.info(`Clock: ${clockText()}${res?.moved ? ` (${res.moved > 0 ? "+" : "−"}${spanText(res.moved)})` : ""}.`);
  return res;
}

/* ------------------------------------------------------------------------ */
/*  Reminders the Handler schedules by hand                                  */
/* ------------------------------------------------------------------------ */

/**
 * Put something on the schedule.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.notes]
 * @param {number} [o.delay]      Seconds from now…
 * @param {number} [o.at]         …or at this worldTime.
 * @param {number} [o.every]      Repeat every this many seconds (0: once).
 * @param {"gm"|"all"} [o.show]   Who sees the card when it comes up.
 * @param {string} [o.actorUuid]  The Agent it's about, if any.
 */
export async function addReminder({ title, notes = "", delay = null, at = null, every = 0, show = "gm", actorUuid = null }) {
  if (!title) return null;
  const label = `${title}${every ? ` (every ${spanText(every)})` : ""}`;
  return schedule({ type: "manual", ...(at != null ? { due: at } : { delay: delay ?? 0 }), actorUuid, data: { title, notes, every: Math.max(0, Number(every) || 0), show }, label });
}

export async function reminderDialog() {
  if (!game.user.isGM) return ui.notifications.warn("The Handler keeps the schedule.");
  const cfg = clockConfig();
  const mode = cfg.mode === "date" ? "date" : "day";
  const v = inputsFor(shown() + 3600, mode);
  const agents = activeAgents();
  const r = await prompt({
    title: "Add to the schedule",
    width: 500,
    content: `${field("What", `<input type="text" name="title" placeholder="e.g. The cult moves the body">`)}
      ${field("Notes", `<textarea name="notes" rows="3" placeholder="Shown on the card when it comes up"></textarea>`)}
      <label class="dgops-radio"><input type="radio" name="when" value="in" checked> In <input type="number" name="n" value="1" min="0" step="any" style="width:5em"> <select name="unit">${options(UNITS, 3600)}</select></label>
      <label class="dgops-radio"><input type="radio" name="when" value="at"> At ${mode === "date" ? `<input type="date" name="date" value="${esc(v.date)}">` : `Day <input type="number" name="day" value="${v.day}" min="1" style="width:4em">`} <input type="time" name="time" value="${esc(v.time)}"></label>
      ${field("Repeat every", `<input type="number" name="rn" value="0" min="0" step="any" style="width:5em"> <select name="runit">${options(UNITS, 86400)}</select>`, "0: just once.")}
      ${field("Who sees it", `<select name="show">${options({ gm: "Just me (whispered)", all: "Everyone (posted to chat)" }, "gm")}</select>`)}
      ${agents.length ? field("About", `<select name="actor"><option value="">Nobody in particular</option>${options(Object.fromEntries(agents.map((a) => [a.uuid, a.name])))}</select>`) : ""}`,
    buttons: [{ action: "ok", label: "Schedule it", default: true }, { action: "no", label: "Cancel" }],
  });
  if (r?.action !== "ok") return null;
  const title = String(r.data.title ?? "").trim();
  if (!title) return ui.notifications.warn("Give it a name.");
  const every = (Number(r.data.rn) || 0) * (Number(r.data.runit) || 0);
  let o;
  if (r.data.when === "at") {
    const s = parseShown(r.data, mode);
    if (s == null) return ui.notifications.warn("That isn't a date and time I can read.");
    const at = s - cfg.offset;
    if (at <= game.time.worldTime) return ui.notifications.warn("That time has already passed.");
    o = { at };
  } else o = { delay: Math.round((Number(r.data.n) || 0) * (Number(r.data.unit) || 3600)) };
  const id = await addReminder({ title, notes: r.data.notes ?? "", every, show: r.data.show === "all" ? "all" : "gm", actorUuid: r.data.actor || null, ...o });
  ui.notifications.info(`Scheduled: ${title}.`);
  return id;
}

export async function fireReminder(evt, actor) {
  const d = evt.data ?? {};
  const notes = String(d.notes ?? "").trim();
  await postCard({
    actor,
    title: esc(d.title || evt.label || "Reminder"),
    subtitle: `${d.show === "all" ? "" : "Handler only · "}${esc(clockText(evt.due))}`,
    body: notes ? notes.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("") : "",
    whisper: d.show === "all" ? null : gmWhisper(),
  });
  if (game.user.isGM) ui.notifications.info(`Scheduled: ${d.title || evt.label}`);
  return d.every > 0 ? { reschedule: evt.due + d.every } : null;
}

registerEventType("manual", fireReminder);
