import { useAliaNavigate, useRpc } from "@vesnalia/plugin-sdk/app";
import { rememberStelowReturnFocusCardId } from "../panel/stelow-focus.mjs";
import { STELOW_PANEL_ID, cardSubPath, trackRootSubPath, type StelowTrack } from "../panel/stelow-route.mjs";
import { executionRunSubPath } from "../../lib/execution-deep-link.mjs";
import type { rpcContract } from "../../server";

type AliaNavigate = ReturnType<typeof useAliaNavigate>;
type BoardResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type CardsResponse = Extract<BoardResult, { cards: unknown }>;
export type CardItem = CardsResponse["cards"][number];

export type AliaNavigateHandle = AliaNavigate;

export function goToTrack(navigate: AliaNavigate, track: StelowTrack): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(track) });
}

export function goToCard(
  navigate: AliaNavigate,
  card: Pick<CardItem, "kind">,
  cardId: string,
  eventId?: string | null,
): void {
  rememberStelowReturnFocusCardId(cardId);
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId, eventId) });
}

export function goToExecutionRun(
  navigate: AliaNavigate,
  card: Pick<CardItem, "id" | "kind">,
  run: { id: string; normalizedStatus: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled" },
): boolean {
  const subPath = executionRunSubPath({
    track: card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : "build",
    cardId: card.id,
    localRunId: run.id,
    status: run.normalizedStatus,
  });
  if (!subPath) return false;
  rememberStelowReturnFocusCardId(card.id);
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath });
  return true;
}
