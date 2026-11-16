// @vitest-environment jsdom
//
// The overlay drives VesnALIA's own question widget through the DOM, so these tests
// stand up a replica of that widget — the markup VesnALIA renders for a pending user
// question — and assert the countdown against it. `buildWidget` is the
// contract: if a VesnALIA release changes the widget, this file is where the change
// is described, and the behavioral assertions below stay as they are.
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WidgetQuestion = {
  prompt: string;
  shortLabel: string;
  options: string[];
};

type Widget = {
  root: HTMLElement;
  primary: HTMLButtonElement;
  optionButtons: () => HTMLButtonElement[];
  /** What VesnALIA does on a click: move the selection and re-enable the button. */
  select: (index: number) => Promise<void>;
  /** What VesnALIA does when "Other…" is picked: open the free-text box. */
  openFreeText: () => Promise<void>;
  clicks: string[];
};

function buildWidget(
  questions: WidgetQuestion[],
  { isLast = true }: { isLast?: boolean } = {},
): Widget {
  const question = questions[0]!;
  const clicks: string[] = [];

  const root = document.createElement("div");
  root.className =
    "flex max-h-[calc(100dvh-6rem)] min-h-0 flex-col text-xs text-muted-foreground";

  if (questions.length > 1) {
    const tabs = document.createElement("div");
    tabs.className = "mb-2 flex shrink-0 items-center gap-2";
    const strip = document.createElement("div");
    strip.className = "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto";
    questions.forEach((candidate, index) => {
      const wrapper = document.createElement("div");
      const tab = document.createElement("button");
      tab.type = "button";
      // The tabs carry aria-pressed too, but they live outside the fieldset.
      tab.setAttribute("aria-pressed", String(index === 0));
      tab.title = candidate.prompt;
      tab.textContent = candidate.shortLabel;
      tab.addEventListener("click", () => clicks.push(`tab:${index}`));
      wrapper.append(tab);
      strip.append(wrapper);
    });
    tabs.append(strip);
    root.append(tabs);
  }

  const scroll = document.createElement("div");
  scroll.className = "min-h-0 touch-pan-y overflow-y-auto overscroll-contain";
  const fieldset = document.createElement("fieldset");
  fieldset.className = "min-w-0";
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = question.prompt;
  const heading = document.createElement("div");
  heading.className = "text-sm font-semibold text-foreground";
  heading.textContent = question.prompt;
  const list = document.createElement("div");
  list.className = "mt-2 space-y-0.5";
  for (const label of question.options) {
    const wrapper = document.createElement("div");
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("aria-pressed", "false");
    option.className =
      "flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors";
    option.textContent = label;
    option.addEventListener("click", () => clicks.push(`option:${label}`));
    wrapper.append(option);
    list.append(wrapper);
  }
  fieldset.append(legend, heading, list);
  scroll.append(fieldset);
  root.append(scroll);

  const footer = document.createElement("div");
  footer.className = "mt-3 flex shrink-0 items-center justify-between gap-2";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => clicks.push("cancel"));
  const actions = document.createElement("div");
  actions.className = "flex items-center gap-2";
  const primary = document.createElement("button");
  primary.type = "button";
  primary.textContent = isLast ? "Submit answer" : "Next";
  primary.disabled = true;
  primary.addEventListener("click", () => clicks.push("primary"));
  actions.append(primary);
  footer.append(cancel, actions);
  root.append(footer);

  document.body.append(root);

  // Scoped to the rows VesnALIA itself renders: the countdown block is injected into
  // this same list, and its Stop button is not an option.
  const optionButtons = () =>
    Array.from(list.querySelectorAll<HTMLButtonElement>(":scope > div > button"));

  return {
    root,
    primary,
    optionButtons,
    clicks,
    // Mutating aria-pressed is exactly what React's re-render does, and it is
    // what the overlay listens for — so this covers a keyboard shortcut too.
    select: async (index) => {
      await act(async () => {
        optionButtons().forEach((button, position) => {
          button.setAttribute("aria-pressed", String(position === index));
        });
        primary.disabled = false;
      });
    },
    openFreeText: async () => {
      await act(async () => {
        const textarea = document.createElement("textarea");
        textarea.placeholder = "Type your own answer…";
        fieldset.append(textarea);
        const other = optionButtons()[0]!;
        other.setAttribute("aria-pressed", "true");
      });
    },
  };
}

const TWO_QUESTIONS: WidgetQuestion[] = [
  { prompt: "Which database?", shortLabel: "Database", options: ["Postgres", "SQLite"] },
  { prompt: "Which runtime?", shortLabel: "Runtime", options: ["Node", "Bun"] },
];
const ONE_QUESTION: WidgetQuestion[] = [
  { prompt: "Ship it?", shortLabel: "Ship", options: ["Yes", "No"] },
];

