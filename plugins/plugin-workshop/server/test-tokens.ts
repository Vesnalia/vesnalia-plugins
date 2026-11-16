// Test tokens. A test that must see a finding needs a value that is not demonstrably synthetic — but such a value, written out in a source
// file, would make this repository fail its own publication scan (and any other secret scanner). So they are assembled at run time from
// pieces none of which matches a pattern on its own. They are random-looking, not real: no service ever issued them.

const join = (...parts: string[]) => parts.join("");

/** An OpenAI-style key (`sk-…`). */
export const OPENAI_KEY = join("sk", "-proj-", "Q7f2Lm9xVt4Rk8Wn3Jp6Yd1Hc5");
/** A classic GitHub token (`ghp_…`): two labels, `ghp_` and `gh_token`. */
export const GITHUB_TOKEN = join("gh", "p_", "R4nB8vK2qW6zX1cT9mL5pD3sF7hJ0a");
/** A GitHub OAuth token (`gho_…`). */
export const GITHUB_OAUTH = join("gh", "o_", "M3kP9qL2vX7wN4tB8rC1zD6fG5hJ0s");
/** A Slack bot token (`xoxb-…`). */
export const SLACK_TOKEN = join("xo", "xb-", "1234567890-0987654321-Gq7Lm2Vx9Tk4Rw8N");
/** A bearer header value. */
export const BEARER = join("Bea", "rer ", "Zx81LmQ27vTk94RwN3pHy6");
/** A JWT (three base64url segments). */
export const JWT = join("ey", "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "q8Vz2LmT5xR9kW3nJ7pY1dHc4");
/** An AWS access key id. */
export const AWS_KEY = join("AK", "IA", "Q7W2E9R4T6Y1U3I8");
/** A PEM private key block (a random body, not a key). */
export const PEM_KEY = join("-----BEGIN ", "RSA PRIVATE", " KEY-----\nMIIBVQIBADANq9Lm2Vx7Tk4Rw8NpHy6Gq7Lm2Vx9Tk4Rw8NZx81LmQ27vTk94Rw\n-----END ", "RSA PRIVATE", " KEY-----");
/** A private key header of the given kind (`"RSA "`, `"OPENSSH "`, `""`): written out it would be a finding in this very file. */
export const pemHeader = (kind: string, block = false) => join("-----BEGIN ", kind, "PRIVATE", ` KEY${block ? " BLOCK" : ""}-----`);
