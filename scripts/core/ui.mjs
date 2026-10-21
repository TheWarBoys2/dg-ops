/**
 * Dialog and HTML helpers built on DialogV2 so they work on Foundry v13/v14.
 */
import { MODULE_ID } from "./constants.mjs";
import { callUser, ownerUserFor, registerHandler } from "./socket.mjs";
import { setting } from "./settings.mjs";

export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Read every named control under root into a plain object. Numbers become numbers; checkboxes booleans. */
export function readForm(root) {
  const data = {};
  if (!root) return data;
  for (const el of root.querySelectorAll("[name]")) {
    const name = el.name;
    let v;
    if (el.type === "checkbox") {
      if (el.dataset.multi !== undefined) {
        data[name] ??= [];
        if (el.checked) data[name].push(el.value);
        continue;
      }
      v = el.checked;
    } else if (el.type === "radio") {
      if (!el.checked) continue;
      v = el.value;
    } else if (el.type === "number" || el.dataset.dtype === "Number") {
      v = el.value === "" ? null : Number(el.value);
    } else v = el.value;
    data[name] = v;
  }
  return data;
}

/**
 * Show a dialog locally.
 * @param {{title:string, content:string, buttons?:{action:string,label:string,default?:boolean,icon?:string}[], width?:number}} spec
 * @returns {Promise<{action:string, data:object}|null>}
 */
export async function prompt(spec) {
  const { DialogV2 } = foundry.applications.api;
  const buttons = (spec.buttons?.length ? spec.buttons : [{ action: "ok", label: "OK", default: true }]).map((b) => ({
    action: b.action,
    label: b.label,
    icon: b.icon,
    default: !!b.default,
    callback: (event, button, dialog) => {
      const form = button?.form ?? dialog?.element?.querySelector?.("form") ?? event?.target?.closest?.("form");
      return { action: b.action, data: readForm(form ?? dialog?.element) };
    },
  }));
  try {
    const result = await DialogV2.wait({
      window: { title: spec.title ?? "Delta Green Ops" },
      classes: [`${MODULE_ID}-dialog`, "dgops-dialog", "deltagreen", "dg-dialog-app"],
      position: { width: spec.width ?? 440 },
      content: `<div class="dgops-form dgops-panel">${spec.content ?? ""}</div>`,
      buttons,
      rejectClose: false,
    });
    return result && typeof result === "object" ? result : null;
  } catch {
    return null;
  }
}

registerHandler("prompt", (spec) => prompt(spec));

/** Ask the best owner of an actor (player first, else GM). Times out to null. */
export async function askOwner(actor, spec, { timeout } = {}) {
  const user = ownerUserFor(actor);
  if (!user) return null;
  const t = timeout ?? setting("promptTimeout") ?? 60;
  const title = user.isGM && actor ? `${spec.title ?? "Delta Green Ops"} — ${actor.name}` : spec.title;
  return callUser(user.id, "prompt", [{ ...spec, title }], { timeout: user.id === game.user.id ? 0 : t });
}

export async function confirm(title, content) {
  const r = await prompt({ title, content, buttons: [{ action: "yes", label: "Yes", default: true }, { action: "no", label: "No" }] });
  return r?.action === "yes";
}

/** Option list helper. */
export function options(entries, selected) {
  return Object.entries(entries)
    .map(([value, label]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(typeof label === "object" ? label.label : label)}</option>`)
    .join("");
}

export function field(label, inner, hint = "") {
  return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields">${inner}</div>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</div>`;
}

export function signed(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : `${v}`;
}
