// Pure detection: nothing here returns, logs, or stores a matched value.
import { createHash } from "node:crypto";

export interface TokenRule {
  kind: string;
  /** Page where the owner can revoke this kind of token. */
  revokeUrl: string;
  source: string;
}

// Only formats with a distinctive prefix. Generic high-entropy matching is out
// on purpose: one false block teaches people to turn the guard off.
export const RULES: readonly TokenRule[] = [
  { kind: "Supabase access token", revokeUrl: "https://supabase.com/dashboard/account/tokens", source: "sbp_[0-9a-f]{32,}" },
  { kind: "Supabase secret key", revokeUrl: "https://supabase.com/dashboard/project/_/settings/api-keys", source: "sb_secret_[A-Za-z0-9_-]{20,}" },
  { kind: "GitHub token", revokeUrl: "https://github.com/settings/tokens", source: "gh[pousr]_[A-Za-z0-9]{36,}" },
  { kind: "GitHub fine-grained token", revokeUrl: "https://github.com/settings/personal-access-tokens", source: "github_pat_[A-Za-z0-9_]{40,}" },
  { kind: "GitLab token", revokeUrl: "https://gitlab.com/-/user_settings/personal_access_tokens", source: "glpat-[A-Za-z0-9_-]{20,}" },
  { kind: "Telegram bot token", revokeUrl: "https://t.me/BotFather", source: "(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])" },
  { kind: "Anthropic API key", revokeUrl: "https://console.anthropic.com/settings/keys", source: "sk-ant-[A-Za-z0-9_-]{32,}" },
  { kind: "OpenAI API key", revokeUrl: "https://platform.openai.com/api-keys", source: "sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}" },
  { kind: "OpenRouter API key", revokeUrl: "https://openrouter.ai/settings/keys", source: "sk-or-v1-[a-f0-9]{32,}" },
  { kind: "Stripe live key", revokeUrl: "https://dashboard.stripe.com/apikeys", source: "(?:sk|rk)_live_[A-Za-z0-9]{20,}" },
  { kind: "Slack token", revokeUrl: "https://api.slack.com/apps", source: "xox[baprs]-[A-Za-z0-9-]{20,}" },
  { kind: "Vercel token", revokeUrl: "https://vercel.com/account/settings/tokens", source: "vc[pk]_[A-Za-z0-9]{24,}" },
  { kind: "npm token", revokeUrl: "https://www.npmjs.com/settings/~/tokens", source: "npm_[A-Za-z0-9]{36}" },
  { kind: "Hugging Face token", revokeUrl: "https://huggingface.co/settings/tokens", source: "hf_[A-Za-z0-9]{34,}" },
  { kind: "AWS access key", revokeUrl: "https://console.aws.amazon.com/iam/home#/security_credentials", source: "AKIA[0-9A-Z]{16}(?![0-9A-Z])" },
  { kind: "Private key", revokeUrl: "", source: "-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----" },
];

// Published documentation samples, not credentials.
const SAMPLE = /EXAMPLE|xxxxxxxx|00000000000000000000/i;
// Longest token the rules accept in practice; the scanner keeps this much
// overlap between chunks.
export const MAX_TOKEN_LENGTH = 512;

const COMBINED = RULES.map((rule, index) => `(?<r${index}>${rule.source})`).join("|");

export interface Finding {
  kind: string;
  revokeUrl: string;
  /** Short hash: tells two tokens apart without revealing either. */
  fingerprint: string;
  /** Offset just past the match, for the chunked scanner. */
  end: number;
}

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function detect(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(new RegExp(COMBINED, "g"))) {
    const value = match[0];
    if (SAMPLE.test(value)) continue;
    const index = RULES.findIndex((_, i) => match.groups?.[`r${i}`] !== undefined);
    const rule = RULES[index];
    if (rule === undefined) continue;
    findings.push({
      kind: rule.kind,
      revokeUrl: rule.revokeUrl,
      fingerprint: fingerprint(value),
      end: (match.index ?? 0) + value.length,
    });
  }
  return findings;
}

export function rejectionMessage(text: string, findings: readonly Finding[]): string {
  const kinds = [...new Set(findings.map((finding) => finding.kind))].join(", ");
  return /[а-яё]/i.test(text)
    ? `Сообщение не отправлено: в нём ${kinds}. В истории чата ключ останется открытым текстом. Уберите его и попросите агента запросить ключ через secrets. Если он уже попадал в чат, отзовите его.`
    : `Message not sent: it contains a ${kinds}. It would stay in the thread history in plain text. Remove it and ask the agent to request the credential through secrets. If it was ever sent before, revoke it.`;
}
