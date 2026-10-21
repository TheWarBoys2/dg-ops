/**
 * Impossible Landscapes: pure rules (no Foundry). Page numbers are the printed pages of the
 * Impossible Landscapes campaign book. Everything here is a short paraphrase for the Handler's
 * reference; read the book for the full text.
 */

export const CORRUPTION_MIN = 0;
export const CORRUPTION_MAX = 10;
export const BEACON = 10;
export const BOTTLE_FLOOR = 5;

/** The four parts of the campaign and their per-session cap on Corruption gained or lost (p.18). */
export const OPERATIONS = {
  "night-floors": { label: "The Night Floors", cap: 3 },
  "secret-faces": { label: "A Volume of Secret Faces", cap: 4 },
  "map-of-skin": { label: "Like a Map Made of Skin", cap: 5 },
  "end-of-world": { label: "The End of the World of the End", cap: 6 },
};

export function sessionCap(operation) {
  return OPERATIONS[operation]?.cap ?? 3;
}

export const clampCorruption = (v, floor = 0) => Math.max(Math.max(CORRUPTION_MIN, floor), Math.min(CORRUPTION_MAX, Math.round(Number(v) || 0)));

/**
 * Starting Corruption (p.17): +1 per checked adaptation box (violence and helplessness),
 * +1 per Art skill at 20% or more. Only counted once, at the start of play.
 * @param {{adaptations?:object, typedSkills?:object}} system  An Agent's system data.
 */
export function startingCorruption(system) {
  let checks = 0;
  for (const cat of ["violence", "helplessness"]) {
    const a = system?.adaptations?.[cat] ?? system?.sanity?.adaptations?.[cat] ?? {};
    checks += ["incident1", "incident2", "incident3"].filter((k) => a[k] === true).length;
  }
  const arts = Object.values(system?.typedSkills ?? {}).filter((s) => /^art\b/i.test(String(s?.group ?? "")) && Number(s?.proficiency) >= 20);
  return { checks, arts: arts.length, artNames: arts.map((s) => s.label ?? ""), total: clampCorruption(checks + arts.length) };
}

/**
 * Move Corruption by `delta`, honouring 0–10, the Soul Bottle floor and the session cap.
 * Gains and losses are capped separately: an Agent can't gain more than `cap`, or lose more
 * than `cap`, in one session (p.18).
 * @param {object} p
 * @param {number} p.value      Current Corruption.
 * @param {number} p.delta
 * @param {{gained:number, lost:number}} p.session  Movement so far this session.
 * @param {number} p.cap
 * @param {number} [p.floor=0]
 * @param {boolean} [p.ignoreCap=false]  Rules that set Corruption outright (a tome, the Yellow Sign, a threshold).
 * @returns {{value:number, applied:number, capped:boolean, floored:boolean, session:{gained:number,lost:number}}}
 */
export function applyCorruption({ value, delta, session = { gained: 0, lost: 0 }, cap, floor = 0, ignoreCap = false }) {
  const cur = clampCorruption(value, floor);
  const s = { gained: Number(session?.gained) || 0, lost: Number(session?.lost) || 0 };
  let want = Math.round(Number(delta) || 0);
  let capped = false;
  if (!ignoreCap && want > 0 && want > cap - s.gained) {
    want = Math.max(0, cap - s.gained);
    capped = true;
  }
  if (!ignoreCap && want < 0 && -want > cap - s.lost) {
    want = -Math.max(0, cap - s.lost);
    capped = true;
  }
  const next = clampCorruption(cur + want, floor);
  const floored = want < 0 && cur + want < Math.max(0, floor) && floor > 0;
  const applied = next - cur;
  if (applied > 0) s.gained += applied;
  if (applied < 0) s.lost += -applied;
  const over = ignoreCap && (s.gained > cap || s.lost > cap);
  return { value: next, applied, capped: capped || over, floored, session: s };
}

