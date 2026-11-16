import { useAliaNavigate } from "@vesnalia/plugin-sdk/app";
import { STELOW_PANEL_ID, inboxAskSubPath, inboxCardSubPath } from "../panel/stelow-route.mjs";

type AliaNavigate = ReturnType<typeof useAliaNavigate>;

export function goToInboxCard(navigate: AliaNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxCardSubPath(cardId, eventId) });
}

/** The narrow door: the ask and its evidence, without the card's other sections. */
export function goToInboxAsk(navigate: AliaNavigate, cardId: string, eventId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: inboxAskSubPath(cardId, eventId) });
}

/**
 * Open a card NAMED by another card's notification — the one holding a file.
 *
 * Deliberately without an event id: the reader wants the holder card, not this
 * card's inbox row. Landing on the blocked card again, with its banner focused,
 * would answer a question nobody asked.
 */
export function goToHolderCard(navigate: AliaNavigate, holderCardId: string): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: `build/card/${holderCardId}` });
}
