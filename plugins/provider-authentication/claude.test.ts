import { describe, expect, it } from "vitest";
import {
  appendBoundedOutput,
  extractClaudeConsentUrl,
  parseClaudeStatus,
} from "./claude.js";

const consentUrl =
  "https://claude.com/cai/oauth/authorize?response_type=code&state=state-1&code_challenge=challenge-1";

describe("Claude CLI parsing", () => {
  it("extracts a validated consent URL from OSC-8 output split across chunks", () => {
    let output = "";
    output = appendBoundedOutput(output, "If the browser didn't open: \u001b]8;;https://cla");
    output = appendBoundedOutput(
      output,
      "ude.com/cai/oauth/authorize?response_type=code&state=state-1&code_challenge=challenge-1\u0007Open\u001b]8;;\u0007",
    );

    expect(extractClaudeConsentUrl(output)).toBe(consentUrl);
  });

  it("rejects lookalike hosts and incomplete OAuth URLs", () => {
    expect(
      extractClaudeConsentUrl(
        "https://claude.com.example/cai/oauth/authorize?response_type=code&state=x&code_challenge=y",
      ),
    ).toBeNull();
    expect(
      extractClaudeConsentUrl(
        "https://claude.com/cai/oauth/authorize?response_type=code&state=x",
      ),
    ).toBeNull();
  });

  it("bounds accumulated process output", () => {
    const output = appendBoundedOutput("a".repeat(65_000), "b".repeat(2_000));
    expect(output).toHaveLength(65_536);
    expect(output.endsWith("b".repeat(2_000))).toBe(true);
  });

  it("parses signed-out and signed-in status JSON", () => {
    expect(
      parseClaudeStatus(
        JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }),
      ),
    ).toEqual({ kind: "signed-out" });
    expect(
      parseClaudeStatus(
        JSON.stringify({
          loggedIn: true,
          email: "person@example.com",
          orgName: "Example",
          subscriptionType: "max",
        }),
      ),
    ).toEqual({
      kind: "signed-in",
      identity: "person@example.com",
      organization: "Example",
      subscription: "max",
    });
  });

  it("rejects malformed status output", () => {
    expect(parseClaudeStatus("not json")).toBeNull();
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: "yes" }))).toBeNull();
  });
});
