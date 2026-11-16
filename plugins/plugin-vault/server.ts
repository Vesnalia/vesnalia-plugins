import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(), // hex, e.g. "#ef4444"
});
export type Label = z.infer<typeof labelSchema>;

export const entrySchema = z.object({
  id: z.string(), // plugin ID, e.g. "t3sidebar"
  name: z.string(),
  labels: z.array(z.string()),
  note: z.string(),
  updatedAt: z.string(),
});
export type Entry = z.infer<typeof entrySchema>;

export const installedPluginSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  status: z.enum(["running", "disabled", "stopped", "unknown"]),
  source: z.string().optional(),
});
export type InstalledPlugin = z.infer<typeof installedPluginSchema>;

const DEFAULT_LABELS: Label[] = [
  { id: "liked", name: "Liked", color: "#10b981" },
  { id: "installed", name: "Installed", color: "#06b6d4" },
  { id: "rejected", name: "Rejected", color: "#ef4444" },
  { id: "buggy", name: "Buggy", color: "#f87171" },
  { id: "slow", name: "Slow", color: "#fbbf24" },
  { id: "clashes", name: "Conflicts", color: "#c084fc" },
  { id: "redundant", name: "Redundant", color: "#60a5fa" },
  { id: "testing-only", name: "Testing only", color: "#a1a1aa" },
  { id: "other", name: "Other", color: "#a1a1aa" },
];

export const rpcContract = defineRpcContract({
  vault_list: {
    input: z.null(),
    output: z.object({
      entries: z.array(entrySchema),
      labels: z.array(labelSchema),
      installed: z.array(installedPluginSchema),
      catalogMap: z.record(z.string(), z.string()).optional(),
    }),
  },
  vault_set: {
    input: z.object({
      id: z.string().trim().min(1),
      name: z.string().optional(),
      labels: z.array(z.string()),
      note: z.string().trim().default(""),
    }),
    output: z.object({ entry: entrySchema.nullable() }),
  },
  label_create: {
    input: z.object({
      name: z.string().trim().min(1),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
    }),
    output: labelSchema,
  },
});

const VAULT_CHANGED = "vault-changed";

