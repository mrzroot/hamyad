/**
 * Secret redaction applied to everything hamyad writes from captured chats,
 * transcripts and diffs (and, by default, to every entry). Conservative on
 * purpose: it is better to mask a harmless hex string than to commit a key.
 */

interface Rule {
  name: string;
  re: RegExp;
  /** replace only this capture group (1-based); default: whole match */
  group?: number;
}

const RULES: Rule[] = [
  { name: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { name: "anthropic", re: /\bsk-ant-[A-Za-z0-9_\-]{16,}/g },
  { name: "openai", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}/g },
  { name: "github", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: "gitlab", re: /\bglpat-[A-Za-z0-9_\-]{20,}/g },
  { name: "aws-key-id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "google", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: "slack", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "stripe", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: "npm", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g },
  { name: "bearer", re: /\b(Bearer|Basic|token)\s+([A-Za-z0-9._~+\/=\-]{20,})/gi, group: 2 },
  { name: "url-credentials", re: /\b([a-z][a-z0-9+.\-]*:\/\/[^\s:@\/]+:)([^\s@\/]{3,})(@)/gi, group: 2 },
  {
    name: "assignment",
    re: /\b((?:api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|access[_-]?token|auth[_-]?token|refresh[_-]?token|private[_-]?key|token)["']?\s*[:=]\s*["']?)([^\s"'`,;]{8,})/gi,
    group: 2,
  },
];

export interface Redaction {
  text: string;
  count: number;
  kinds: string[];
}

export function redact(input: string): Redaction {
  let text = input || "";
  let count = 0;
  const kinds = new Set<string>();
  for (const r of RULES) {
    text = text.replace(r.re, (...m: any[]) => {
      const whole: string = m[0];
      if (r.group) {
        const val: string = m[r.group];
        if (!val || /^\[redacted/.test(val) || /^\$\{?[A-Z_]+\}?$/.test(val) || /^(?:x+|\*+|<[^>]+>|\.\.\.)$/i.test(val)) return whole;
        count++;
        kinds.add(r.name);
        const idx = whole.lastIndexOf(val);
        return whole.slice(0, idx) + `[redacted:${r.name}]` + whole.slice(idx + val.length);
      }
      count++;
      kinds.add(r.name);
      return `[redacted:${r.name}]`;
    });
  }
  return { text, count, kinds: [...kinds] };
}

export const redactText = (s: string) => redact(s).text;
