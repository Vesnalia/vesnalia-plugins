/**
 * Herald's server: thread events become "needs you" entries, each with one
 * plain sentence, and the app speaks it.
 *
 * Every decision lives in `server/`; this file only wires it to VesnALIA. The ports
 * over `alia.sdk` are built on first use, from a handler — never in the factory
 * body. Herald starts no threads of its own. See AGENTS.md.
 */
import { randomUUID } from "node:crypto";

import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

import { rpcContract } from "./shared/contract";
import {
  DEFAULT_STORED_CONFIG,
  ENTRIES_CHANNEL,
  RecentHistoryLimitSchema,
  SentenceToolSchema,
  StoredConfigSchema,
  VoicesConfigSchema,
  type StoredConfig,
} from "./shared/herald";
import { customCommandSeed, sentenceSettingsOf, SETTINGS } from "./shared/settings";
import { CHOICES_CHANNEL } from "./shared/thread-choice";
import { aliaEvents, aliaLiveness, aliaNames, aliaThreadChoices } from "./server/alia-ports";
import { SentenceHistory } from "./server/history";
import { createHooks, type HeraldConfig } from "./server/hooks";
import { kvBackend } from "./server/kv-backend";
import { Liveness } from "./server/liveness";
import type { EventsPort, NamesPort } from "./server/ports";
import { withNames } from "./server/recent";
import { announceDrained, onOtherDrained } from "./server/reload-signal";
import { listSayVoices, renderWithSay, sayAvailable } from "./server/say";
import { AttentionStore } from "./server/store";
import { ThreadChoices } from "./server/thread-choices";
import { SentenceWriter } from "./server/writer";

export { rpcContract } from "./shared/contract";
export type { RpcContract } from "./shared/contract";

const CONFIG_KEY = "config";

/**
 * How long after a load a pending entry left by an earlier instance is kept
 * before it is dropped, when no reload drain says that instance is gone. A
 * drain takes seconds; a cold start never sends one.
 */
