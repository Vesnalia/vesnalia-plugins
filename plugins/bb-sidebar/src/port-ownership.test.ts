import { describe, expect, it } from "vitest";
import { macProcessEnvironment, threadIdFromEnvironment } from "./port-ownership";

describe("listener ownership", () => {
  it("reads an explicit thread marker on Linux and macOS", () => {
    expect(threadIdFromEnvironment("PATH=/bin\0BB_THREAD_ID=thr_owner\0", "nul")).toBe("thr_owner");
    expect(threadIdFromEnvironment("PATH=/bin ALIA_THREAD_ID=thr_owner", "space")).toBe("thr_owner");
  });
  it("leaves missing, malformed, or ambiguous metadata unassigned", () => {
    for (const value of ["PATH=/bin", "ALIA_THREAD_ID=", "ALIA_THREAD_ID=bad", "ALIA_THREAD_ID=thr_a ALIA_THREAD_ID=thr_b"]) {
      expect(threadIdFromEnvironment(value, "space")).toBeUndefined();
    }
  });
  it("excludes command arguments and rejects changed commands", () => {
    const command = "node server.js ALIA_THREAD_ID=thr_wrong";
    const environment = macProcessEnvironment(command, `${command} PATH=/bin ALIA_THREAD_ID=thr_right`);
    expect(threadIdFromEnvironment(environment, "space")).toBe("thr_right");
    expect(macProcessEnvironment("node old.js", "node new.js ALIA_THREAD_ID=thr_owner")).toBe("");
    expect(macProcessEnvironment("", "ALIA_THREAD_ID=thr_owner")).toBe("");
  });
});
