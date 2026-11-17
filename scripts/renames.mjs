// Наши id и названия плагинов там, где исходные содержат bb.
// id = имя папки в plugins/ = slug в catalog.json = id плагина в VesnALIA
// (имя пакета alia-plugin-<id>). Смена id - это новый плагин для уже
// установленных копий: их надо переустановить.

/** исходный id каталога -> наш id */
export const ID_RENAMES = {
  "bb-agent-toolbox": "vesnalia-agent-toolbox",
  "bb-antigravity-usage": "antigravity-usage",
  "bb-autoresearch": "autoresearch",
  "bb-better-latex": "better-latex",
  "bb-box": "vesnalia-box",
  "bb-copilot-usage": "copilot-usage",
  "bb-github-pr-dashboard": "github-pr-dashboard",
  "bb-kujo": "kujo",
  "bb-live": "vesnalia-live",
  "bb-office": "vesnalia-office",
  "bb-recap": "recap",
  "bb-rpiv-todo-renderer": "rpiv-todo-renderer",
  "bb-sidebar": "vesnalia-sidebar",
  bbbbs: "vesnalia-bbs",
  bbium: "alium",
  "matt-pocock-skills-for-bb": "matt-pocock-skills-for-vesnalia",
  "pstack-for-bb": "pstack-for-vesnalia",
  // не перенесён, но числится в data/skipped.json
  "bb-ui-reference": "ui-reference",
};

export const ourId = (id) => ID_RENAMES[id] ?? id;

/** наш id -> название вместо того, что даёт brandProse */
export const DISPLAY_NAMES = {
  alium: "Alium",
  dashboard: "VesnALIA Desk",
  "vesnalia-bbs": "VesnALIA BBS",
};

/** правки видимого текста, которые brandProse не покрывает */
const PROSE_FIXES = [
  [/ through your getbb\.app address/g, " through remote access"],
  [/\bBbium\b/g, "Alium"],
  [/\bBBDesk\b/g, "VesnALIA Desk"],
  [/\baliaBBS\b/g, "VesnALIA BBS"],
];

export function fixProse(text) {
  return PROSE_FIXES.reduce((t, [re, to]) => t.replace(re, to), String(text));
}
