const foundryGlobals = Object.fromEntries(
  ["game", "foundry", "ui", "canvas", "Hooks", "CONFIG", "ChatMessage", "Roll", "fromUuid", "fromUuidSync", "Actor", "Item", "TextEditor", "CONST", "document", "window", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "Promise", "HTMLElement", "structuredClone"].map((g) => [g, "readonly"]),
);
const nodeGlobals = Object.fromEntries(["process", "URL", "globalThis", "console", "setTimeout", "clearTimeout"].map((g) => [g, "readonly"]));

export default [
  { ignores: ["node_modules/**", "packs/**"] },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: foundryGlobals },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }], "no-undef": "error" },
  },
  {
    files: ["tools/**/*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...foundryGlobals, ...nodeGlobals } },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }], "no-undef": "error" },
  },
];
