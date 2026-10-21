/**
 * Sleep, rest and addiction (pp.47, 70) layered over the system's own Rest button.
 */
import { MODULE_ID } from "../core/constants.mjs";
import { setting } from "../core/settings.mjs";
import { systemTest, evalFormula, isAgent } from "../core/system.mjs";
import { update, createEffect, effectsWithFlag, deleteEmbedded } from "../core/ops.mjs";
import { postCard, registerAction } from "../core/chat.mjs";
import { prompt, esc, confirm } from "../core/ui.mjs";
import { disordersOf, disorderDef } from "./sanity.mjs";

const DAY = 86400;

function hasDisorder(actor, id) {
  return disordersOf(actor, { activeOnly: true }).some((m) => disorderDef(m)?.id === id);
}

/**
 * Called before the system's rest. Returns { proceed, blockWp, keepExhausted }.
 */
export async function beforeRest(actor) {
  if (!setting("sleepRules") || !isAgent(actor)) return { proceed: true, startTime: game.time.worldTime };
  const now = game.time.worldTime;
  const last = actor.getFlag(MODULE_ID, "lastSleep");
  if (last != null && now - last < DAY - 60) {
    const ok = await confirm("Rest", `<p>${esc(actor.name)} already had a full night's sleep ${Math.round((now - last) / 3600)} game hours ago. WP is regained only once per 24 hours (p.47). Rest anyway?</p>`);
    if (!ok) return { proceed: false };
  }
  const noWpUntil = actor.getFlag(MODULE_ID, "noWpUntil") ?? 0;
  let blockWp = noWpUntil > now;
  let keepExhausted = false;
  const needsTest = actor.getFlag(MODULE_ID, "sleepTest") || hasDisorder(actor, "sleepDisorder");
  if (needsTest) {
    const r = await prompt({
      title: `Sleep — ${actor.name}`,
      content: `<p>${hasDisorder(actor, "sleepDisorder") ? "Sleep disorder" : "First sleep since temporary insanity or a new disorder"}: roll SAN to rest. Failure: wakes in terror, no WP for 24 hours (p.47).</p>
        <label class="dgops-radio"><input type="checkbox" name="sedative"> Drink heavily / take sleeping pills (+20%; −20% to all tests tomorrow)</label>`,
      buttons: [{ action: "ok", label: "Roll SAN", default: true }],
    });
    if (!r) return { proceed: false };
    const mod = r.data.sedative ? 20 : 0;
    const { outcome } = await systemTest(actor, { type: "sanity", key: "sanity", modifier: mod, context: { sleep: true } });
    if (r.data.sedative) {
      await createEffect(actor, {
        name: "Hungover (sedatives)",
        img: "icons/svg/poison.svg",
        changes: ["system.rollTarget.allSkills", "system.rollTarget.statistics"].map((key) => ({ key, type: "add", value: "-20", phase: "final" })),
        flags: { hangover: now },
      });
    }
    if (!outcome.success) {
      blockWp = true;
      keepExhausted = true;
      await update(actor, { [`flags.${MODULE_ID}.noWpUntil`]: now + DAY });
      await postCard({ actor, title: "No rest", body: `<p>${esc(actor.name)} wakes repeatedly in terror and regains no WP for 24 hours.</p>` });
    } else await update(actor, { [`flags.${MODULE_ID}.-=sleepTest`]: null });
  }
  return { proceed: true, blockWp, keepExhausted, startTime: now };
}

export async function afterRest(actor, before, pre) {
  const data = { [`flags.${MODULE_ID}.lastSleep`]: game.time.worldTime };
  if (pre.blockWp) data["system.wp.value"] = before.wp;
  if (pre.keepExhausted && before.exhausted) data["system.physical.exhausted"] = true;
  await update(actor, data);
  if (!pre.blockWp) {
    // Yesterday's sedative hangover clears with a full night's rest; tonight's lasts until the next one.
    const old = effectsWithFlag(actor, "hangover").filter((e) => Number(e.getFlag(MODULE_ID, "hangover")) < (pre.startTime ?? game.time.worldTime));
    if (old.length) await deleteEmbedded(actor, "ActiveEffect", old.map((e) => e.id));
  }
}

