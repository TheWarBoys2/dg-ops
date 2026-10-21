/**
 * Builds the macro compendiums.
 *
 * packs/_source/<pack>/ holds every macro as JSON (one folder per compendium folder). The
 * Impossible Landscapes macros are defined below and written into their own folder of the Handler
 * pack, then both packs are compiled to LevelDB with the Foundry CLI.
 *
 *   node tools/build-packs.mjs            write the IL sources and compile
 *   node tools/build-packs.mjs --check    compile the sources as they are, without rewriting the IL folder
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "packs/_source");
const OUT = join(ROOT, "packs");

/** Stable 16-character ids, so rebuilding never changes a macro's uuid. */
const id = (s) => {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const h = createHash("sha256").update(`dg-ops:${s}`).digest();
  return Array.from({ length: 16 }, (_, i) => abc[h[i] % abc.length]).join("");
};

const PREAMBLE = `const ops = game.modules.get("dg-ops")?.api;
if (!ops) return ui.notifications.warn("Delta Green: Ops Automation isn't active.");
if (!game.user.isGM) return ui.notifications.warn("That one is for the Handler.");
const il = ops.il;
if (!il) return ui.notifications.info("Impossible Landscapes campaign features are off. Switch them on in Configure Settings → Delta Green: Ops Automation (needs a reload).");
`;

const NEEDS_SELECTION = `const sel = ops.selected();
if (!sel.length) return ui.notifications.warn("Select the tokens first.");
`;

/** [name, icon, description, body] */
const IL_MACROS = [
  ["Corruption: adjust selected", "icons/svg/eye.svg", "Change Corruption for the selected Agents (or everyone on the scene). Handler only; players never see it.", `await il.adjustDialog(il.who());`],
  ["Corruption: starting values", "icons/svg/book.svg", "Count each Agent's starting Corruption (adaptation checks and Art skills at 20%+) and confirm it once (p.17).", `await il.startingDialog(ops.team());`],
  ["Corruption: new session", "icons/svg/clockwork.svg", "Start a new game session: each Agent's per-session Corruption cap resets (p.18).", `await il.newSession();`],
  ["Who does it pick?", "icons/svg/target.svg", "The Agent with the highest Corruption; ties go to the lowest SAN (p.17).", `await il.whoDoesItPick();`],
  ["Corruption threshold", "icons/svg/door-exit.svg", "Who can see a place with a Corruption threshold, and who gets dragged up to it (p.18).", `await il.thresholdDialog();`],
  ["Gifts and Insights", "icons/svg/daze.svg", "Roll 1D100+Corruption or pick a Gift and an Insight for each Agent, none repeated (p.259).", `await il.giftsDialog(il.who(), { team: ops.team() });`],
  ["See the Yellow Sign", "icons/svg/hazard.svg", "SAN 0/1D4 helplessness for the selected Agents, once each; a loss adds Corruption and the urge to share it (p.347).", `await il.yellowSign(il.who());`],
  ["Read a tome", "icons/svg/book.svg", "Study time, SAN, Unnatural, Art and Corruption in one step for the selected Agent (pp.348–350).", `${NEEDS_SELECTION}for (const a of sel) await il.readTome(a);`],
  ["Interference", "icons/svg/lightning.svg", "The selected operator left the circle: misfortune in 4D6 hours of game time (p.351).", `${NEEDS_SELECTION}for (const a of sel) await il.interference(a);`],
  ["Soul Bottle search", "icons/svg/acid.svg", "1D100 + Corruption after each 8 hours in the Whisper Labyrinth, now or on the game clock (p.344).", `${NEEDS_SELECTION}await il.bottleSearch(sel);`],
  ["Metal and porcelain", "icons/svg/mechanical-arm.svg", "Toggle on the selected NPCs: an odd damage or Lethality roll inflicts only 1 (pp.338, 341).", `${NEEDS_SELECTION}await il.toggleMetalPorcelain(sel);`],
];

function writeIl() {
  const pack = join(SRC, "handler-macros");
  for (const d of readdirSync(pack)) if (d.startsWith("Impossible_Landscapes_")) rmSync(join(pack, d), { recursive: true });
  const folderId = id("folder:Impossible Landscapes");
  const dir = join(pack, `Impossible_Landscapes_${folderId}`);
  mkdirSync(dir, { recursive: true });
  const folder = { _id: folderId, name: "Impossible Landscapes", type: "Macro", folder: null, sorting: "m", sort: 900000, color: "#6b5a14", description: "Campaign features. They only work with the Impossible Landscapes setting on.", flags: {}, _key: `!folders!${folderId}` };
  writeFileSync(join(dir, "_Folder.json"), `${JSON.stringify(folder, null, 2)}\n`);
  IL_MACROS.forEach(([name, img, description, body], i) => {
    const mid = id(`macro:il:${name}`);
    const doc = { _id: mid, name, type: "script", img, command: `${PREAMBLE}${body}`, scope: "global", folder: folderId, sort: (i + 1) * 100000, ownership: { default: 0 }, flags: { "dg-ops": { description } }, author: null, _key: `!macros!${mid}` };
    writeFileSync(join(dir, `${name.replace(/[^A-Za-z0-9]/g, "_")}_${mid}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  });
}

function countMacros(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) n += countMacros(p);
    else if (e.endsWith(".json") && e !== "_Folder.json") n++;
  }
  return n;
}

if (!process.argv.includes("--check")) writeIl();
for (const p of ["handler-macros", "agent-macros"]) {
  rmSync(join(OUT, p), { recursive: true, force: true });
  await compilePack(join(SRC, p), join(OUT, p), { recursive: true, log: false });
  for (const f of ["LOCK", "LOG", "LOG.old"]) rmSync(join(OUT, p, f), { force: true });
  console.log(`${p}: ${countMacros(join(SRC, p))} macros`);
}
