// alia-plugin-password-gate — a VesnALIA plugin backend entry.
//
// The default export is a factory that receives the plugin API. This plugin
// puts a password prompt in front of the VesnALIA app: every window is locked until
// the right password is entered.
//
// The password is a secret plugin setting: set it in Settings → Installed
// plugins → Password Gate → "Access password", or from the CLI with
// `alia plugin config password-gate set password`. It is stored in a 0600 file
// under the plugin's secrets directory — never in the db, never in a settings
// payload, and never in the frontend: the browser submits a candidate, the
// server compares it in constant time, and only a boolean comes back.
//
// Because the unlock panel covers the app, a forgotten password cannot be
// cleared from the UI. `alia password-gate reset` opens the gate from a
// terminal; the next password is set in Settings.
//
// "Trust this device" issues an opaque random token the browser may store
// locally, so the password is entered once per device instead of once per
// window. Only the token's SHA-256 hash is persisted, each token expires, and
// every token is pinned to the password it was issued under — changing the
// password invalidates all of them.
//
// The gate is open (and the overlay renders nothing) when no password is set.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

/** Ceiling on stored trusted devices; the oldest are dropped past it. */
const MAX_TRUSTED_DEVICES = 50;

/** Bytes of entropy in a device token. */
const TOKEN_BYTES = 32;

// Both schemas run at the wire boundary. Handler input/output are inferred
// from the shared contract; app.tsx imports only its type.
export const rpcContract = defineRpcContract({
  gate_status: {
    input: z.object({ token: z.string().max(512).nullable() }),
    output: z.object({
      required: z.boolean(),
      trusted: z.boolean(),
    }),
  },
  gate_verify: {
    input: z.object({
      password: z.string().max(4096),
      trust: z.boolean(),
      label: z.string().max(120).optional(),
    }),
    output: z.object({ ok: z.boolean(), token: z.string().nullable() }),
  },
});

/**
 * Binds a device token to the password it was issued under, so rotating the
 * password retires every trusted device instead of leaving them valid.
 */
function passwordFingerprint(password: string): string {
  return createHash("sha256").update(`alia-password-gate:${password}`).digest("hex");
}

/** Tokens are stored hashed: a database read must not yield a usable token. */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compare two strings in constant time. Both sides are hashed first so the
 * comparison never leaks the password length through an early return.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Strip control characters from a value the client supplied before printing it
 * to a terminal. A device label is attacker-controlled (any caller can pass
 * one), so raw escape sequences could repaint the operator's screen.
 */
