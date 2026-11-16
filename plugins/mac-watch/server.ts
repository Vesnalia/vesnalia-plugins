// Mac Watch: the health of the Mac that runs this VesnALIA server, readable from anywhere.
//
// A background service samples the Mac every 15 seconds with stock macOS tools
// (no sudo). The latest sample and 24 hours of history feed the sidebar page
// over RPC, the `alia mac-watch` command and the agent skill.
import { existsSync } from "node:fs";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { Collector } from "./collector";
import { appIcon } from "./icons";
import * as power from "./power";
import {
  awakeVerdict, deriveAlerts, downsample, formatBytes, formatDuration, formatRate, inQuietHours, parseQuietHours,
  planNotifications, toPoint, type Alert, type HistoryPoint, type NotifyState, type Snapshot,
} from "./core";

const INTERVAL_MS = 15_000;
const DAY_MS = 24 * 3600_000;
const PERSIST_EVERY_MS = 60_000;
const RANGES = { 1: 15_000, 6: 90_000, 24: 360_000 } as const;

const statusSchema = z.object({
  snapshot: z.custom<Snapshot>().nullable(),
  alerts: z.custom<Alert[]>(),
  error: z.string().nullable(),
  intervalSec: z.number(),
});

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  history: {
    input: z.object({ hours: z.union([z.literal(1), z.literal(6), z.literal(24)]) }),
    output: z.object({ points: z.custom<HistoryPoint[]>(), bucketMs: z.number() }),
  },
  refresh: { input: z.null(), output: statusSchema },
  power_status: {
    input: z.null(),
    output: z.object({
      privileges: z.custom<power.Privileges>(),
      pending: z.custom<power.PendingSleep>().nullable(),
      note: z.custom<{ at: number; text: string }>().nullable(),
      installCommand: z.string(),
    }),
  },
  display_off: { input: z.null(), output: z.object({ ok: z.literal(true) }) },
  sleep: {
    input: z.object({ wakeHours: z.union([z.literal(1), z.literal(4), z.literal(8), z.null()]) }),
    output: z.object({ ok: z.literal(true) }),
  },
  shutdown: { input: z.object({ confirm: z.literal("shutdown") }), output: z.object({ ok: z.literal(true) }) },
  safety_status: {
    input: z.null(),
    output: z.object({
      notify: z.boolean(),
      quiet: z.string(),
      lastPush: z.custom<{ at: number; title: string; channels: string[] }>().nullable(),
    }),
  },
  test_push: { input: z.null(), output: z.object({ channels: z.array(z.string()) }) },
  icons: {
    input: z.object({ apps: z.array(z.string().max(1024)).max(40) }),
    output: z.record(z.string(), z.string().nullable()),
  },
});

/** Realtime channel the page listens on; payload is the sample time. */
export const SAMPLE_CHANNEL = "sample";

// The bundle may run from the plugin root or from dist/; find sudoers/install.sh either way.
const installScript = ["./sudoers/install.sh", "../sudoers/install.sh"]
  .map((rel) => decodeURIComponent(new URL(rel, import.meta.url).pathname))
  .find((path) => existsSync(path));
const installCommand = installScript ? `sh '${installScript}'` : "sh <папка плагина>/sudoers/install.sh";
const pluginFile = (rel: string) => [`./${rel}`, `../${rel}`]
  .map((r) => decodeURIComponent(new URL(r, import.meta.url).pathname))
  .find((path) => existsSync(path)) ?? null;

