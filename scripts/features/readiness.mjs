/**
 * Readiness: what the module can automate on an actor or item, what needs attention, and one-click fixes.
 * Status: "ok" (ready) · "warn" (works, but check) · "bad" (won't automate) · "na" (nothing to automate).
 */
import { MODULE_ID } from "../core/constants.mjs";
import { DISORDERS } from "../rules/disorders.mjs";
import { parseCapacity, parseKillRadius, MELEE_SKILLS } from "../rules/combat.mjs";
import { isDGBond } from "../core/bonds.mjs";

const RANK = { na: 0, ok: 1, warn: 2, bad: 3 };
export const worst = (list) => list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), "na");

export const STATUS_LABEL = { ok: "Ready", warn: "Check", bad: "Missing", na: "Not automated" };

const RANGED = new Set(["firearms", "heavy_weapons", "artillery"]);

export function disorderIdFor(item) {
  const flagged = item.getFlag?.(MODULE_ID, "disorder");
  if (flagged && (DISORDERS[flagged] || flagged === "custom")) return flagged;
  const name = `${item.system?.disorder ?? ""} ${item.name}`.toLowerCase();
  for (const [id, d] of Object.entries(DISORDERS)) if (name.includes(d.name.toLowerCase())) return id;
  for (const [id, d] of Object.entries(DISORDERS)) if (name.includes(d.name.toLowerCase().split(/[ /]/)[0])) return id;
  return null;
}

/** @returns {{status:string, notes:{status:string,text:string,fix?:object}[]}} */
export function analyzeItem(item) {
  const notes = [];
  const add = (status, text, fix) => notes.push({ status, text, fix });
  const s = item.system ?? {};
  switch (item.type) {
    case "weapon": {
      const hasDamage = /\d|stun/i.test(String(s.damage ?? ""));
      const lethal = Number(s.lethality) > 0;
      if (!s.skill) add("bad", "No attack skill set, so the attack can't be rolled.");
      if (!hasDamage && !lethal) add("bad", "No damage formula and no Lethality rating.");
      if (s.isLethal && !lethal) add("bad", "Marked as a Lethality weapon but the rating is 0%.");
      if (hasDamage || lethal) add("ok", lethal && s.isLethal ? `Lethality ${s.lethality}%${parseKillRadius(s.killRadius) ? `, kill radius ${parseKillRadius(s.killRadius)} m` : ""}.` : `Damage ${s.damage}${MELEE_SKILLS.has(s.skill) ? " + STR bonus" : ""}.`);
      if (s.killRadius && !/n\/?a|none/i.test(s.killRadius) && !parseKillRadius(s.killRadius)) add("warn", `Kill radius "${s.killRadius}" isn't a distance the module can read.`);
      if (RANGED.has(s.skill)) {
        const cap = item.getFlag?.(MODULE_ID, "capacity") ?? parseCapacity(s.ammo);
        if (!cap) add("warn", "Magazine capacity unknown, so ammunition isn't tracked.", { kind: "capacity" });
        else add("ok", `Ammo tracked: ${item.getFlag?.(MODULE_ID, "rounds") ?? cap}/${cap} rounds.`);
        if (lethal && !s.isLethal && !item.getFlag?.(MODULE_ID, "selectiveFire")) add("warn", "Has a Lethality rating but isn't marked selective-fire, so bursts and sprays are hidden.", { kind: "selectiveFire" });
      }
      break;
    }
    case "motivation": {
      if (!s.disorder) {
        add("na", s.crossedOut ? "Crossed-out motivation." : "Motivation (not a disorder). Crossed out automatically at the Breaking Point.");
        break;
      }
      const id = disorderIdFor(item);
      if (!id) add("warn", "Disorder not recognised, so it has no automatic trigger. Map it to the catalogue.", { kind: "mapDisorder" });
      else if (id === "custom") add("ok", `Custom disorder, triggered ${triggerText(item.getFlag?.(MODULE_ID, "trigger") ?? "manual")}.`);
      else {
        const d = DISORDERS[id];
        add("ok", `${d.name}: triggered ${triggerText(item.getFlag?.(MODULE_ID, "trigger") ?? d.trigger)}.${d.changes.length ? " Penalties apply during episodes." : ""}`);
        if (d.changes.length && !hasEpisodeEffect(item)) add("warn", "No episode effect on the item, so penalties won't apply.", { kind: "addEpisodeEffect" });
      }
      if (s.disorderCured) add("ok", "Cured — may return with the next disorder.");
      break;
    }
    case "bond": {
      if (item.getFlag?.(MODULE_ID, "broken") || s.score <= 0) add("warn", "Broken. Kept on the sheet; it can't be drawn on.");
      else add("ok", `${isDGBond(item) ? "Delta Green Bond (spared by Home costs)" : "Bond"}: ${s.score}.`);
      break;
    }
    case "armor":
      add(Number(s.protection) > 0 ? "ok" : "warn", Number(s.protection) > 0 ? `Armor ${s.protection}${s.equipped ? "" : " (not equipped)"}.` : "Armor rating is 0.");
      break;
    default:
      add("na", "Nothing to automate on this item.");
  }
  return { status: worst(notes.map((n) => n.status)), notes };
}

