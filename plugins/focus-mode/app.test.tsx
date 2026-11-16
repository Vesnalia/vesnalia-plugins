// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import appDefinition, { focusCommand } from "./app";

const route = vi.hoisted(() => ({ projectId: "project", threadId: "thread-a" }));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@get-bb/plugin-sdk/app")>()),
  useBbContext: () => route,
}));

afterEach(() => {
  cleanup();
  route.threadId = "thread-a";
});

function conversation(id: string, seq: number, role: "user" | "assistant", text: string, extra = {}) {
  return {
    id,
    kind: "conversation",
    role,
    initiator: role === "user" ? "user" : undefined,
    text,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    createdAt: seq,
    ...extra,
  };
}

function timelineFor(threadId: string, older = false) {
  return {
    rows: [
      conversation(`${threadId}-u1`, 1, "user", `Question for ${threadId}`),
      {
        id: `${threadId}-turn`,
        kind: "turn",
        status: "pending",
        sourceSeqStart: 2,
        createdAt: 2,
        children: [
          conversation(`${threadId}-a1`, 3, "assistant", "I’ll take a look."),
          { id: `${threadId}-cmd`, kind: "work", workKind: "command", sourceSeqStart: 4, command: "rm -rf build" },
        ],
      },
      conversation(`${threadId}-sys`, 5, "user", "Child finished", { initiator: "system" }),
      conversation(`${threadId}-a2`, 6, "assistant", "**Done** — all set."),
    ],
    timelinePage: older ? { olderCursor: { anchorId: "older", anchorSeq: 1 } } : { olderCursor: null },
  };
}

const threadGet = vi.fn(async ({ threadId }: { threadId: string }) => ({ id: threadId, status: "active" }));

const timeline = vi.fn(async ({ threadId, beforeAnchorId }: { threadId: string; beforeAnchorId?: string }) =>
  beforeAnchorId
    ? { rows: [conversation(`${threadId}-u0`, 0, "user", "Earliest question")], timelinePage: { olderCursor: null } }
    : timelineFor(threadId),
);

async function mount() {
  const app = await loadPluginApp(appDefinition);
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    composer: { text: "My unsent draft", scope: { kind: "thread", threadId: "thread-a" } },
    sdk: { threads: { timeline, get: threadGet } as never },
  });
  const header = renderSlot(app.threadHeaderActions[0]!, {
    threadId: "thread-a",
    projectId: "project",
    isCompactViewport: false,
  });
  return { app, overlay, header, user: userEvent.setup() };
}

function commandContext(threadId: string | null) {
  return { threadId, projectId: "project", openPanel: () => false };
}