const COOLDOWN_MS = { always: 30 * 60_000, day: 6 * 3600_000 } as const;
/** One notification per this gap at most, however many alerts come due at once. */
const GLOBAL_GAP_MS = 15 * 60_000;
const pushSchema = z.object({ ok: z.literal(true), channels: z.array(z.enum(["web", "desktop", "mobile"])) });

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    notify: {
      type: "boolean",
      label: "Пуш-уведомления о проблемах",
      description: "Перегрев, батарея, отключение от сети, диск, внезапная перезагрузка. Через плагин уведомлений ALIA.",
      default: true,
    },
    quiet: {
      type: "string",
      label: "Тихие часы",
      description: "Когда приходят только критичные уведомления, например 23:00-09:00. Пусто или off — слать всё круглосуточно.",
      default: "23:00-09:00",
    },
  });
  let cfg = await settings.get();
  settings.onChange((next) => { cfg = next; });
  alia.log.info(`notifications: ${cfg.notify ? "on" : "off"}, quiet hours: ${cfg.quiet || "off"}`);

  const collector = new Collector(pluginFile("helpers/temps.c"), (m) => alia.log.warn(m));
  let snapshot: Snapshot | null = null;
  let recent: Snapshot[] = [];
  let error: string | null = null;
  let busy: Promise<void> | null = null;
  let lastPersist = Date.now();
  // Restored at one-minute resolution; fresh samples append at full resolution.
  let points: HistoryPoint[] = ((await alia.storage.kv.get<HistoryPoint[]>("history")) ?? [])
    .filter((p) => p.at > Date.now() - DAY_MS);

  let pending: power.PendingSleep | null = (await alia.storage.kv.get<power.PendingSleep>("pending-sleep")) ?? null;
  let note: { at: number; text: string } | null = (await alia.storage.kv.get<{ at: number; text: string }>("power-note")) ?? null;
  const logPower = async (text: string) => {
    note = { at: Date.now(), text };
    alia.log.info(`power: ${text}`);
    await alia.storage.kv.set("power-note", note);
  };
  const savePending = async (next: power.PendingSleep | null) => {
    pending = next;
    await (next ? alia.storage.kv.set("pending-sleep", next) : alia.storage.kv.delete("pending-sleep"));
  };

  // ---- notifications ----
  let lastPush: { at: number; title: string; channels: string[] } | null =
    (await alia.storage.kv.get<{ at: number; title: string; channels: string[] }>("last-push")) ?? null;
  const notifyState: NotifyState = {
    streak: new Map(),
    seen: new Map(),
    notified: (await alia.storage.kv.get<Record<string, number>>("notified")) ?? {},
    sent: new Set(),
    lastSentAt: lastPush?.at ?? 0,
  };

  async function push(title: string, body: string): Promise<string[]> {
    const { channels } = await alia.sdk.plugins.callRpc({
      pluginId: "push-notifications",
      method: "notifications.send",
      input: { title, body },
      outputSchema: pushSchema,
    });
    lastPush = { at: Date.now(), title, channels };
    await alia.storage.kv.set("last-push", lastPush);
    return channels;
  }

  /** Send whatever the policy allows this tick and remember the cooldowns. */
  async function notifyAlerts(alerts: Alert[]) {
    const now = Date.now();
    const batch = planNotifications(alerts, notifyState, {
      now,
      quiet: inQuietHours(new Date(now), parseQuietHours(cfg.quiet)),
      enabled: cfg.notify,
      cooldown: COOLDOWN_MS,
      gap: GLOBAL_GAP_MS,
    });
    for (const n of batch) {
      await push(n.title, n.body).catch((e) => alia.log.warn(`push failed: ${e}`));
    }
    await alia.storage.kv.set("notified", notifyState.notified);
  }

  // ---- unexpected restarts ----
  let restart: Alert | null = null;
  {
    const bootAt = Date.now() - (await import("node:os")).uptime() * 1000;
    const lastBoot = await alia.storage.kv.get<number>("last-boot");
    const shutdownAt = await alia.storage.kv.get<number>("shutdown-requested");
    if (lastBoot && Math.abs(bootAt - lastBoot) > 120_000) {
      const planned = shutdownAt && shutdownAt > lastBoot && shutdownAt < bootAt;
      if (!planned) {
        restart = {
          id: "restart",
          tone: "warn",
          push: "day",
          title: "Мак перезагрузился сам",
          detail: `Загрузка в ${new Date(bootAt).toLocaleString("ru-RU")}. Причиной может быть kernel panic, сбой питания или обновление macOS.`,
        };
      }
    }
    await alia.storage.kv.set("last-boot", bootAt);
    if (restart) setTimeout(() => { restart = null; }, 24 * 3600_000).unref?.();
  }

  const status = () => ({
    snapshot,
    alerts: [...(restart ? [restart] : []), ...(snapshot ? deriveAlerts(snapshot, recent.slice(0, -1)) : [])],
    error,
    intervalSec: INTERVAL_MS / 1000,
  });

  async function persist() {
    lastPersist = Date.now();
    // 1440 one-minute points ≈ 120 KB, under the 256 KB KV value limit.
    await alia.storage.kv.set("history", downsample(points, Date.now() - DAY_MS, 60_000));
  }

  async function tick() {
    if (busy) return busy;
    busy = (async () => {
      try {
        const next = await collector.sample();
        snapshot = next;
        recent = [...recent, next].slice(-12);
        points = [...points.filter((p) => p.at > next.at - DAY_MS), toPoint(next)];
        error = null;
        alia.realtime.publish(SAMPLE_CHANNEL, { at: next.at });
        if (Date.now() - lastPersist > PERSIST_EVERY_MS) await persist();
        await notifyAlerts(status().alerts).catch((e) => alia.log.warn(`notify failed: ${e}`));
        if (pending) {
          const settled = await power.settleAfterSleep(pending).catch((e: unknown) => `Не удалось вернуть запрет сна: ${e instanceof Error ? e.message : e}`);
          if (settled) {
            await savePending(null);
            await logPower(settled);
          }
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        alia.log.warn(`sample failed: ${error}`);
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  alia.rpc.register(rpcContract, {
    status: async () => {
      if (!snapshot) await tick();
      return status();
    },
    history: async ({ hours }) => {
      const bucketMs = RANGES[hours];
      return { points: downsample(points, Date.now() - hours * 3600_000, bucketMs), bucketMs };
    },
    refresh: async () => {
      await tick();
      return status();
    },
    power_status: async () => ({ privileges: await power.privileges(), pending, note, installCommand }),
    display_off: async () => {
      await power.displayOff();
      await logPower("Экран погашен.");
      return { ok: true as const };
    },
    sleep: async ({ wakeHours }) => {
      await power.sleep(wakeHours, savePending, (m) => void logPower(`Сон не удался: ${m}`));
      await logPower(wakeHours ? `Мак засыпает, проснётся через ${wakeHours} ч.` : "Мак засыпает.");
      return { ok: true as const };
    },
    safety_status: async () => ({
      notify: cfg.notify,
      quiet: cfg.quiet,
      lastPush,
    }),
    test_push: async () => ({
      channels: await push("Mac Watch: проверка", "Так будут выглядеть предупреждения о вашем Маке."),
    }),
    shutdown: async () => {
      await alia.storage.kv.set("shutdown-requested", Date.now());
      await power.shutdown((m) => void logPower(`Выключение не удалось: ${m}`));
      await logPower("Мак выключается.");
      await persist().catch(() => undefined);
      return { ok: true as const };
    },
    icons: async ({ apps }) => {
      // Only bundles the collector reported: the page cannot make us read arbitrary paths.
      const known = new Set([...(snapshot?.top.cpu ?? []), ...(snapshot?.top.memory ?? [])].map((p) => p.app));
      const entries = await Promise.all(
        apps.filter((app) => known.has(app)).map(async (app) => [app, await appIcon(app)] as const),
      );
      return Object.fromEntries(entries);
    },
  });

  function summary(): string {
    const s = snapshot;
    if (!s) return error ? `Нет данных: ${error}` : "Нет данных: первый замер ещё не готов.";
    const verdict = awakeVerdict(s.sleep);
    const lines = [
      `${s.host.name} · ${s.host.os} · работает ${formatDuration(s.host.uptimeSec)}`,
      `Сон: ${verdict.title}. ${verdict.detail}`,
      `CPU ${s.cpu.usage ?? "—"}% · load ${s.cpu.load.join(" / ")}`,
      s.memory ? `Память ${formatBytes(s.memory.used)} из ${formatBytes(s.memory.total, 0)} · давление ${({ normal: "норма", warn: "высокое", critical: "критическое" } as const)[s.memory.pressure ?? "normal"]}` : "Память —",
      s.disk ? `Диск свободно ${formatBytes(s.disk.free)} из ${formatBytes(s.disk.total, 0)}` : "Диск —",
      s.power
        ? `Питание: ${s.power.source === "ac" ? "сеть" : "батарея"} · ${s.power.percent ?? "—"}%${s.power.charging ? " заряжается" : ""} · Мак берёт ${s.power.systemWatts ?? "—"} Вт`
        : "Питание —",
      s.network ? `Сеть ${s.network.iface}: ↓ ${formatRate(s.network.rxBps)} ↑ ${formatRate(s.network.txBps)}` : "Сеть —",
    ];
    const alerts = status().alerts;
    lines.push(alerts.length ? "Внимание:\n" + alerts.map((a) => `  • ${a.title}. ${a.detail}`).join("\n") : "Всё в порядке.");
    return lines.join("\n");
  }

  alia.cli.register({
    name: "mac-watch",
    summary: "Показатели Мака, на котором работает ALIA: CPU, память, диск, питание, сон",
    commands: [
      { name: "status", summary: "Сводка последнего замера", usage: "alia mac-watch status [--json]" },
      { name: "display-off", summary: "Погасить экран", usage: "alia mac-watch display-off" },
      { name: "sleep", summary: "Усыпить Мак (ALIA станет недоступен)", usage: "alia mac-watch sleep [--wake 1|4|8] --yes" },
      { name: "shutdown", summary: "Выключить Мак (включить можно только кнопкой)", usage: "alia mac-watch shutdown --yes" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const yes = argv.includes("--yes");
      const [command] = argv.filter((arg) => !arg.startsWith("--"));
      const usage = "Usage: VesnALIA mac-watch status [--json] | display-off | sleep [--wake 1|4|8] --yes | shutdown --yes";
      const fail = (e: unknown) => ({ exitCode: 1, stderr: e instanceof Error ? e.message : String(e) });
      if (command === "display-off") {
        return power.displayOff().then(() => ({ exitCode: 0, stdout: "Экран погашен." }), fail);
      }
      if (command === "sleep" || command === "shutdown") {
        if (!yes) return { exitCode: 1, stderr: `Это отключит Мак от ALIA. Повторите с --yes.\n${usage}` };
        if (command === "shutdown") {
          await alia.storage.kv.set("shutdown-requested", Date.now());
          return power.shutdown((m) => void logPower(`Выключение не удалось: ${m}`))
            .then(async () => { await logPower("Мак выключается."); return { exitCode: 0, stdout: "Мак выключается через пару секунд." }; }, fail);
        }
        const wakeArg = argv[argv.indexOf("--wake") + 1];
        const wake = argv.includes("--wake") ? Number(wakeArg) : null;
        if (wake !== null && !power.WAKE_HOURS.includes(wake as power.WakeHours)) return { exitCode: 1, stderr: usage };
        return power.sleep(wake as power.WakeHours | null, savePending, (m) => void logPower(`Сон не удался: ${m}`))
          .then(async () => { await logPower(wake ? `Мак засыпает, проснётся через ${wake} ч.` : "Мак засыпает."); return { exitCode: 0, stdout: "Мак засыпает через пару секунд." }; }, fail);
      }
      if (command !== "status" && command !== undefined) return { exitCode: 1, stderr: usage };
      if (!snapshot) await tick();
      if (json) {
        const s = status();
        // Bounded: one snapshot, no history.
        return { exitCode: 0, stdout: JSON.stringify({ ...s, verdict: awakeVerdict(s.snapshot?.sleep ?? null) }) };
      }
      return { exitCode: 0, stdout: summary() };
    },
  });

  alia.background.service("poll", {
    async start(signal) {
      while (!signal.aborted) {
        await tick();
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, INTERVAL_MS);
          signal.addEventListener("abort", done, { once: true });
        });
      }
      await persist().catch(() => undefined);
    },
  });
}
