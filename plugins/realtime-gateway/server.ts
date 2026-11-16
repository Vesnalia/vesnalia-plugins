// bb-plugin-realtime-gateway — Voice Mode connection for the Vercel AI Gateway.
//
// Voice Mode discovers plugins that publish a `realtimeConnection` rpc and then
// dials the returned wss:// URL from the bb server, carrying the supplied
// headers on the WebSocket handshake. This plugin mints a short-lived gateway
// client secret and returns the gateway realtime URL with the gateway's
// subprotocol-auth header (the same contract @ai-sdk/gateway's
// `experimental_realtime.getToken` implements — see
// vercel/ai: packages/gateway/src/gateway-realtime-auth.ts).
//
// The gateway's realtime WS auth does not accept an Authorization header; the
// credential rides the Sec-WebSocket-Protocol header as
//   ai-gateway-realtime.v1, ai-gateway-auth.<token>[, ai-gateway-team.<b64url>]
// which the gateway turns into an Authorization: Bearer <token> upstream.
//
// The `bb realtime-gateway test` CLI opens a session exactly the way Voice
// Mode's backend does (undici WebSocket + headers) and replays Voice Mode's
// own session.update, so you can verify the handshake and the wire format
// end-to-end before starting a real voice session.
import { WebSocket as UndiciWebSocket } from "undici";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
const PROTOCOL_VERSION = "0.0.1";
const MARKER_SUBPROTOCOL = "ai-gateway-realtime.v1";
const AUTH_PREFIX = "ai-gateway-auth.";
const TEAM_PREFIX = "ai-gateway-team.";

/** Mirrors Voice Mode's RealtimeConnection schema (server.ts). */
const connectionSchema = z.object({
  protocol: z.literal("openai-realtime"),
  url: z.string().url().refine((url) => url.startsWith("wss://"), "url must use wss://"),
  headers: z.record(z.string(), z.string()),
  model: z.string().optional(),
});

