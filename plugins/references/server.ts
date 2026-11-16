// alia-plugin-references — Visual references and moodboard panel for VesnALIA IDE
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Context } from "hono";
import { type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { rpcContract } from "./src/rpc/contract.ts";
import { FileReferenceStorage } from "./src/storage/reference-storage.ts";
import { ReferenceService } from "./src/services/reference-service.ts";
import { DefaultProjectResolver } from "./src/services/project-resolver.ts";
import { MetadataScraper } from "./src/services/metadata-scraper.ts";
import { handleImageRequest } from "./src/server/image-handler.ts";
import { createRpcHandlers } from "./src/rpc/handlers.ts";
import { registerAgentTools } from "./src/server/agent-tools.ts";
import { registerCli } from "./src/cli/register.ts";

export { rpcContract, type ReferencesRpcContract } from "./src/rpc/contract.ts";
export type { Reference, TagInfo } from "./src/types/schema.ts";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("References plugin loading...");

  const settings = alia.settings.define({
    storageDir: {
      type: "string",
      label: "Storage Directory",
      description: "Path to references storage directory.",
      default: "~/.vesnalia/references",
    },
  });

  const getStorageDir = async (): Promise<string> => {
    try {
      const cfg = await settings.get();
      const raw = cfg.storageDir || "~/.vesnalia/references";
      if (raw.startsWith("~/")) {
        return resolve(homedir(), raw.slice(2));
      }
      return resolve(raw);
    } catch {
      return resolve(homedir(), ".vesnalia/references");
    }
  };

  const baseStorageDir = await getStorageDir();
  const storage = new FileReferenceStorage(baseStorageDir);
  const scraper = new MetadataScraper();
  const projectResolver = new DefaultProjectResolver(async () => {
    try {
      const res = await alia.sdk.projects.list();
      if (Array.isArray(res)) {
        return res.map((p) => ({ id: p.id, name: p.name || p.id }));
      }
      return [];
    } catch {
      return [];
    }
  });
  const service = new ReferenceService(storage, projectResolver, scraper);

  const allowedRoots = [
    homedir(),
    baseStorageDir,
    process.cwd(),
  ];

  // 1. HTTP Endpoint: serve local images securely
  alia.http.route("GET", "/image", async (c: Context) => {
    const rawPath = c.req.query("path");
    if (!rawPath) {
      return c.text("Missing path query parameter", 400);
    }

    const result = await handleImageRequest(rawPath, allowedRoots);
    const headers: Record<string, string> = { ...result.headers };

    if (result.status !== 200) {
      return c.text(
        typeof result.body === "string" ? result.body : result.body.toString("utf-8"),
        result.status as any,
        headers
      );
    }

    const bodyData = typeof result.body === "string" ? result.body : new Uint8Array(result.body);
    return new Response(bodyData, { status: 200, headers });
  });

  // 2. RPC Methods
  alia.rpc.register(rpcContract, createRpcHandlers(service, alia));

  // 3. CLI Command
  registerCli(alia, service);

  // 4. Native Agent Tools
  registerAgentTools(alia, service);

  alia.agents.configure(() => ({
    tools: ["references_add", "references_list", "references_pin"],
    skills: ["references"],
  }));

  alia.onDispose(() => {
    alia.log.info("References plugin disposed");
  });
}