describe("Focus mode", () => {
  it("registers only a reader, header control, and thread-scoped command", async () => {
    const { app } = await mount();
    expect(app.appOverlays).toHaveLength(1);
    expect(app.threadHeaderActions).toHaveLength(1);
    expect(app.navPanels).toHaveLength(0);
    expect(app.threadLists).toHaveLength(0);
    expect(app.composers).toHaveLength(0);
    expect(focusCommand.defaultShortcut).toBeUndefined();
    expect(focusCommand.isAvailable!(commandContext(null))).toBe(false);
    expect(focusCommand.isAvailable!(commandContext("thread-a"))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses BB's supported expand and collapse icon names", async () => {
    const { user } = await mount();
    const trigger = screen.getByRole("button", { name: "Enter focus mode" });
    expect(trigger.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Maximize2");
    await user.click(trigger);
    const exit = screen.getByRole("button", { name: /Exit focus/ });
    expect(exit.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Minimize2");
  });

  it("opens the clicked thread as a text-only transcript, with read-only SDK calls", async () => {
    const { user, overlay, header } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    expect(screen.getByRole("dialog", { name: "Focus mode" })).toBeTruthy();
    const transcript = await screen.findByTestId("bb-focus-mode-transcript");
    await waitFor(() => expect(transcript.textContent).toContain("Question for thread-a"));
    expect(transcript.querySelector("blockquote")?.textContent).toBe("Question for thread-a");
    const prose = [...transcript.querySelectorAll("[data-testid='bb-markdown']")].map((n) => n.textContent);
    expect(prose).toEqual(["I’ll take a look.", "**Done** — all set."]);
    expect(transcript.textContent).not.toContain("rm -rf build");
    expect(transcript.textContent).not.toContain("Child finished");
    expect(new Set(overlay.inspection.sdkCalls.map((call) => call.method))).toEqual(
      new Set(["threads.timeline", "threads.get"]),
    );
    const timelineCall = overlay.inspection.sdkCalls.find((call) => call.method === "threads.timeline")!;
    expect(timelineCall.args[0]).toMatchObject({ threadId: "thread-a", includeNestedRows: "true" });
    expect(header.inspection.sdkCalls).toEqual([]);
    expect(overlay.inspection.navigateCalls).toEqual([]);
    expect(overlay.inspection.composer.text).toBe("My unsent draft");
  });

  it("shows a working dot while the agent is running", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    await waitFor(() =>
      expect(screen.getByRole("status").getAttribute("data-working")).toBe("true"),
    );
  });

  it("loads earlier messages above the current ones", async () => {
    timeline.mockImplementationOnce(async ({ threadId }) => timelineFor(threadId, true));
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    await user.click(await screen.findByRole("button", { name: "Show earlier messages" }));
    const transcript = screen.getByTestId("bb-focus-mode-transcript");
    await waitFor(() => expect(transcript.querySelector("blockquote")?.textContent).toBe("Earliest question"));
    expect(screen.queryByRole("button", { name: "Show earlier messages" })).toBeNull();
    expect(timeline).toHaveBeenCalledWith(
      expect.objectContaining({ beforeAnchorId: "older", beforeAnchorSeq: "1" }),
    );
  });

  it("closes with Escape and restores focus to the entry button", async () => {
    const { user } = await mount();
    const trigger = screen.getByRole("button", { name: "Enter focus mode" });
    await user.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("bb-focus-mode-transcript")),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("closes with Exit focus and traps keyboard focus while reading", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    const exit = screen.getByRole("button", { name: /Exit focus/ });
    const transcript = screen.getByTestId("bb-focus-mode-transcript");
    await screen.findByText("Question for thread-a");
    expect(document.activeElement).toBe(transcript);
    await user.tab();
    expect(document.activeElement).toBe(exit);
    await user.tab();
    expect(document.activeElement).toBe(transcript);
    await user.click(exit);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the command's focused thread, including a different split pane", async () => {
    await mount();
    await act(async () => focusCommand.run(commandContext("thread-b")));
    expect(await screen.findByText("Question for thread-b")).toBeTruthy();
  });

  it("keeps reading when opening also focuses the selected split pane", async () => {
    const { overlay, app } = await mount();
    await act(async () => focusCommand.run(commandContext("thread-b")));
    route.threadId = "thread-b";
    const Overlay = app.appOverlays[0]!.component;
    overlay.lifecycle.rerender(<Overlay />);
    expect(screen.getByRole("dialog", { name: "Focus mode" })).toBeTruthy();
    expect(await screen.findByText("Question for thread-b")).toBeTruthy();
  });

  it("does nothing when a command has no current thread", async () => {
    await mount();
    await act(async () => focusCommand.run(commandContext(null)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns to the same unsent draft and caret after a keyboard-command open", async () => {
    const { user } = await mount();
    render(<textarea aria-label="Draft" defaultValue="My unsent draft" />);
    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft" });
    draft.focus();
    draft.setSelectionRange(3, 3);
    await act(async () => focusCommand.run(commandContext("thread-a")));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(draft));
    expect(draft.value).toBe("My unsent draft");
    expect(draft.selectionStart).toBe(3);
  });

  it("ignores malformed open events", async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(new Event("bb-plugin-focus-mode:open"));
      for (const detail of [null, {}, 1, "", "  "]) {
        window.dispatchEvent(new CustomEvent("bb-plugin-focus-mode:open", { detail }));
      }
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the host navigates away from the conversation", async () => {
    const { overlay, app, user } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    route.threadId = "thread-b";
    const Overlay = app.appOverlays[0]!.component;
    overlay.lifecycle.rerender(<Overlay />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes the reader and event listener on unload and supports a fresh mount", async () => {
    const { overlay, user } = await mount();
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    overlay.lifecycle.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.pointerEvents).toBe("");
    await act(async () => focusCommand.run(commandContext("thread-a")));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    await mount();
    await act(async () => focusCommand.run(commandContext("thread-b")));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await screen.findByText("Question for thread-b")).toBeTruthy();
  });
});
