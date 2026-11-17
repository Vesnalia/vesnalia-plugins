// Запись data/sources.json в нашем виде: название и описание уже приведены к VesnALIA,
// версия без префикса тега, без адресов исходников и чужих id.
import { brandProse } from "./adapt.mjs";
import { DISPLAY_NAMES, fixProse } from "./renames.mjs";

export function cleanSource(entry) {
  const out = { ...entry };
  delete out.originalId;
  delete out.originalRepo;
  delete out.subdir;
  if (typeof out.icon !== "string") delete out.icon;
  out.displayName = DISPLAY_NAMES[out.id] ?? fixProse(brandProse(out.displayName));
  out.description = fixProse(brandProse(out.description));
  out.ref = String(out.ref).split("/").at(-1);
  if (Array.isArray(out.omittedMedia)) out.omittedMedia = out.omittedMedia.length;
  if (Array.isArray(out.tags)) out.tags = out.tags.map((t) => t.replace(/^bb-/, ""));
  return out;
}