function printable(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

export default async function plugin(alia: AliaPluginApi) {
  const db = alia.storage.database();
  alia.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      password_fingerprint TEXT NOT NULL
    )`,
  ]);

  const settings = alia.settings.define({
    password: {
      type: "string",
      label: "Access password",
      description:
        "Password required to unlock the app. Leave empty to disable the gate. " +
        "If it is forgotten, run `alia password-gate reset` from a terminal.",
      secret: true,
    },
    trustDays: {
      type: "number",
      label: "Trust a device for (days)",
      description:
        "How long a device stays unlocked after 'Trust this device'. " +
        "Set 0 to disable device trust entirely.",
      default: 30,
    },
  });

  /** The stored password, or null when the gate is open. */
  async function resolvePassword(): Promise<string | null> {
    const { password } = await settings.get();
    return password === undefined || password === "" ? null : password;
  }

  const { trustDays } = await settings.get();
  const trustMs = Math.max(0, trustDays) * 24 * 60 * 60 * 1000;

  alia.log.info(
    `loaded (gate ${(await resolvePassword()) === null ? "open" : "locked"}; trust ${
      trustMs === 0 ? "disabled" : `${trustDays}d`
    })`,
  );

  /** Drop expired rows so the table cannot grow without bound. */
  function prune(): void {
    db.prepare("DELETE FROM trusted_devices WHERE expires_at <= ?").run(Date.now());
  }

  /**
   * Whether a presented token grants access right now: it must be stored, not
   * expired, and pinned to the current password.
   */
  function tokenIsTrusted(token: string, password: string): boolean {
    const row = db
      .prepare(
        "SELECT id, password_fingerprint, expires_at FROM trusted_devices WHERE token_hash = ?",
      )
      .get(tokenHash(token)) as
      | { id: string; password_fingerprint: string; expires_at: number }
      | undefined;
    if (row === undefined) return false;
    if (row.expires_at <= Date.now()) {
      db.prepare("DELETE FROM trusted_devices WHERE id = ?").run(row.id);
      return false;
    }
    if (!safeEqual(row.password_fingerprint, passwordFingerprint(password))) return false;
    db.prepare("UPDATE trusted_devices SET last_seen_at = ? WHERE id = ?").run(
      Date.now(),
      row.id,
    );
    return true;
  }

  alia.rpc.register(rpcContract, {
    gate_status: async ({ token }) => {
      const password = await resolvePassword();
      if (password === null) return { required: false, trusted: false };
      return {
        required: true,
        trusted: token !== null && tokenIsTrusted(token, password),
      };
    },
    gate_verify: async ({ password, trust, label }) => {
      const expected = await resolvePassword();
      // No password configured means the gate is open.
      if (expected === null) return { ok: true, token: null };
      if (!safeEqual(password, expected)) return { ok: false, token: null };
      if (!trust || trustMs === 0) return { ok: true, token: null };

      prune();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const now = Date.now();
      db.prepare(
        `INSERT INTO trusted_devices
           (id, token_hash, label, created_at, last_seen_at, expires_at, password_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        tokenHash(token),
        label === undefined || label.trim() === "" ? "Unknown device" : label.trim(),
        now,
        now,
        now + trustMs,
        passwordFingerprint(expected),
      );
      // Keep only the newest rows.
      db.prepare(
        `DELETE FROM trusted_devices WHERE id NOT IN (
           SELECT id FROM trusted_devices ORDER BY created_at DESC LIMIT ?
         )`,
      ).run(MAX_TRUSTED_DEVICES);
      return { ok: true, token };
    },
  });

  const usage = [
    "Usage:",
    "  VesnALIA password-gate status [--json]",
    "  VesnALIA password-gate reset",
    "  VesnALIA password-gate devices [--json]",
    "  VesnALIA password-gate revoke <device-id>",
    "  VesnALIA password-gate revoke --all",
    "",
    "Set the password in the Settings UI (Installed plugins -> Password Gate)",
    "or with `alia plugin config password-gate set password <value>`.",
    "",
    "`reset` clears a forgotten password and opens the gate. It is the only way",
    "out when the unlock panel is in the way, because the Settings UI is behind",
    "it. It also revokes every trusted device.",
  ].join("\n");

  alia.cli.register({
    name: "password-gate",
    summary: "Inspect, reset, and manage the Password Gate plugin",
    commands: [
      {
        name: "status",
        summary: "Report whether the app is locked",
        usage: "alia password-gate status [--json]",
      },
      {
        name: "reset",
        summary: "Clear a forgotten password, open the gate, and revoke every device",
        usage: "alia password-gate reset",
      },
      {
        name: "devices",
        summary: "List trusted devices that skip the password prompt",
        usage: "alia password-gate devices [--json]",
      },
      {
        name: "revoke",
        summary: "Revoke one trusted device, or every device with --all",
        usage: "alia password-gate revoke <device-id> | --all",
      },
    ],
    async run(argv) {
      const asJson = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command] = args;
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };

        case "status": {
          const password = await resolvePassword();
          if (asJson) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ required: password !== null }),
            };
          }
          return {
            exitCode: 0,
            stdout:
              password === null
                ? "Open (no password configured)"
                : "Locked (password from the stored setting)",
          };
        }

        case "reset": {
          await settings.experimental_set({ password: null });
          const { changes } = db.prepare("DELETE FROM trusted_devices").run();
          alia.log.warn(
            `gate reset from the CLI: password cleared, ${changes} trusted device(s) revoked`,
          );
          return {
            exitCode: 0,
            stdout:
              `Password cleared and ${changes} trusted device(s) revoked. ` +
              "The gate is open; set a new password in Settings -> Installed plugins -> Password Gate.",
          };
        }

        case "devices": {
          prune();
          const devices = db
            .prepare(
              `SELECT id, label, created_at, last_seen_at, expires_at
               FROM trusted_devices WHERE expires_at > ? ORDER BY created_at DESC`,
            )
            .all(Date.now()) as {
            id: string;
            label: string;
            created_at: number;
            last_seen_at: number;
            expires_at: number;
          }[];
          if (asJson) {
            return { exitCode: 0, stdout: JSON.stringify({ devices }) };
          }
          if (devices.length === 0) {
            return { exitCode: 0, stdout: "No trusted devices." };
          }
          const lines = devices.map(
            (device) =>
              `${device.id}  ${printable(device.label)}  expires ${new Date(device.expires_at).toISOString()}`,
          );
          return { exitCode: 0, stdout: lines.join("\n") };
        }

        case "revoke": {
          if (args.includes("--all")) {
            const { changes } = db.prepare("DELETE FROM trusted_devices").run();
            return asJson
              ? { exitCode: 0, stdout: JSON.stringify({ revoked: changes }) }
              : { exitCode: 0, stdout: `Revoked ${changes} trusted device(s).` };
          }
          const id = args[1];
          if (id === undefined) return { exitCode: 1, stderr: usage };
          const { changes } = db
            .prepare("DELETE FROM trusted_devices WHERE id = ?")
            .run(id);
          if (changes === 0) {
            return {
              exitCode: 1,
              stderr: `No trusted device with id ${id}. Run \`alia password-gate devices\`.`,
            };
          }
          return {
            exitCode: 0,
            stdout: asJson ? JSON.stringify({ revoked: 1 }) : "Revoked 1 trusted device.",
          };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // The password is read from settings on every request, so a change applies
  // immediately. `trustDays` is captured at load: reload the plugin after
  // changing it.
  settings.onChange((next, prev) => {
    if (next.trustDays !== prev.trustDays) {
      alia.log.info("trust-days changed; reload the plugin for it to take effect");
    }
  });

  // Cleanup on reload/disable/shutdown.
  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}