export const ABANDONED_AFTER_MS = 60_000;

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define(SETTINGS);
  const store = new AttentionStore(kvBackend(alia.storage.kv), alia.log);
  // Read before any handler is registered. The store merges anyway, so an
  // event that ever arrived mid-read would not be lost under an older entry.
  await store.load().catch((error: unknown) => {
    alia.log.error(`Could not load saved entries: ${error instanceof Error ? error.message : String(error)}`);
  });
  // A sentence an earlier instance was still writing is not coming: its tool
  // died with it. Such an entry is dropped, never promoted — but only once
  // that instance has had its last word. On a reload that is its drain signal
  // (VesnALIA loads this instance before disposing the old one, which may still
  // withdraw or land the entry meanwhile); on a cold start no signal ever
  // comes, so a timer stands in for it. This instance's own runs are left alone.
  const instance = randomUUID();
  const dropAbandoned = () => {
    if (store.dropPending(hooks.inFlightEventIds())) publish();
  };
  const abandonedTimer = setTimeout(dropAbandoned, ABANDONED_AFTER_MS);
  const stopListening = onOtherDrained(alia.pluginId, instance, () => {
    store
      .reconcile()
      .then(() => {
        // Only a read that succeeded stands in for the timer; a failed one
        // leaves it to drop what the old instance left, a minute on.
        clearTimeout(abandonedTimer);
        dropAbandoned();
        publish();
      })
      .catch((error: unknown) => {
        alia.log.error(`Could not re-read saved entries after a reload: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  const writer = new SentenceWriter(alia.log);
  const history = new SentenceHistory(alia.storage.kv, alia.log);

  let events: EventsPort | null = null;
  let liveness: Liveness | null = null;
  let names: NamesPort | null = null;
  let choices: ThreadChoices | null = null;
  const eventsPort = () => (events ??= aliaEvents(alia.sdk, alia.log));
  /** Saves are chained: two partial writes at once must both land. */
  let configWrites: Promise<unknown> = Promise.resolve();
  const livenessOf = () => (liveness ??= new Liveness(aliaLiveness(alia.sdk), alia.log));
  const namesPort = () => (names ??= aliaNames(alia.sdk));
  const choicesOf = () => (choices ??= new ThreadChoices(aliaThreadChoices(alia.sdk)));

  function publishOn(channel: string, what: string): void {
    try {
      alia.realtime.publish(channel, { at: Date.now() });
    } catch (error) {
      // After an unload the handle is stale; the clients re-read on reconnect anyway.
      alia.log.warn(`Could not tell the app ${what} changed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function publish(): void {
    publishOn(ENTRIES_CHANNEL, "the entries");
  }

  /** The stored configuration, each part falling back to its default when unreadable. */
  async function storedConfig(): Promise<StoredConfig> {
    const raw = await alia.storage.kv.get<Partial<StoredConfig>>(CONFIG_KEY);
    const voices = VoicesConfigSchema.safeParse(raw?.voices);
    const tool = SentenceToolSchema.safeParse(raw?.sentenceTool);
    const limit = RecentHistoryLimitSchema.safeParse(raw?.recentHistoryLimit);
    const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
    return {
      voices: voices.success ? voices.data : { ...DEFAULT_STORED_CONFIG.voices },
      sentenceTool: tool.success ? tool.data : DEFAULT_STORED_CONFIG.sentenceTool,
      sentenceCommand: text(raw?.sentenceCommand, DEFAULT_STORED_CONFIG.sentenceCommand),
      sentencePrompt: text(raw?.sentencePrompt, DEFAULT_STORED_CONFIG.sentencePrompt),
      recentHistoryLimit: limit.success ? limit.data : DEFAULT_STORED_CONFIG.recentHistoryLimit,
    };
  }

  async function readConfig(): Promise<HeraldConfig> {
    const [values, stored] = await Promise.all([settings.get(), storedConfig()]);
    return {
      announce: {
        question: values.announceQuestions,
        plan: values.announcePlans,
        permission: values.announcePermissions,
        finished: values.announceFinished,
        error: values.announceErrors,
      },
      announceSubagents: values.announceSubagents,
      sentence: sentenceSettingsOf(values.writeWithModel, stored),
    };
  }

  const hooks = createHooks({
    store,
    readConfig,
    // A getter, so alia.sdk is reached when an event needs it, not here.
    events: {
      context: (thread, options) => eventsPort().context(thread, options),
      interruptedRecently: (threadId, withinMs) => eventsPort().interruptedRecently(threadId, withinMs),
      interactionPending: (threadId, interactionId) => eventsPort().interactionPending(threadId, interactionId),
    },
    // Read per event, so a choice made in the thread menu applies to the next one.
    choiceOf: (thread) => choicesOf().inputsOf(thread.id),
    publish,
    // The tool runs here, on the VesnALIA server's machine; see AGENTS.md.
    writeSentence: (command, prompt) => writer.write(command, prompt),
    remember: (threadId, item) => history.append(threadId, item),
    log: alia.log,
  });

  alia.events.on("thread.active", ({ thread }) => hooks.active(thread));
  alia.events.on("thread.idle", ({ thread, lastAssistantText }) => hooks.idle(thread, lastAssistantText));
  alia.events.on("thread.failed", ({ thread, error }) => hooks.failed(thread, error));
  alia.events.on("interaction.pending", ({ thread, interaction }) => hooks.interactionPending(thread, interaction));
  alia.events.on("thread.archived", ({ thread }) => hooks.gone(thread));
  alia.events.on("thread.deleted", ({ thread }) => {
    hooks.gone(thread);
    // Archived threads keep their history; a deleted one is gone for good.
    // An archived thread has no entry left for `gone` to publish about, so
    // the Herald page hears of its sentences going from here.
    void history.remove(thread.id).then(publish);
  });

  alia.rpc.register(rpcContract, {
    list: async () => ({ entries: await livenessOf().visible(store) }),
    "history.list": ({ threadId }) => history.list(threadId).then((items) => ({ items })),
    "history.recent": async () => {
      const { recentHistoryLimit } = await storedConfig();
      return { items: await withNames(await history.recent(recentHistoryLimit), namesPort(), alia.log) };
    },
    "choices.list": async ({ threadIds }) => ({ threads: Object.fromEntries(await choicesOf().inputs(threadIds)) }),
    // A thread's choice also decides its descendants', so every open menu
    // re-reads every row it shows rather than this one alone.
    // They hear of it as soon as it is saved, before the read-back, which
    // may fail on its own.
    "choices.set": async ({ threadId, choice }) => {
      await choicesOf().set(threadId, choice);
      publishOn(CHOICES_CHANNEL, "a thread's choice");
      return choicesOf().inputsOf(threadId);
    },
    // Told once for the whole selection, and also when only some were saved.
    "choices.setMany": async ({ threadIds, choice }) => {
      try {
        await choicesOf().setMany(threadIds, choice);
      } finally {
        publishOn(CHOICES_CHANNEL, "several threads' choice");
      }
      return null;
    },
    "config.get": () => storedConfig(),
    // Any part of the stored configuration; the rest is kept. When the tool
    // becomes "custom" with nothing written yet, the command of the tool
    // selected before is filled in, so the user edits a working line.
    "config.set": (next) => {
      const write = configWrites.then(async () => {
        const current = await storedConfig();
        const merged = StoredConfigSchema.parse({ ...current, ...next });
        const seed = customCommandSeed(current, merged);
        const saved = seed === null ? merged : { ...merged, sentenceCommand: seed };
        await alia.storage.kv.set(CONFIG_KEY, saved);
        // An open Herald page re-reads its history at the new length.
        if (saved.recentHistoryLimit !== current.recentHistoryLimit) publish();
        return saved;
      });
      // A failed save must not wedge the ones after it.
      configWrites = write.catch(() => {});
      return write;
    },
    log: ({ level, message }) => {
      alia.log[level](`app: ${message}`);
      return null;
    },
    // The server's Mac renders speech with `say`; the app plays the bytes. Not
    // a Mac, or no `say`: the app hears that and uses the browser's voice.
    "speech.voices": async () => {
      const available = await sayAvailable();
      return { available, voices: available ? await listSayVoices() : [] };
    },
    "speech.render": async ({ text, voice, rate }) => {
      if (!(await sayAvailable())) throw new Error("alia does not run on a Mac here, so `say` is not available.");
      return renderWithSay(text, { voice, rate });
    },
  });

  alia.onDispose(async () => {
    stopListening();
    clearTimeout(abandonedTimer);
    // Hooks first, so a tool killed next cannot land a sentence; the store
    // then freezes with the entry still pending, for the next load to settle.
    hooks.dispose();
    await writer.dispose();
    await store.shutdown();
    await history.flush();
    announceDrained(alia.pluginId, instance);
  });
}