export const rpcContract = defineRpcContract({
  realtimeConnection: {
    input: z.object({ refresh: z.boolean().optional() }).default({}),
    output: connectionSchema.extend({
      /** In seconds since the epoch, when the minted secret stops working. */
      expiresAt: z.number().optional(),
      source: z.string(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    aiGatewayApiKey: {
      type: "string",
      label: "Vercel AI Gateway API key",
      description:
        "From vercel.com → AI Gateway → API keys. Stored only on the bb server host.",
      default: "",
      secret: true,
    },
    model: {
      type: "string",
      label: "Realtime model (gateway id)",
      description: "e.g. openai/gpt-realtime-mini (cheapest) or openai/gpt-realtime-2",
      default: "openai/gpt-realtime-mini",
    },
    teamIdOrSlug: {
      type: "string",
      label: "Vercel team id or slug",
      description: "Optional. Only when the key belongs to a specific team scope.",
      default: "",
    },
  });
  const { aiGatewayApiKey, model, teamIdOrSlug } = await settings.get();

  const gatewayKey =
    aiGatewayApiKey.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || "";

  if (!gatewayKey) {
    bb.log.warn(
      "no Vercel AI Gateway key: set aiGatewayApiKey in Settings → Plugins → Realtime Gateway",
    );
  }

  function encodeSubprotocolValue(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** POST with a hard timeout — an indefinite request must never wedge the CLI. */
  async function gatewayPost(path: string, body: unknown): Promise<unknown> {
    bb.log.info(`gatewayPost ${path}`);
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(new URL(path, GATEWAY_ORIGIN), {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayKey}`,
          "content-type": "application/json",
          accept: "application/json",
          "ai-gateway-protocol-version": PROTOCOL_VERSION,
          "ai-gateway-auth-method": "api-key",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const parsed = (await response.json().catch(() => null)) as unknown;
      return { ok: response.ok, status: response.status, body: parsed };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: { error: { message: error instanceof Error ? error.message : String(error) } },
      };
    } finally {
      clearTimeout(kill);
    }
  }

  /** Mint a single-use client secret (`vcst_…`) for the configured model. */
  async function mintClientSecret(): Promise<{ token: string; expiresAt?: number }> {
    if (!gatewayKey) {
      throw new Error(
        "Realtime Gateway has no API key. Set aiGatewayApiKey in Settings → Plugins → Realtime Gateway (Settings → Plugins in the app works too), then reload the plugin.",
      );
    }
    const { ok, status, body } = (await gatewayPost("/v1/realtime/client-secrets", { model })) as {
      ok: boolean;
      status: number;
      body: { token?: string; expiresAt?: number; error?: { message?: string } } | null;
    };
    const result = body ? body : null;
    if (!ok || !result?.token) {
      throw new Error(
        `Gateway client-secret mint failed (${status}): ${
          result?.error?.message ?? "unknown error"
        }`,
      );
    }
    return { token: String(result.token), expiresAt: result.expiresAt };
  }

  async function buildConnection(): Promise<z.infer<typeof connectionSchema> & { expiresAt?: number; source: string }> {
    const { token, expiresAt } = await mintClientSecret();
    // The SDK keeps its baseURL path: default base is https://ai-gateway.vercel.sh/v4/ai,
    // and toGatewayRealtimeUrl appends /realtime-model instead of resolving against the origin.
    const wsUrl = new URL(GATEWAY_ORIGIN.replace(/^http/, "ws") + "/v4/ai/realtime-model");
    wsUrl.searchParams.set("ai-model-id", model);
    const protocols = [MARKER_SUBPROTOCOL, `${AUTH_PREFIX}${token}`];
    if (teamIdOrSlug.trim()) {
      protocols.push(`${TEAM_PREFIX}${encodeSubprotocolValue(teamIdOrSlug.trim())}`);
    }
    // The browser-side SDK sends these as Sec-WebSocket-Protocol. Voice Mode
    // dials from Node (undici), where request headers may set the same field.
    return {
      protocol: "openai-realtime",
      url: wsUrl.toString(),
      headers: { "Sec-WebSocket-Protocol": protocols.join(", ") },
      model: model.split("/").at(-1),
      expiresAt,
      source: `Vercel AI Gateway (${model})`,
    };
  }

  bb.rpc.register(
    rpcContract,
    {
      realtimeConnection: async () => {
        // Secrets are single-use: mint fresh on every call, so `refresh` is a no-op.
        return buildConnection();
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Returns a wss:// realtime session for openai-realtime clients, routed through the Vercel AI Gateway with a freshly minted single-use client secret.",
    },
  );

  const usage = [
    "Usage:",
    "  bb realtime-gateway test [--model <gatewayModelSlug>]",
    "",
    "Mints a client secret and opens a realtime session exactly as Voice",
    "Mode's backend would, sending its own session.update. Prints the first",
    "server events so you can see how the gateway answers raw OpenAI Realtime",
    "wire format (the model id here overrides the plugin setting for this run).",
  ].join("\n");

  bb.cli.register({
    name: "realtime-gateway",
    summary: "Voice Mode realtime sessions through the Vercel AI Gateway",
    commands: [
      {
        name: "test",
        summary: "Mint a secret and probe the gateway realtime wire (one session)",
        usage: "bb realtime-gateway test [--model <openai/gpt-realtime-…>]",
      },
    ],
    async run(argv) {
      const modelFlagIndex = argv.indexOf("--model");
      const probeModel =
        modelFlagIndex >= 0 && argv[modelFlagIndex + 1] ? argv[modelFlagIndex + 1] : model;
      switch (argv[0]) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "test": {
          if (!gatewayKey) {
            return {
              exitCode: 1,
              stderr: "Set aiGatewayApiKey in the plugin settings first.",
            };
          }
          try {
            const answer = await Promise.race([
              runProbe(probeModel),
              new Promise<{ exitCode: number; stdout: string }>((r) =>
                setTimeout(() => r({ exitCode: 0, stdout: "(test deadline: 45s, gave up)" }), 45000),
              ),
            ]);
            return answer;
          } catch (error) {
            return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
          }
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  async function runProbe(probeModel: string): Promise<{ exitCode: number; stdout: string }> {
    const secret = probeModel === model ? await mintClientSecret() : await mintFor(probeModel);
    const wsUrl = new URL(GATEWAY_ORIGIN.replace(/^http/, "ws") + "/v4/ai/realtime-model");
    wsUrl.searchParams.set("ai-model-id", probeModel);
    const protocols = [MARKER_SUBPROTOCOL, `${AUTH_PREFIX}${secret.token}`];
    if (teamIdOrSlug.trim()) {
      protocols.push(`${TEAM_PREFIX}${encodeSubprotocolValue(teamIdOrSlug.trim())}`);
    }
    const events = await probe(
      new UndiciWebSocket(wsUrl.toString(), {
        headers: { "Sec-WebSocket-Protocol": protocols.join(", ") },
      }),
      probeModel,
    );
    return {
      exitCode: 0,
      stdout: [
        `model: ${probeModel}`,
        tokenHint(secret.expiresAt),
        ...events.map((e) => `event: ${e}`),
      ].join("\n"),
    };
  }

  async function mintFor(slug: string) {
    // One-off mint with a different model id; touches the same endpoint.
    const { ok, status, body } = (await gatewayPost("/v1/realtime/client-secrets", {
      model: slug,
    })) as { ok: boolean; status: number; body: { token?: string; expiresAt?: number } | null };
    if (!ok || !body?.token) {
      throw new Error(`mint failed (${status}): ${JSON.stringify(body).slice(0, 300)}`);
    }
    return { token: String(body.token), expiresAt: body.expiresAt };
  }

  function tokenHint(expiresAt?: number): string {
    return expiresAt ? `secret expires at epoch ${expiresAt}` : "no expiry reported";
  }

  /** Bind Voice Mode's exact session.update, collect the first raw server frames. */
  async function probe(socket: unknown, probeModel: string): Promise<string[]> {
    return new Promise((resolve) => {
      const ws = socket as {
        addEventListener(type: string, fn: (ev: never) => void, opts?: unknown): void;
        send(data: string): void;
        close(code?: number): void;
      };
      const seen: string[] = [];
      let done = false;
      let sessionReady = false;
      const finish = (extra?: string) => {
        if (done) return;
        done = true;
        try { ws.close(1000); } catch { /* already closed */ }
        if (extra) seen.push(extra);
        resolve(seen.length ? seen : extra ? [] : ["(no frames received)"]);
      };
      const note = (text: string) => {
        seen.push(text);
        if (seen.length >= 30) finish();
      };
      ws.addEventListener("open", () => {
        seen.push("(open)");
        // Byte-for-byte the session.update Voice Mode sends (voice from settings default).
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "realtime",
              instructions:
                "Test probe: you are a voice assistant. Reply briefly out loud.",
              output_modalities: ["audio"],
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { model: "gpt-4o-mini-transcribe" },
                  turn_detection: { type: "semantic_vad", create_response: true, interrupt_response: true },
                },
                output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
              },
              tool_choice: "none",
            },
          }),
        );
        setTimeout(() => finish("(9s elapsed, closing)") , 9000);
      });
      ws.addEventListener("message", (ev) => {
        let data = (ev as unknown as { data: unknown }).data;
        if (typeof (data as { toString(): string })?.toString === "function" && !(typeof data === "string")) {
          data = (data as unknown as { toString(): string }).toString();
        }
        const str = typeof data === "string" ? data : JSON.stringify(data);
        try {
          const parsed = JSON.parse(str) as Record<string, unknown>;
          let text = String(parsed.type ?? "?");
          if (text === "response.output_audio.delta") {
            text += ` (audio ${String(parsed.delta ?? "").length} bytes)`;
          } else if (text === "error") {
            text += ` ${JSON.stringify((parsed.error ?? parsed) as unknown).slice(0, 400)}`;
          } else {
            const summary = JSON.stringify(parsed).slice(0, 220);
            text += ` ${summary}`;
          }
          note(text);
          // Once the session is configured, drive a text turn through the
          // OpenAI wire format and see what comes back this way.
          const rawType = (parsed.raw as { type?: string } | undefined)?.type;
          if (!sessionReady && (rawType === "session.updated" || text.startsWith("session-updated"))) {
            sessionReady = true;
            ws.send(JSON.stringify({
              type: "conversation.item.create",
              item: { type: "message", role: "user", content: [{ type: "input_text", text: "Say a short cheery hello out loud." }] },
            }));
            ws.send(JSON.stringify({ type: "response.create" }));
          }
        } catch {
          note(str.slice(0, 220));
        }
      });
      ws.addEventListener("close", ({ code, reason }: { code: number; reason: string }) =>
        note(`(close ${code}${reason ? ` ${reason}` : ""})`),
      );
      ws.addEventListener("error", (ev: unknown) => {
        note(`(error ${JSON.stringify((ev as { message?: string }).message ?? ev).slice(0, 300)})`);
      });
      setTimeout(() => finish("(12s fallback)"), 12000);
    });
  }

  bb.onDispose(() => bb.log.info("disposed"));
}