/**
 * Who does it pick? (p.17): the highest Corruption; ties go to the lowest SAN.
 * @param {{id:string, corruption:number, san:number}[]} list
 */
export function rankTargets(list) {
  return [...list].sort((a, b) => b.corruption - a.corruption || a.san - b.san);
}

/**
 * A location with a Corruption threshold (p.18). If anyone present meets it, everyone present
 * experiences it, and each lower-Corruption Agent rises to the threshold.
 * @param {{id:string, corruption:number}[]} present
 * @returns {{open:boolean, eligible:string[], pulled:{id:string, from:number, to:number}[]}}
 */
export function thresholdCheck(present, min) {
  const t = clampCorruption(min);
  const eligible = present.filter((a) => a.corruption >= t).map((a) => a.id);
  if (!eligible.length) return { open: false, eligible: [], pulled: [] };
  const pulled = present.filter((a) => a.corruption < t).map((a) => ({ id: a.id, from: a.corruption, to: t }));
  return { open: true, eligible: present.map((a) => a.id), pulled };
}

/* ------------------------------------------------------------------------ */
/*  Gifts and Insights (pp.259–260)                                          */
/* ------------------------------------------------------------------------ */

export const BAND_LABELS = ["01–10", "11–20", "21–30", "31–40", "41–50", "51–60", "61–70", "71–80", "81–90", "91+"];

/** Band index 0–9 for a 1D100+Corruption total. */
export function bandFor(total) {
  const n = Math.max(1, Number(total) || 1);
  return Math.min(9, Math.floor((n - 1) / 10));
}

/** Paraphrased one-liners. Names are the book's entry headings so they're easy to look up. */
export const GIFTS = [
  { name: "Forgettable", page: 259, text: "Fades into the background; others searching for them are at a penalty while they aren't attacking, and their face never comes out on camera." },
  { name: "Standby", page: 259, text: "Stops needing food or drink, with no ill effects." },
  { name: "My Copy", page: 259, text: "Always has a red-bound copy of the play on them. It comes back if lost or thrown away; losing it to a thief costs SAN." },
  { name: "To Carcosa", page: 260, text: "Stumbles on books, passages and artifacts tied to the King, always by accident. A way to feed this player clues." },
  { name: "Endless Doors", page: 260, text: "Can always find a way out of confinement, at a SAN cost; anyone who follows gains Corruption." },
  { name: "Mirrors", page: 260, text: "Can step through mirrors into a strange liquid realm. Each trip costs SAN and adds Corruption." },
  { name: "Demons", page: 260, text: "Knows where and when to find the demons of the Ars Goetia, each once; contact adds Corruption and risks SAN." },
  { name: "Light", page: 260, text: "Sees a spectral glow on anything the King influences, or a trail to the nearest such thing. Another clue channel." },
  { name: "Missives", page: 261, text: "Finds glowing messages about the King that look like rubbish to everyone else; each one debunked by a teammate costs SAN." },
  { name: "Repeating", page: 261, text: "Gains a Repeater's abilities (p.341), except being stuck in a loop." },
];

export const INSIGHTS = [
  { name: "Extras", page: 259, text: "Notices badly costumed 'extras' everywhere. Catching them off guard adds Corruption and costs SAN; they may lead somewhere." },
  { name: "Eating Is Gone", page: 259, text: "May realise nobody has been seen eating or drinking since the Dorchester House. Mentioning it adds Corruption." },
  { name: "A Life on Stage", page: 259, text: "Sees scenes from the play echoed in everyday life. Asking anyone about the play adds Corruption." },
  { name: "Dreams", page: 260, text: "Dreams of a stone maze and a sealed bottle; a Luck roll on waking recalls the name on it and adds Corruption." },
  { name: "Exeunt", page: 260, text: "Glimpses people slipping into impossible passages. Confirming one costs SAN and adds Corruption." },
  { name: "The Phantom", page: 260, text: "A blurred figure appears behind them in mirrors after long staring, and answers one question about the King each time, for Corruption." },
  { name: "Instructions", page: 260, text: "Hears a man's voice giving orders no one else hears (perhaps someone met at the Dorchester House). Costs SAN." },
  { name: "Strings", page: 260, text: "Sees distant people as marionettes on strings. Costs SAN; chasing them adds Corruption and finds nothing." },
  { name: "Everywhere", page: 261, text: "Ads and headlines everywhere hint at what they're living through, with their name nearby. Costs SAN the first time; seeking them adds Corruption." },
  { name: "The Future", page: 261, text: "Knows with certainty what they must find in Carcosa or haunt the Night World forever. Costs SAN and adds Corruption." },
];

