import { describe, expect, it } from "vitest";
import { AliaUnavailableError, createAliaRunner, resolveAliaPath } from "./cli";

describe("resolveAliaPath", () => {
  it("prefers the setting over everything else", () => {
    const path = resolveAliaPath({
      configured: "/opt/custom/alia",
      envPath: "/injected/alia",
      exists: () => true,
    });
    expect(path).toBe("/opt/custom/alia");
  });

  it("uses the path VesnALIA injected when the setting is empty", () => {
    const path = resolveAliaPath({ configured: "  ", envPath: "/injected/alia", exists: () => true });
    expect(path).toBe("/injected/alia");
  });

  it("falls back to an install location, since the server's PATH is not a shell's", () => {
    const path = resolveAliaPath({
      exists: (candidate) => candidate === "/usr/local/bin/alia",
    });
    expect(path).toBe("/usr/local/bin/alia");
  });

  it("settles for bare VesnALIA when nothing else matched", () => {
    expect(resolveAliaPath({ exists: () => false })).toBe("alia");
  });
});

describe("createAliaRunner", () => {
  it("names the setting when the CLI is not where it looked", async () => {
    const runner = createAliaRunner("/nonexistent/alia");
    const error = await runner.run(["automation", "list"]).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AliaUnavailableError);
    expect((error as AliaUnavailableError).message).toContain("aliaPath");
  });
});
