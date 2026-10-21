/**
 * Minimal ApplicationV2 base rendering plain HTML strings (no template files).
 */
import { MODULE_ID } from "../core/constants.mjs";
import { readForm } from "../core/ui.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class DGOpsApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "dgops-app"],
    window: { resizable: true },
    position: { width: 640, height: "auto" },
  };

  /** Subclasses return an HTML string. */
  async renderBody() {
    return "";
  }

  /** Right-hand code on the classification line, or null for no line. */
  static BANNER = null;

  async _renderHTML() {
    const body = await this.renderBody();
    const code = this.constructor.BANNER;
    if (!code) return body;
    let on = true;
    try {
      on = game.settings.get(MODULE_ID, "caseFile");
    } catch {
      /* settings not ready */
    }
    if (!on) return body;
    return `<div class="dgops-banner" aria-hidden="true"><span>Top secret // Special access required — Delta Green</span><span>${code}</span></div>${body}`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  formData() {
    return readForm(this.element);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("[data-dgops-app]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        const fn = this[`on_${el.dataset.dgopsApp}`];
        if (fn) fn.call(this, el.dataset, ev);
      });
    });
    this.element.querySelectorAll("[data-dgops-change]").forEach((el) => {
      el.addEventListener("change", (ev) => {
        const fn = this[`change_${el.dataset.dgopsChange}`];
        if (fn) fn.call(this, el, ev);
      });
    });
  }
}

export function btn(action, label, data = {}, cls = "") {
  const attrs = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${foundry.utils.escapeHTML(String(v))}"`)
    .join("");
  return `<button type="button" class="dgops-btn ${cls}" data-dgops-app="${action}"${attrs}>${label}</button>`;
}
