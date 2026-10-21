/**
 * Dice timing. Results, chat cards and sheet changes must never appear before the dice land.
 *  - rollFormula(): evaluate, then show the dice (Dice So Nice) and wait for them to settle.
 *  - waitForMessageDice(): wait for the dice of a chat message the system posted.
 * Without Dice So Nice there is no animation, so both return straight away.
 */
import { warn } from "./constants.mjs";
import { modeRecipients } from "./mode.mjs";

export function dsnActive() {
  return !!(game.modules?.get?.("dice-so-nice")?.active && typeof game.dice3d?.showForRoll === "function");
}

function hasDice(roll) {
  return Array.isArray(roll?.dice) ? roll.dice.length > 0 : true;
}

/** Show an evaluated roll in 3D to everyone (or just `whisper`) and wait until it lands. */
export async function showRoll(roll, { whisper = null, blind = false, speaker = null } = {}) {
  if (!roll || roll._dgShown || !dsnActive() || !hasDice(roll)) {
    if (roll) roll._dgShown = true;
    return;
  }
  roll._dgShown = true;
  try {
    await game.dice3d.showForRoll(roll, game.user, true, whisper?.length ? whisper : null, blind, null, speaker ?? undefined);
  } catch (e) {
    warn("Dice So Nice animation failed", e);
  }
}

/** Wait for the 3D dice tied to a chat message (e.g. a system roll card) to land. */
export async function waitForMessageDice(messageId) {
  if (!messageId || !dsnActive() || typeof game.dice3d.waitFor3DAnimationByMessageID !== "function") return;
  try {
    await game.dice3d.waitFor3DAnimationByMessageID(messageId);
  } catch (e) {
    warn("Dice So Nice wait failed", e);
  }
}

/**
 * Evaluate a formula. By default its dice are shown and awaited before this returns,
 * so whatever the caller does next (apply damage, post a card) happens after they land.
 */
export async function rollFormula(formula, { data = {}, show = true, whisper, blind } = {}) {
  const f = String(formula ?? "0").trim() || "0";
  const roll = await new Roll(f, data).evaluate();
  // Unless the caller decided, the chat box's roll mode decides who sees the dice.
  if (whisper === undefined) ({ whisper, blind } = modeRecipients());
  if (show) await showRoll(roll, { whisper, blind: !!blind });
  return roll;
}
