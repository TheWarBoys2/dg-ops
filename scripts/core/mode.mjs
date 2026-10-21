/**
 * Roll visibility. The chat box's roll-mode selector (Public / Private GM / Blind GM / Self) decides
 * who sees a roll the module makes, the same as for the system's own rolls.
 */
export const MODE_LABEL = { public: "Public", gm: "Private: Handler", blind: "Blind: Handler only", self: "Self" };

export function currentMode() {
  for (const key of ["messageMode", "rollMode"]) {
    try {
      const v = game.settings.get("core", key);
      if (v) return normMode(v);
    } catch {
      /* not registered in this version */
    }
  }
  return "public";
}

export function normMode(m) {
  const s = String(m ?? "").toLowerCase();
  if (/blind/.test(s)) return "blind";
  if (/self/.test(s)) return "self";
  if (/gm|private/.test(s)) return "gm";
  return "public";
}

function gmIds() {
  try {
    return ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  } catch {
    return game.users.filter((u) => u.isGM).map((u) => u.id);
  }
}

/** Whisper list and blind flag for a mode. */
export function modeRecipients(mode = currentMode()) {
  const m = normMode(mode);
  if (m === "gm") return { whisper: [...new Set([...gmIds(), game.user.id])], blind: false, mode: m };
  if (m === "blind") return { whisper: gmIds(), blind: true, mode: m };
  if (m === "self") return { whisper: [game.user.id], blind: false, mode: m };
  return { whisper: null, blind: false, mode: m };
}

/** How a posted message is visible, for the badge on cards. */
export function visibilityOf(message) {
  const w = message.whisper ?? [];
  if (message.blind) return { kind: "blind", text: "Blind", tip: "Hidden from the roller; only the Handler sees the result." };
  if (!w.length) return { kind: "public", text: "Public", tip: "Everyone sees this." };
  const users = w.map((id) => game.users.get(id)).filter(Boolean);
  const authorId = message.author?.id ?? message.author;
  if (users.length === 1 && users[0].id === authorId) return { kind: "self", text: "Self", tip: "Only the roller sees this." };
  const nonGM = users.filter((u) => !u.isGM);
  if (!nonGM.length) return { kind: "gm", text: "Handler only", tip: "Whispered to the Handler." };
  return { kind: "private", text: `Private: ${nonGM.map((u) => u.name).join(", ")}`, tip: `Seen by ${users.map((u) => u.name).join(", ")}.` };
}
