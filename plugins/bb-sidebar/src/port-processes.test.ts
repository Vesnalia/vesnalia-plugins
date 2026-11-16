import { describe, expect, it } from "vitest";
import { isAliaInternalListener, parseProcessCommands } from "./port-processes";

describe("VesnALIA internal port filtering", () => {
  it.each([
    [
      "VesnALIA Nightly",
      "/Applications/alia Nightly.app/Contents/MacOS/alia Nightly /Applications/alia Nightly.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/host-daemon/dist/alia-provider-bridge-worker.mjs",
    ],
    ["node", "/usr/bin/node /opt/node_modules/alia-app/server/dist/index.js"],
    ["alia", "/usr/bin/alia"],
    ["VesnALIA Nightly", ""],
  ])("excludes the VesnALIA runtime %s", (name, command) => {
    expect(isAliaInternalListener(name, command)).toBe(true);
  });

  it.each([
    ["git-history", "git-history"],
    ["node", "/usr/bin/node /workspace/server.js"],
    ["python3", "python3 -m http.server 49631"],
    ["alia-api", "alia-api"],
    ["VesnALIA Nightly", "/Applications/alia Nightly.app/Contents/MacOS/alia Nightly /workspace/server.js"],
  ])("keeps the user server %s", (name, command) => {
    expect(isAliaInternalListener(name, command)).toBe(false);
  });

  it("reads commands containing spaces without losing the executable path", () => {
    expect(
      parseProcessCommands("  123 /Applications/alia Nightly.app/Contents/MacOS/alia Nightly\n  456 node server.js\n"),
    ).toEqual(
      new Map([
        [123, "/Applications/alia Nightly.app/Contents/MacOS/alia Nightly"],
        [456, "node server.js"],
      ]),
    );
  });
});