type LegacyEntry = { id: string; name?: string; label?: string; reason?: string; archivedAt?: string };

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("Plugin Vault initialized");

  async function readEntries(): Promise<Entry[]> {
    const raw = (await alia.storage.kv.get<Array<Entry | LegacyEntry>>("archived_plugins")) ?? [];
    return raw.map((e) =>
      "labels" in e
        ? e
        : {
            id: e.id,
            name: e.name ?? e.id,
            labels: e.label ? [e.label] : [],
            note: e.reason ?? "",
            updatedAt: e.archivedAt ?? new Date().toISOString(),
          }
    );
  }

  async function readLabels(): Promise<Label[]> {
    return (await alia.storage.kv.get<Label[]>("labels")) ?? DEFAULT_LABELS;
  }

  function publish() {
    alia.realtime.publish(VAULT_CHANGED, {});
  }

  async function setEntry(id: string, name: string | undefined, labels: string[], note: string): Promise<Entry | null> {
    const known = new Set((await readLabels()).map((l) => l.id));
    const unknown = labels.filter((l) => !known.has(l));
    if (unknown.length) throw new Error(`Unknown label(s): ${unknown.join(", ")}`);

    const list = (await readEntries()).filter((e) => e.id !== id);
    const entry: Entry | null =
      labels.length || note
        ? { id, name: name?.trim() || id, labels: [...new Set(labels)], note, updatedAt: new Date().toISOString() }
        : null;
    if (entry) list.push(entry);
    await alia.storage.kv.set("archived_plugins", list);
    publish();
    return entry;
  }

  async function createLabel(name: string, color: string): Promise<Label> {
    const labels = await readLabels();
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "label";
    let id = base;
    for (let i = 2; labels.some((l) => l.id === id); i++) id = `${base}-${i}`;
    const label = { id, name, color: color.toLowerCase() };
    await alia.storage.kv.set("labels", [...labels, label]);
    publish();
    return label;
  }

  async function getCatalogMap(): Promise<Record<string, string>> {
    try {
      const res = await fetch(`${alia.server.loopbackBaseUrl}/api/v1/plugin-catalog/search?query=`);
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{ pluginId: string; displayName: string; entryId?: string }>;
        };
        const map: Record<string, string> = {};
        if (Array.isArray(data.results)) {
          for (const item of data.results) {
            if (item.pluginId) {
              const pid = item.pluginId.toLowerCase();
              map[pid] = item.pluginId;
              if (item.displayName) {
                map[item.displayName.toLowerCase()] = item.pluginId;
              }
              if (item.entryId) {
                map[item.entryId.toLowerCase()] = item.pluginId;
              }
            }
          }
        }
        return map;
      }
    } catch (err) {
      alia.log.warn(`Failed to fetch catalog in server: ${String(err)}`);
    }
    return {};
  }

  async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
    try {
      const { stdout } = await execFileAsync("alia", ["plugin", "list", "--json"]);
      const parsed = JSON.parse(stdout);
      const plugins = Array.isArray(parsed) ? parsed : parsed?.plugins;
      if (Array.isArray(plugins)) {
        return plugins.map((p) => ({
          id: p.id ?? p.name,
          version: p.version,
          status: p.status === "running" || p.running || p.enabled ? "running" : "disabled",
          source: p.source,
        }));
      }
    } catch (err) {
      alia.log.warn(`Failed to list plugins via CLI: ${String(err)}`);
    }

    // Fallback: parse plain text if --json is not supported
    try {
      const { stdout } = await execFileAsync("alia", ["plugin", "list"]);
      const lines = stdout.split("\n");
      const list: InstalledPlugin[] = [];
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9@/._-]+)@([^\s]+)\s+([a-zA-Z0-9_-]+)/);
        if (match) {
          list.push({
            id: match[1],
            version: match[2],
            status: match[3] === "running" ? "running" : "disabled",
          });
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  alia.rpc.register(rpcContract, {
    vault_list: async () => ({
      entries: await readEntries(),
      labels: await readLabels(),
      installed: await getInstalledPlugins(),
      catalogMap: await getCatalogMap(),
    }),
    vault_set: async ({ id, name, labels, note }) => ({ entry: await setEntry(id, name, labels, note) }),
    label_create: async ({ name, color }) => await createLabel(name, color),
  });

  // CLI Registration
  const usage = [
    "Usage:",
    "  VesnALIA plugin-vault list [--json]",
    "  VesnALIA plugin-vault labels [--json]",
    "  VesnALIA plugin-vault add <plugin-id> [--label <label>]... [--note <note>] [--disable|--remove]",
    "  VesnALIA plugin-vault remove <plugin-id>",
  ].join("\n");

  alia.cli.register({
    name: "plugin-vault",
    summary: "Label and annotate VesnALIA plugins",
    commands: [
      { name: "list", summary: "List labeled plugins", usage: "alia plugin-vault list [--json]" },
      { name: "labels", summary: "List available labels", usage: "alia plugin-vault labels [--json]" },
      {
        name: "add",
        summary: "Add labels and a note to a plugin",
        usage: "alia plugin-vault add <plugin-id> [--label <label>]... [--note <note>] [--disable|--remove]",
      },
      {
        name: "remove",
        summary: "Clear a plugin's labels and note",
        usage: "alia plugin-vault remove <plugin-id>",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const cleanArgs = argv.filter((a) => a !== "--json");
      const [cmd, ...rest] = cleanArgs;

      if (!cmd || cmd === "help" || cmd === "--help") {
        return { exitCode: 0, stdout: usage };
      }

      if (cmd === "list") {
        const entries = await readEntries();
        if (json) return { exitCode: 0, stdout: JSON.stringify(entries) };
        if (entries.length === 0) return { exitCode: 0, stdout: "No plugins labeled." };
        const out = entries
          .map((p) => `[${p.labels.join(", ").toUpperCase()}] ${p.id} — ${p.note || "No note"}`)
          .join("\n");
        return { exitCode: 0, stdout: out };
      }

      if (cmd === "labels") {
        const labels = await readLabels();
        if (json) return { exitCode: 0, stdout: JSON.stringify(labels) };
        return { exitCode: 0, stdout: labels.map((l) => `${l.id} — ${l.name}`).join("\n") };
      }

      if (cmd === "add") {
        const id = rest[0];
        if (!id) return { exitCode: 1, stderr: "Plugin ID required." };
        const labels: string[] = [];
        let note: string | undefined;
        let action: "disable" | "remove" | null = null;

        for (let i = 1; i < rest.length; i++) {
          if (rest[i] === "--label" && rest[i + 1]) {
            labels.push(rest[++i]);
          } else if ((rest[i] === "--note" || rest[i] === "--reason") && rest[i + 1] !== undefined) {
            note = rest[++i];
          } else if (rest[i] === "--disable") {
            action = "disable";
          } else if (rest[i] === "--remove") {
            action = "remove";
          }
        }

        const existing = (await readEntries()).find((e) => e.id === id);
        let entry: Entry | null;
        try {
          entry = await setEntry(
            id,
            existing?.name,
            [...(existing?.labels ?? []), ...labels],
            (note ?? existing?.note ?? "").trim()
          );
        } catch (err) {
          return { exitCode: 1, stderr: err instanceof Error ? err.message : String(err) };
        }

        if (action) {
          try {
            await execFileAsync("alia", ["plugin", action, id]);
          } catch (e) {
            alia.log.warn(`Could not ${action} ${id}: ${String(e)}`);
          }
        }

        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(entry) : `Saved ${id} [${entry?.labels.join(", ") ?? ""}].`,
        };
      }

      if (cmd === "remove") {
        const id = rest[0];
        if (!id) return { exitCode: 1, stderr: "Plugin ID required." };
        const existed = (await readEntries()).some((e) => e.id === id);
        if (existed) await setEntry(id, undefined, [], "");
        return {
          exitCode: existed ? 0 : 1,
          stdout: existed ? `Cleared ${id}.` : `Plugin ${id} has no labels.`,
        };
      }

      return { exitCode: 1, stderr: usage };
    },
  });

  alia.onDispose(() => {
    alia.log.info("Plugin Vault disposed");
  });
}