/**
 * Assign one Gift and one Insight per Agent with no repeats across the team (p.259 says it's best
 * if each is unique). A band already taken moves to the nearest free band, upward first.
 * @param {{id:string, giftRoll:number, insightRoll:number, corruption:number}[]} agents  Raw d100s.
 * @returns {{id:string, gift:number, insight:number, giftTotal:number, insightTotal:number, moved:boolean}[]}
 */
export function assignGiftsInsights(agents, taken = { gifts: [], insights: [] }) {
  const usedG = new Set(taken.gifts ?? []);
  const usedI = new Set(taken.insights ?? []);
  const pick = (band, used) => {
    for (let d = 0; d < 10; d++) {
      for (const b of d ? [band + d, band - d] : [band]) {
        if (b >= 0 && b <= 9 && !used.has(b)) {
          used.add(b);
          return b;
        }
      }
    }
    return band;
  };
  return agents.map((a) => {
    const giftTotal = Number(a.giftRoll) + (Number(a.corruption) || 0);
    const insightTotal = Number(a.insightRoll) + (Number(a.corruption) || 0);
    const gb = bandFor(giftTotal);
    const ib = bandFor(insightTotal);
    const gift = pick(gb, usedG);
    const insight = pick(ib, usedI);
    return { id: a.id, gift, insight, giftTotal, insightTotal, moved: gift !== gb || insight !== ib };
  });
}

/* ------------------------------------------------------------------------ */
/*  The Yellow Sign (p.347)                                                  */
/* ------------------------------------------------------------------------ */

export const YELLOW_SIGN = { id: "ilYellowSign", label: "See the Yellow Sign", category: "helplessness", success: "0", failure: "1D4", page: 347 };

/* ------------------------------------------------------------------------ */
/*  Interference (The Preliminary Invocation to Primeumaton, p.351)          */
/* ------------------------------------------------------------------------ */

export const INTERFERENCE_DELAY = "4D6";

/** The misfortune that finds an operator who broke the circle, by their Corruption. */
export function interferenceFor(corruption) {
  const c = Number(corruption) || 0;
  if (c >= 8) return { key: "bizarre", label: "Bizarre danger (a lightning strike, a mudslide, a failing lift)", lethality: 15 };
  if (c >= 4) return { key: "violence", label: "Violence (a rampage killer, a bomb)", damage: "1D10" };
  if (c >= 3) return { key: "illness", label: "Illness needing invasive treatment (appendicitis, a debilitating disease)", damage: "1D8" };
  return { key: "accident", label: "Accident (a car crash, a fall down the stairs)", damage: "1D6" };
}

/* ------------------------------------------------------------------------ */
/*  Soul Bottles (pp.343–344)                                                */
/* ------------------------------------------------------------------------ */

export const BOTTLE_SEARCH_HOURS = 8;
export const BOTTLE_OPEN = { success: "1D10", failure: "1D100", category: "unnatural" };

/** Soul Bottle search: 1D100 + Corruption after each 8 hours in the Whisper Labyrinth (p.344). */
export function bottleSearch(total) {
  const t = Number(total) || 0;
  if (t >= 100) return { key: "own", label: "Finds their own Soul Bottle." };
  if (t === 99) return { key: "bond", label: "Finds the Soul Bottle of one of their Bonds." };
  if (t >= 94) return { key: "known", label: "Finds the bottle of someone they know." };
  return { key: "manifestation", label: "Meets a manifestation in the labyrinth (see the Night Floors manifestations, p.104)." };
}

