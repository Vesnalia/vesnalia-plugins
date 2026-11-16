import { describe, expect, it } from "vitest";
import { clampText, scrubText, scrubUrl } from "./scrub.js";

describe("scrubUrl", () => {
  it("keeps only protocol, host, and path", () => {
    expect(scrubUrl("https://user:pass@example.com/a/b?code=SECRET#frag")).toBe(
      "https://example.com/a/b",
    );
  });

  it("handles non-URL input without leaking query strings", () => {
    expect(scrubUrl("not a url?secret=1")).toBe("not a url");
  });
});

describe("scrubText", () => {
  it("redacts quoted and unquoted credential values", () => {
    expect(scrubText('password: "hunter2"')).toBe('password: [redacted]');
    expect(scrubText("apiKey='abcd1234'")).toBe("apiKey=[redacted]");
    expect(scrubText('"token": "eyJhbGciOi.payload"')).toBe('"token": [redacted]');
    expect(scrubText("auth bearer=abcd1234secretvalue")).toContain("[redacted]");
    expect(scrubText("auth bearer=abcd1234secretvalue")).not.toContain("abcd1234secretvalue");
  });

  it("redacts Authorization Bearer tokens", () => {
    const scrubbed = scrubText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(scrubbed).toContain("Bearer");
    expect(scrubbed).toContain("[redacted]");
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("strips query strings from embedded URLs in error text", () => {
    const scrubbed = scrubText("net::ERR_FAILED at https://example.com/cb?code=OAUTH&state=x");
    expect(scrubbed).not.toContain("OAUTH");
    expect(scrubbed).not.toContain("?code=");
    expect(scrubbed).toContain("https://example.com/cb");
  });

  it("redacts long hashes and clamps length", () => {
    expect(scrubText("hash 0123456789abcdef0123456789abcdef0123456789abcdef")).not.toContain(
      "0123456789abcdef0123456789abcdef",
    );
    expect(clampText("abcdef", 4)).toBe("abc…");
    expect(clampText("abc", 4)).toBe("abc");
  });
});

describe("R7 bounded credentials", () => {
  it.each(['"', "'"])("redacts unterminated %s values at the producer cutoff", quote => {
    const input = `password: ${quote}${"SYNTHETIC_SECRET_".repeat(300)}${quote}`;
    const output = scrubText(clampText(input, 2000));
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("SYNTHETIC_SECRET");
  });
});