function hasEpisodeEffect(item) {
  return (item.effects?.contents ?? [...(item.effects?.values?.() ?? [])]).length > 0;
}

export function triggerText(t) {
  return { san2: "when losing 2+ SAN at once", insanityOrBP: "by temporary insanity or the Breaking Point", sleep: "every time they try to sleep", manual: "by the Handler" }[t] ?? "by the Handler";
}

/** @returns {{status:string, notes:{status,text,fix?}[], items:{item, status, notes}[]}} */
export function analyzeActor(actor) {
  const notes = [];
  const add = (status, text, fix) => notes.push({ status, text, fix });
  const s = actor.system ?? {};
  if (actor.type === "agent") {
    const bp = Number(s.sanity?.currentBreakingPoint);
    if (!Number.isFinite(bp) || bp > 99 || bp < 0) add("bad", "Breaking Point isn't set, so disorders won't trigger.", { kind: "resetBP" });
    else if (bp >= s.sanity.value) add("warn", `Breaking Point (${bp}) is at or above current SAN (${s.sanity.value}): the next loss will trigger it.`, { kind: "resetBP" });
    else add("ok", `SAN ${s.sanity.value}, Breaking Point ${bp}.`);
    const bonds = actor.itemTypes.bond.filter((b) => !b.getFlag?.(MODULE_ID, "broken") && b.system.score > 0);
    if (!bonds.length) add("warn", "No intact Bonds: projection and repression aren't possible.");
    else add("ok", `${bonds.length} Bond${bonds.length > 1 ? "s" : ""} available for projection.`);
    if (actor.prototypeToken && actor.prototypeToken.actorLink === false) add("warn", "The Agent's token isn't linked, so damage on the map won't reach the sheet.", { kind: "linkToken" });
    const owners = game.users?.filter?.((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER")) ?? [];
    if (!owners.length) add("warn", "No player owns this Agent, so their prompts go to the Handler.");
    else add("ok", `Prompts go to ${owners.map((u) => u.name).join(", ")}.`);
    const pend = actor.getFlag?.(MODULE_ID, "pendingDisorders") ?? [];
    if (pend.length) add("warn", `${pend.length} disorder${pend.length > 1 ? "s" : ""} waiting to be assigned.`, { kind: "assignDisorder" });
  }
  if (actor.type === "unnatural") {
    const prot = actor.getFlag?.(MODULE_ID, "protection");
    if (!prot) add("warn", "Protection isn't set, so it takes damage like a person (Exposed). Many unnatural things are Huge or Transcendent.", { kind: "protection" });
    else add("ok", `Protection: ${prot}.`);
    const sl = s.sanity;
    if (sl?.failedLoss) add("ok", `Seeing it costs ${sl.successLoss}/${sl.failedLoss} SAN; destroying it restores ${sl.successLoss}.`);
  }
  if (actor.type === "npc" && actor.prototypeToken?.actorLink === false) add("ok", "Unlinked NPC: each token tracks its own wounds.");
  if (actor.type === "vehicle") add("ok", `HP ${s.health?.value}/${s.health?.max}${s.speed ? `, speed ${s.speed}` : ""}.`);
  const items = [...(actor.items?.values?.() ?? [])]
    .map((item) => ({ item, ...analyzeItem(item) }))
    .filter((r) => r.status !== "na");
  return { status: worst([...notes.map((n) => n.status), ...items.map((i) => i.status)]), notes, items };
}