async function renderOverlay(settings: Record<string, string | number | boolean>) {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays[0];
  expect(overlay).toBeDefined();
  return renderSlot(overlay!, {}, { settings });
}

/** Run the interval callbacks the overlay installed, with React flushing. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Each overlay observes the whole document, so a leaked mount from an
  // earlier test would answer this test's widget.
  cleanup();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("auto answer countdown", () => {
  it("advances to the next question when the countdown ends", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(TWO_QUESTIONS, { isLast: false });

    await widget.select(0);
    expect(slot.getByText("Next question in 4s")).toBeDefined();

    await advance(3_900);
    expect(widget.clicks).toEqual([]);

    await advance(200);
    expect(widget.clicks).toEqual(["primary"]);
    expect(slot.queryByText(/Next question in/)).toBeNull();
  });

  it("submits the answer on the last question", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    expect(slot.getByText("Submitting answer in 4s")).toBeDefined();

    await advance(4_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("restarts the countdown when another option is picked", async () => {
    await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await advance(3_000);
    await widget.select(1);

    await advance(3_000); // 6s since the first pick, 3s since the second
    expect(widget.clicks).toEqual([]);

    await advance(1_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("restarts the countdown when the same option is picked again", async () => {
    await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await advance(3_000);
    await widget.select(0);

    await advance(3_000);
    expect(widget.clicks).toEqual([]);

    await advance(1_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("Stop cancels the countdown, and the next pick starts a new one", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await act(async () => {
      slot.getByRole("button", { name: /^Stop/ }).click();
    });

    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();

    // Stopping is a pause, not a switch: picking again arms it as usual.
    await widget.select(1);
    expect(slot.getByRole("button", { name: /^Stop/ })).toBeDefined();
    await advance(4_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("stops on space, and says so on the button", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    expect(slot.getByRole("button", { name: /^Stop/ }).textContent).toContain(
      "(press space)",
    );

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
    });

    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("leaves space alone inside a text field", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    const field = document.createElement("input");
    document.body.append(field);

    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
    });
    expect(slot.getByRole("button", { name: /^Stop/ })).toBeDefined();

    await advance(4_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("re-arms after Stop even for the very same option", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await act(async () => {
      slot.getByRole("button", { name: /^Stop/ }).click();
    });
    await widget.select(0);

    await advance(4_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("sits directly under the option that armed it, and follows the next pick", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(1);
    const block = slot.getByRole("status");
    // Reaching Stop should never mean travelling past the rest of the list.
    expect(widget.optionButtons()[1]!.parentElement!.nextElementSibling).toBe(
      block.parentElement,
    );

    await widget.select(0);
    expect(slot.getByRole("status")).toBe(block); // the same node, moved
    expect(widget.optionButtons()[0]!.parentElement!.nextElementSibling).toBe(
      block.parentElement,
    );
  });

  it("sweeps the progress bar every animation frame", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    const bar = slot.getByRole("status").querySelector<HTMLElement>(".bg-primary");
    expect(bar).not.toBeNull();

    const widths = new Set<string>();
    for (let step = 0; step < 10; step++) {
      await advance(16);
      widths.add(bar!.style.width);
    }
    // Ten frames inside one second: a 100ms tick could only produce a handful
    // of distinct widths here, the visible stepping the bar used to have.
    expect(widths.size).toBeGreaterThanOrEqual(8);
  });

  it("honors the configured delay", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 10 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    expect(slot.getByText("Submitting answer in 10s")).toBeDefined();

    await advance(9_000);
    expect(widget.clicks).toEqual([]);
    await advance(1_100);
    expect(widget.clicks).toEqual(["primary"]);
  });

  it("does nothing when the plugin is disabled", async () => {
    const slot = await renderOverlay({ enabled: false, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("never auto-submits a free-text answer", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.openFreeText();
    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("drops the countdown when the selection is cleared again", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await act(async () => {
      // Un-ticking the last option of a multi-select: nothing is selected, so
      // VesnALIA disables its own button.
      widget.optionButtons()[0]!.setAttribute("aria-pressed", "false");
      widget.primary.disabled = true;
    });

    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("stops when the widget is dismissed", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(ONE_QUESTION);

    await widget.select(0);
    await act(async () => {
      widget.root.remove();
    });

    await advance(10_000);
    expect(widget.clicks).toEqual([]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("stands down when the user presses the widget's own button", async () => {
    const slot = await renderOverlay({ enabled: true, delaySeconds: 4 });
    const widget = buildWidget(TWO_QUESTIONS, { isLast: false });

    await widget.select(0);
    await act(async () => {
      widget.primary.click();
    });
    expect(widget.clicks).toEqual(["primary"]);
    expect(slot.queryByRole("button", { name: /^Stop/ })).toBeNull();

    // No second, automatic press afterwards.
    await advance(10_000);
    expect(widget.clicks).toEqual(["primary"]);
  });
});
