/**
 * Pursuit as a series of opposed tests (pp.45–46).
 *
 * State: { lead: number (positive = pursuer ahead, negative = quarry ahead), required, round, log[], edge:{pursuer,quarry}, over, winner }
 * Each exchange produces "wins" for one side; wins cancel. A critical success counts as two wins;
 * a fumble counts as two failures (the other side gains two). If both fail, the lowest failure wins.
 */
import { resolveOpposed } from "./dice.mjs";

export function newChase({ required = 1 } = {}) {
  return { lead: 0, required, round: 0, log: [], edge: { pursuer: 0, quarry: 0 }, over: false, winner: null };
}

/**
 * @param {object} state
 * @param {object} p
 * @param {{success,critical,fumble,total}} p.pursuer  outcome
 * @param {{success,critical,fumble,total}} p.quarry   outcome
 * @param {{pursuer?:boolean, quarry?:boolean}} [p.seekingEdge]  side rolled a skill to gain an edge
 * @param {{pursuer?:boolean, quarry?:boolean}} [p.attacked]     driver/runner attacked instead → other side auto-wins
 */
export function chaseExchange(state, { pursuer, quarry, seekingEdge = {}, attacked = {} }) {
  const s = structuredClone(state);
  if (s.over) return s;
  s.round += 1;
  const nextEdge = { pursuer: 0, quarry: 0 };
  let winner;
  if (attacked.pursuer && !attacked.quarry) winner = "quarry";
  else if (attacked.quarry && !attacked.pursuer) winner = "pursuer";
  else if (!pursuer.success && !quarry.success && pursuer.fumble !== quarry.fumble) {
    winner = pursuer.fumble ? "quarry" : "pursuer";
  } else {
    const r = resolveOpposed(pursuer, quarry, { bothFail: "lower" });
    winner = r === "a" ? "pursuer" : r === "b" ? "quarry" : null;
  }
  let wins = 0;
  if (winner) {
    const w = winner === "pursuer" ? pursuer : quarry;
    const l = winner === "pursuer" ? quarry : pursuer;
    wins = w?.success && w?.critical ? 2 : 1;
    if (l?.fumble) wins = Math.max(wins, 2);
  }
  let note = "";
  if (winner && seekingEdge[winner]) {
    const w = winner === "pursuer" ? pursuer : quarry;
    nextEdge[winner] = w.critical ? 40 : 20;
    note = `${winner} gains an edge (+${nextEdge[winner]}% next roll)`;
    wins = 0;
  }
  if (winner === "pursuer") s.lead += wins;
  else if (winner === "quarry") s.lead -= wins;
  s.edge = nextEdge;
  if (s.lead >= s.required) {
    s.over = true;
    s.winner = "pursuer";
  } else if (-s.lead >= s.required) {
    s.over = true;
    s.winner = "quarry";
  }
  s.log.push({ round: s.round, winner, wins, note, pursuer: pursuer?.total, quarry: quarry?.total });
  return s;
}
