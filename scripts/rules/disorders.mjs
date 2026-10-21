/**
 * Disorder catalogue (pp.69–72). Causes follow the book's lists: violence p.70–71, helplessness
 * p.71–72, the Unnatural p.72. Summaries are short paraphrases for play reference.
 *
 * trigger:
 *  - "san2"          acute episode when the Agent loses 2+ SAN in a single roll
 *  - "insanityOrBP"  acute episode on temporary insanity or reaching the Breaking Point
 *  - "sleep"         SAN test every time the Agent tries to sleep
 *  - "manual"        Handler triggers it (reminders, loud noises, enclosed spaces…)
 *
 * changes: Active Effect changes applied while the acute episode is active
 *          (the system only activates transfer effects on motivations during an episode).
 */
const ALL = "system.rollTarget.allSkills";
const SAN = "system.rollTarget.sanity";
const STAT = "system.rollTarget.statistics";

const pen = (keys, value) => keys.map((key) => ({ key, type: "add", value: String(value), phase: "final" }));

export const DISORDERS = {
  addiction: {
    name: "Addiction",
    causes: ["violence", "helplessness"],
    trigger: "san2",
    changes: [],
    addiction: true,
    summary:
      "Losing 2+ SAN triggers an overwhelming need. Feeding it gives −20% to skills and stats for a few hours. Every 24 hours without feeding it costs 1D6 WP and blocks WP recovery. At 2 or less WP, the Agent acts self-destructively to feed it.",
  },
  intermittentExplosive: {
    name: "Intermittent Explosive Disorder",
    causes: ["violence"],
    trigger: "san2",
    changes: [],
    summary: "Losing 2+ SAN triggers an outburst of rage out of all proportion to the provocation.",
  },
  ligyrophobia: {
    name: "Ligyrophobia",
    causes: ["violence"],
    trigger: "manual",
    changes: pen([SAN], -20),
    summary: "Fear of loud noises. Gunfire, explosions or other din trigger an episode: all SAN tests at −20%.",
  },
  depression: {
    name: "Depression",
    causes: ["violence", "helplessness", "unnatural"],
    trigger: "manual",
    changes: [],
    wpPerTest: "1D4",
    summary: "Reminders of past trauma trigger an episode. Every skill or stat test costs 1D4 WP while it lasts.",
  },
  paranoia: {
    name: "Paranoia",
    causes: ["violence", "unnatural"],
    trigger: "san2",
    changes: [],
    summary: "Losing 2+ SAN triggers an episode: the Agent can't trust or rely on anyone.",
  },
  ptsd: {
    name: "PTSD",
    causes: ["violence"],
    trigger: "manual",
    changes: [],
    summary:
      "Reminders of past traumas trigger an episode. The Handler picks one: violent reactions to threats only the Agent perceives, or an acute depressive episode (1D4 WP per test).",
  },
  anxiety: {
    name: "Anxiety Disorder",
    causes: ["helplessness"],
    trigger: "san2",
    changes: pen([ALL, STAT, SAN], -20),
    summary: "Losing 2+ SAN triggers panic: all skill tests, stat tests and SAN rolls at −20%.",
  },
  conversion: {
    name: "Conversion Disorder",
    causes: ["helplessness"],
    trigger: "insanityOrBP",
    changes: [],
    summary:
      "Choose blindness, deafness or paralysis. Temporary insanity or reaching the Breaking Point leaves the Agent blind, deaf or paralyzed until the stress subsides.",
  },
  dissociativeIdentity: {
    name: "Dissociative Identity Disorder",
    causes: ["helplessness", "unnatural"],
    trigger: "insanityOrBP",
    changes: [],
    summary:
      "Temporary insanity or reaching the Breaking Point brings an alternate identity to the fore. The Handler decides who's in control.",
  },
  enclosurePhobia: {
    name: "Enclosure-Related Phobia",
    causes: ["helplessness"],
    trigger: "manual",
    changes: pen([SAN], -20),
    summary: "Agoraphobia or claustrophobia. Entering the feared kind of space triggers an episode: SAN tests at −20%.",
  },
  ocd: {
    name: "Obsessive/Compulsive Disorder",
    causes: ["helplessness"],
    trigger: "san2",
    changes: pen([ALL, STAT, SAN], -20),
    summary: "Losing 2+ SAN triggers an episode: −20% to all tests and SAN rolls until things are put in order.",
  },
  sleepDisorder: {
    name: "Sleep Disorder",
    causes: ["violence", "unnatural"],
    trigger: "sleep",
    changes: [],
    summary: "Roll SAN every time the Agent tries to sleep. Failure: no rest and no WP regained for 24 hours.",
  },
  totemicCompulsion: {
    name: "Totemic Compulsion",
    causes: ["violence"],
    trigger: "manual",
    changes: pen([ALL, STAT, SAN], -10),
    summary:
      "Fixated on a totem object. Losing it, or going without it for over an hour, triggers an episode: −10% to all tests and SAN rolls.",
  },
  amnesia: {
    name: "Amnesia",
    causes: ["unnatural"],
    trigger: "san2",
    changes: [],
    summary: "Losing 2+ SAN erases all memory of the episode until the Agent finds a way to bring it back.",
  },
  depersonalization: {
    name: "Depersonalization Disorder",
    causes: ["unnatural"],
    trigger: "san2",
    changes: pen([ALL, STAT], -20),
    summary: "Losing 2+ SAN brings numb detachment: −20% to every skill and stat test.",
  },
  fugues: {
    name: "Fugues",
    causes: ["unnatural"],
    trigger: "insanityOrBP",
    changes: [],
    summary: "Temporary insanity or reaching the Breaking Point causes catatonia or aimless wandering.",
  },
  megalomania: {
    name: "Megalomania",
    causes: ["unnatural"],
    trigger: "san2",
    changes: [],
    summary:
      "Losing 2+ SAN brings indignation at any doubt. Every stat or skill use to get help or make a good impression fails.",
  },
  obsession: {
    name: "Obsession",
    causes: ["helplessness"],
    trigger: "san2",
    changes: [],
    longTermPenalty: -20,
    summary: "Losing 2+ SAN triggers a fixation lasting days: −20% to any long-term action taking more than a few hours.",
  },
};

export function disordersForCause(cause) {
  return Object.entries(DISORDERS)
    .filter(([, d]) => !cause || cause === "other" || d.causes.includes(cause))
    .map(([id, d]) => ({ id, ...d }));
}

/** Permanent insanity outcomes (p.73). */
export const PERMANENT_INSANITY = {
  catatonia: "Catatonia: the mind refuses to engage with the world.",
  delusions: "Delusions: raving, utterly certain of its delusions.",
  psychopathy: "Psychopathy: empathy burned out; people are objects.",
};