/** Wrap the agent sheet's Rest action. */
export function patchRest() {
  const entries = Object.values(CONFIG.Actor.sheetClasses?.agent ?? {});
  const cls = entries.find((e) => e.cls?.name === "DGAgentSheet")?.cls ?? entries[0]?.cls;
  const actions = cls?.DEFAULT_OPTIONS?.actions;
  if (!actions?.restAgent) return false;
  const orig = actions.restAgent;
  actions.restAgent = async function (event, target) {
    const actor = this.actor;
    const pre = await beforeRest(actor);
    if (!pre.proceed) return;
    const before = { wp: actor.system.wp.value, exhausted: !!actor._source.system.physical.exhausted };
    await orig.call(this, event, target);
    await afterRest(actor, before, pre);
  };
  return true;
}

/* ---------------- Addiction (p.70) ---------------- */

export async function addictionCheck(actor) {
  const addictions = disordersOf(actor, { activeOnly: true }).filter((m) => disorderDef(m)?.addiction);
  if (!addictions.length) return;
  const lastFed = actor.getFlag(MODULE_ID, "lastFed") ?? actor.getFlag(MODULE_ID, "addictionSince");
  const now = game.time.worldTime;
  if (lastFed == null) {
    await update(actor, { [`flags.${MODULE_ID}.addictionSince`]: now });
    return;
  }
  if (now - lastFed < DAY) return;
  const r = await evalFormula("1d6");
  const after = Math.max(0, actor.system.wp.value - r.total);
  await update(actor, { "system.wp.value": after, [`flags.${MODULE_ID}.noWpUntil`]: now + DAY, [`flags.${MODULE_ID}.addictionSince`]: now });
  await postCard({
    actor,
    title: `${esc(addictions[0].name)}: withdrawal`,
    body: `<p>Another 24 hours without feeding it: −${r.total} WP (now ${after}), and no WP recovery.${after <= 2 ? " <b>At 2 WP or less the Agent does irrational, self-destructive things to feed it.</b>" : ""}</p>`,
    rolls: [r],
  });
}

export async function feedAddiction(actor) {
  await update(actor, { [`flags.${MODULE_ID}.lastFed`]: game.time.worldTime, [`flags.${MODULE_ID}.-=addictionSince`]: null, [`flags.${MODULE_ID}.-=noWpUntil`]: null });
  for (const m of disordersOf(actor).filter((d) => disorderDef(d)?.addiction && d.system.acuteEpisode)) await update(m, { "system.acuteEpisode": false });
  await createEffect(actor, {
    name: "Feeding the addiction",
    img: "icons/svg/tankard.svg",
    changes: ["system.rollTarget.allSkills", "system.rollTarget.statistics"].map((key) => ({ key, type: "add", value: "-20", phase: "final" })),
    flags: { intox: true },
  });
  const { schedule } = await import("../core/scheduler.mjs");
  await schedule({ type: "removeEffectFlag", delay: 3 * 3600, actorUuid: actor.uuid, data: { flag: "intox" }, label: `${actor.name} sobers up` });
  await postCard({ actor, title: "Feeding the addiction", body: `<p>${esc(actor.name)} gets their fix: −20% to skills and stats for a few hours.</p>` });
}

registerAction("feedAddiction", async ({ args }) => {
  await feedAddiction(await fromUuid(args.actorUuid));
  return "Fed";
});

export async function motivationWp(actor) {
  const after = Math.min(actor.system.wp.max, actor.system.wp.value + 1);
  await update(actor, { "system.wp.value": after });
  await postCard({ actor, title: "Personal motivation", body: `<p>${esc(actor.name)} plays up a motivation compellingly: +1 WP (now ${after}).</p>` });
}
