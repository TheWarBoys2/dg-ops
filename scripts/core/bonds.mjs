/**
 * Bond helpers (pp.36–37). Bonds are system "bond" items with system.score.
 * A Bond is treated as a Delta Green Bond when flagged, or its name/relationship mentions Delta Green.
 */
import { MODULE_ID } from "./constants.mjs";
import { statValue, evalFormula } from "./system.mjs";
import { update, createEmbedded } from "./ops.mjs";
import { askOwner, esc } from "./ui.mjs";
import { postCard, button } from "./chat.mjs";

export function isDGBond(bond) {
  if (bond.getFlag?.(MODULE_ID, "dgBond")) return true;
  return /delta\s*green/i.test(`${bond.system?.relationship ?? ""} ${bond.name}`);
}

export function isBroken(bond) {
  return !!bond.getFlag?.(MODULE_ID, "broken") || (bond.system?.score ?? 0) <= 0;
}

export function bonds(actor, { nonDG = false, includeBroken = false } = {}) {
  return (actor?.itemTypes?.bond ?? []).filter((b) => (includeBroken || !isBroken(b)) && (!nonDG || !isDGBond(b)));
}

export function maxBond(actor) {
  return statValue(actor, "cha");
}

/**
 * Ask the actor's owner to pick a Bond.
 * @returns {Promise<Item|null>}
 */
export async function chooseBond(actor, { nonDG = false, title = "Choose a Bond", reason = "", exclude = [] } = {}) {
  const list = bonds(actor, { nonDG }).filter((b) => !exclude.includes(b.id));
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const opts = list.map((b, i) => `<label class="dgops-radio"><input type="radio" name="bond" value="${b.id}" ${i === 0 ? "checked" : ""}> ${esc(b.name)} <em>(${b.system.score})</em></label>`).join("");
  const r = await askOwner(actor, { title, content: `${reason ? `<p>${esc(reason)}</p>` : ""}${opts}`, buttons: [{ action: "ok", label: "Choose", default: true }] });
  const id = r?.data?.bond ?? list[0].id;
  return actor.items.get(id) ?? list[0];
}

/**
 * Change a Bond's score. Negative changes mark the Bond damaged until the next Home scene.
 * Reaching 0 breaks it (kept on the sheet, flagged) and offers the 0/1D4 helplessness SAN test.
 * @returns {Promise<{before:number, after:number, broken:boolean}>}
 */
export async function adjustBond(actor, bond, delta, { reason = "", quiet = false } = {}) {
  if (!bond) return null;
  const before = bond.system.score ?? 0;
  const max = maxBond(actor);
  const after = Math.max(0, Math.min(max, before + delta));
  const data = { "system.score": after };
  if (after < before) data["system.hasBeenDamagedSinceLastHomeScene"] = true;
  const broken = after <= 0 && before > 0;
  if (broken) data[`flags.${MODULE_ID}.broken`] = true;
  await update(bond, data);
  if (broken && !quiet) {
    await postCard({
      actor,
      title: `Bond broken: ${esc(bond.name)}`,
      body: `<p>${esc(actor.name)}'s Bond with ${esc(bond.name)} is damaged beyond repair${reason ? ` (${esc(reason)})` : ""}. Cross it off — but don't erase it.</p>
        ${button("sanPreset", "SAN test 0/1D4 (Bond reduced to 0)", { args: { actorUuid: actor.uuid, preset: "bondZero" }, owner: actor.uuid, once: "bondzero" })}`,
    });
  }
  return { before, after, broken };
}

export async function adjustBondByFormula(actor, bond, formula, opts = {}) {
  const n = typeof formula === "number" ? formula : (await evalFormula(String(formula))).total;
  const r = await adjustBond(actor, bond, n, opts);
  return { ...r, amount: n };
}

export async function createBond(actor, { name, score, dg = false, relationship = "" }) {
  const ids = await createEmbedded(actor, "Item", [
    {
      type: "bond",
      name,
      system: { score, relationship: relationship || (dg ? "Delta Green" : "") },
      flags: { [MODULE_ID]: { dgBond: dg } },
    },
  ]);
  return actor.items.get(ids?.[0]);
}
