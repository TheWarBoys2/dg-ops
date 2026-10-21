/**
 * Impossible Landscapes campaign features. Loaded only when the world setting `ilCampaign` is on:
 * main.mjs calls init() during Foundry's init hook and adds api() as `api.il` once ready.
 * Nothing in this folder registers anything until init() runs.
 */
import { MODULE_ID } from "../../core/constants.mjs";
import { extendConsole } from "../../apps/console.mjs";
import { activeAgents } from "../../core/team.mjs";
import { selectedActors } from "../../features/qol.mjs";
import { OPERATIONS, TOMES, GIFTS, INSIGHTS, BAND_LABELS } from "./rules.mjs";
import * as state from "./state.mjs";
import * as corruption from "./corruption.mjs";
import * as gifts from "./gifts.mjs";
import * as events from "./events.mjs";
import * as night from "./nightworld.mjs";
import { addSanPreCheck, onSanResult } from "../../core/extensions.mjs";

let ready = false;

/** Selected tokens, else the Agents picked on the Console roster, else the team. */
const who = () => {
  const sel = selectedActors();
  return sel.length ? sel : corruption.present();
};

export function init() {
  if (ready) return;
  ready = true;
  game.settings.register(MODULE_ID, "ilOperation", {
    name: "Impossible Landscapes: current part",
    hint: "Sets how much Corruption an Agent can gain or lose in one session: 3, 4, 5 or 6 (p.18).",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(OPERATIONS).map(([k, v]) => [k, `${v.label} (cap ${v.cap})`])),
    default: "night-floors",
  });
  game.settings.register(MODULE_ID, "ilNightWorldHide", {
    name: "Impossible Landscapes: Night World SAN tests show players only pass or fail",
    hint: "While a SAN loss is being held for the Night World, players don't see the loss in play or the loss dice, whatever the general Sanity setting says.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "ilSession", { scope: "world", config: false, type: Number, default: 1 });
  state.registerStateHandlers();
  gifts.registerGiftActions();
  events.registerEvents();
  night.registerNightWorld();
  addSanPreCheck(night.sanPreCheck);
  onSanResult(night.sanResult);
  Hooks.once("ready", () => document.body.classList.add("dgops-il-on"));

  const rerender = (app) => setTimeout(() => app.rendered && app.render(), 200);
  extendConsole({
    card: (a) => corruption.consoleCard(a) + night.consoleStrip(a),
    tiles: {
      "Impossible Landscapes": [
        ["ilStart", "Starting Corruption", "fas fa-eye", "Count each Agent's starting Corruption and confirm it (p.17).", null],
        ["ilSession", "New session", "fas fa-calendar-plus", "Reset this session's Corruption caps (p.18).", null],
        ["ilPick", "Who does it pick?", "fas fa-hand-pointer", "Highest Corruption, ties to the lowest SAN (p.17).", null],
        ["ilThreshold", "Threshold", "fas fa-door-open", "Who can see a place with a Corruption threshold (p.18).", null],
        ["ilAdjust", "Corruption…", "fas fa-sliders", "Change Corruption for the picked Agents.", "agents"],
        ["ilGifts", "Gifts & Insights", "fas fa-gift", "Roll or pick one of each per Agent (p.259).", null],
        ["ilSign", "Yellow Sign", "fas fa-signature", "SAN 0/1D4 helplessness, once per Agent (p.347).", "agents"],
        ["ilTome", "Read a tome", "fas fa-book-skull", "Study time, SAN, Unnatural, Art and Corruption in one step (pp.348–350).", "agents"],
        ["ilInterference", "Interference", "fas fa-bolt", "The operator left the circle: misfortune in 4D6 hours (p.351).", "agents"],
        ["ilBottle", "Soul Bottle search", "fas fa-wine-bottle", "1D100 + Corruption every 8 hours in the labyrinth (p.344).", "agents"],
        ["ilNight", "Night World", "fas fa-moon", "SAN loss held while they're in the Night World: see it, change it, apply it.", "agents"],
        ["ilPorcelain", "Metal & porcelain", "fas fa-gear", "Toggle on NPC tokens: odd damage rolls do only 1 (pp.338, 341).", "tokens"],
      ],
    },
    actions: {
      async ilPlus(ds) {
        await state.adjustCorruption(await fromUuid(ds.uuid), 1, { correction: true, quiet: true, reason: "Correction" });
        rerender(this);
      },
      async ilMinus(ds) {
        await state.adjustCorruption(await fromUuid(ds.uuid), -1, { correction: true, quiet: true, reason: "Correction" });
        rerender(this);
      },
      async ilInvestigate(ds) {
        await state.adjustCorruption(await fromUuid(ds.uuid), 1, { quiet: true, reason: "Investigated" });
        rerender(this);
      },
      async ilDisengage(ds) {
        await state.adjustCorruption(await fromUuid(ds.uuid), -1, { quiet: true, reason: "Disengaged" });
        rerender(this);
      },
      async ilStart() {
        await corruption.startingDialog();
        rerender(this);
      },
      async ilSession() {
        await corruption.newSession();
        rerender(this);
      },
      async ilPick() {
        await corruption.whoDoesItPick();
      },
      async ilThreshold() {
        await corruption.thresholdDialog();
        rerender(this);
      },
      async ilAdjust() {
        const a = this.need();
        if (a.length) await corruption.adjustDialog(a);
        rerender(this);
      },
      async ilGifts() {
        await gifts.giftsDialog(corruption.present(), { team: activeAgents() });
        rerender(this);
      },
      async ilSign() {
        const a = this.need();
        if (a.length) await events.yellowSign(a);
      },
      async ilTome() {
        const a = this.need();
        for (const x of a) await events.readTome(x);
      },
      async ilInterference() {
        const a = this.need();
        for (const x of a) await events.interference(x);
      },
      async ilBottle() {
        const a = this.need();
        if (a.length) await events.bottleSearchDialog(a);
      },
      async ilNight() {
        const a = this.need();
        if (a.length) await night.nightWorldDialog(a);
        rerender(this);
      },
      async ilNightPlus(ds) {
        await night.holdLoss(await fromUuid(ds.uuid), 1, { source: "Handler's correction" });
        rerender(this);
      },
      async ilNightMinus(ds) {
        await night.holdLoss(await fromUuid(ds.uuid), -1, { source: "Handler's correction" });
        rerender(this);
      },
      async ilNightApply(ds) {
        await night.applyHeld(await fromUuid(ds.uuid));
        rerender(this);
      },
      async ilPorcelain() {
        const t = this.need("tokens").map((x) => x.actor).filter(Boolean);
        if (t.length) await events.toggleMetalPorcelain(t);
      },
    },
  });
}

/** The `il` part of the module API (game.modules.get("dg-ops").api.il). */
export function api() {
  return {
    corruption: state.corruptionOf,
    adjust: (actor, delta, opts) => state.adjustCorruption(actor, delta, opts),
    set: state.setCorruption,
    flags: state.il,
    session: state.currentSession,
    cap: state.cap,
    startingDialog: corruption.startingDialog,
    newSession: corruption.newSession,
    whoDoesItPick: corruption.whoDoesItPick,
    thresholdDialog: corruption.thresholdDialog,
    threshold: corruption.threshold,
    adjustDialog: corruption.adjustDialog,
    giftsDialog: gifts.giftsDialog,
    assignGifts: gifts.assignGifts,
    revealGift: gifts.revealGift,
    yellowSign: events.yellowSign,
    interference: events.interference,
    misfortune: events.misfortune,
    readTome: events.readTome,
    bottleSearch: events.bottleSearchDialog,
    bottleSearchRoll: events.bottleSearchRoll,
    openBottle: events.openBottle,
    destroyBottle: events.destroyBottle,
    toggleMetalPorcelain: events.toggleMetalPorcelain,
    nightWorld: {
      of: night.nightWorldOf,
      hold: night.holdLoss,
      apply: night.applyHeld,
      setInside: night.setInside,
      dialog: night.nightWorldDialog,
      report: night.nightWorldReport,
      TAG: night.TAG,
    },
    who,
    TOMES,
    GIFTS,
    INSIGHTS,
    BAND_LABELS,
    OPERATIONS,
  };
}
