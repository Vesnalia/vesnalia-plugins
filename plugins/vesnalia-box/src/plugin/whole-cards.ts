import { wholeCardsAnywhere } from "../core/document.ts";
import type { AliaBox } from "./setup.ts";

export function wholeCardsOn(app: Pick<AliaBox, "configuration">): boolean {
  return wholeCardsAnywhere(app.configuration.document);
}