/* ------------------------------------------------------------------------ */
/*  Metal and porcelain (Clockwork Child p.338, Marionettes p.341)           */
/* ------------------------------------------------------------------------ */

/** An odd damage roll or odd Lethality roll inflicts only 1 damage. Returns null if nothing changes. */
export function metalAndPorcelain({ kind, rolled, res }) {
  const n = Math.abs(Math.round(Number(rolled) || 0));
  if (n % 2 === 0) return null;
  if (res?.note?.startsWith?.("Transcendent")) return null;
  return { ...res, killed: false, lethalSuccess: false, damage: 1, note: `Metal and porcelain: odd ${kind === "lethality" ? "Lethality roll" : "damage roll"}, only 1 damage` };
}

/* ------------------------------------------------------------------------ */
/*  Tomes (pp.348–350)                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Study presets. san: { fixed } is lost outright; { success, failure, category } is a SAN test.
 * art: % added to one Art skill the reader chooses. skill: another skill and its gain.
 * opens: a version of the play (reading it opens the reader to the King). obsession: the reader's
 * next Breaking Point brings an obsession with finding a complete copy (p.348).
 */
export const TOMES = [
  { id: "leRoi", opens: true, name: "Le Roi en jaune", page: 348, study: "hours", art: 5, unnatural: 5, corruption: 1, san: { fixed: "1D6+2" } },
  { id: "redBook", opens: true, name: "The Red Book", page: 348, study: "an hour", art: 5, unnatural: 5, corruption: 2, san: { fixed: "1D4+2" } },
  { id: "libro", opens: true, name: "Libro Secretorum Manifesta", page: 348, study: "an hour", art: 2, unnatural: 2, corruption: 1, san: { fixed: "1" } },
  { id: "philco", opens: true, obsession: true, name: "The Yellow Phantom (teleplay)", page: 348, study: "half an hour", art: 0, unnatural: 1, corruption: 0, san: { fixed: "1" } },
  { id: "greySong", opens: true, obsession: true, name: "Her Grey Song", page: 349, study: "half an hour", art: 2, unnatural: 2, corruption: 1, san: { success: "0", failure: "1D4", category: "helplessness" } },
  { id: "songTravel", opens: true, obsession: true, name: "A Song Before Travel", page: 349, study: "half an hour", art: 1, unnatural: 1, corruption: 0, san: { fixed: "1" } },
  { id: "phantomSayeth", opens: true, name: "The Phantom Sayeth Scrapbook", page: 349, study: "hours", art: 5, unnatural: 5, corruption: 1, san: { fixed: "1D6+2" } },
  { id: "hygromanteia", name: "Hygromanteia", page: 350, study: "weeks", art: 0, unnatural: 0, corruption: 1, skill: { key: "occult", gain: 2 }, san: null },
  { id: "imperialDynasty", name: "The Imperial Dynasty of America", page: 350, study: "hours", art: 0, unnatural: 1, corruption: 1, san: { fixed: "1", category: "helplessness" } },
];

export function tomeSummary(t) {
  const bits = [`study ${t.study}`];
  if (t.art) bits.push(`one Art +${t.art}%`);
  if (t.unnatural) bits.push(`Unnatural +${t.unnatural}%`);
  if (t.skill) bits.push(`${t.skill.key[0].toUpperCase()}${t.skill.key.slice(1)} +${t.skill.gain}%`);
  if (t.san?.fixed) bits.push(`SAN −${t.san.fixed}`);
  else if (t.san) bits.push(`SAN ${t.san.success}/${t.san.failure}`);
  return `${bits.join(", ")} (p.${t.page})`;
}
