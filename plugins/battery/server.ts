import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { describeBattery, parsePmset, type BatteryReading } from "./lib/battery.ts";

const run = promisify(execFile);

async function readBattery(): Promise<BatteryReading | null> {
  if (process.platform !== "darwin") return null;
  const { stdout } = await run("pmset", ["-g", "batt"], { timeout: 5_000 });
  return parsePmset(stdout);
}

export default async function plugin(alia: AliaPluginApi) {
  alia.http.route("GET", "/status", async (context) => context.json({ reading: await readBattery() }));

  alia.cli.register({
    name: "battery",
    summary: "Show the server machine's battery charge",
    commands: [{ name: "status", summary: "Print charge, state and time left", usage: "alia battery status [--json]" }],
    async run(argv) {
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command !== undefined && command !== "status") {
        return { exitCode: 1, stderr: "Usage: VesnALIA battery status [--json]" };
      }
      const reading = await readBattery();
      return {
        exitCode: 0,
        stdout: argv.includes("--json") ? JSON.stringify({ reading }) : describeBattery(reading),
      };
    },
  });
}
