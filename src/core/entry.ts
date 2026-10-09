/**
 * Entries are small Markdown files with a YAML-ish frontmatter block.
 * They live in `.brain/<folder>/<id>-<slug>.md` so that humans, GitHub and
 * Claude's GitHub integration can all read them without any tooling.
 */

export const KINDS = ["decision", "task", "note", "context", "session", "change"] as const;
export type Kind = (typeof KINDS)[number];

export const TASK_STATUSES = ["open", "doing", "blocked", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const DECISION_STATUSES = ["active", "superseded", "reverted"] as const;
/** Kinds whose entries state something that later entries can replace. */
export const SUPERSEDABLE: readonly Kind[] = ["decision", "context", "note"];

export const FOLDER: Record<Kind, string> = {
  decision: "decisions",
  task: "tasks",
  note: "notes",
  context: "context",
  session: "sessions",
  change: "changes",
};

const PREFIX: Record<Kind, string> = { decision: "d", task: "t", note: "n", context: "c", session: "s", change: "x" };

export interface Entry {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  status?: string;
  tags: string[];
  source: string;
  created: string;
  updated: string;
  /** path relative to the brain dir, e.g. `decisions/d-20261009-ab12-use-sqlite.md` */
  path: string;
  /** opaque version token from the backend (git blob sha on GitHub) */
  sha?: string;
  /** ids of older entries this one replaces */
  supersedes?: string[];
  /** id of the entry that replaced this one */
  supersededBy?: string;
  /** capture key `<tool>:<session id>` for session/change entries written by hooks and importers */
  session?: string;
}

export function isKind(k: unknown): k is Kind {
  return typeof k === "string" && (KINDS as readonly string[]).includes(k);
}

export function kindFromFolder(folder: string): Kind | undefined {
  return KINDS.find((k) => FOLDER[k] === folder);
}

export function defaultStatus(kind: Kind): string | undefined {
  if (kind === "task") return "open";
  if (kind === "decision") return "active";
  return undefined;
}

/** Latin + Persian friendly slug. Keeps Persian letters, drops punctuation. */
export function slugify(title: string, max = 48): string {
  const s = normalizeText(title)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "entry";
}

/**
 * Normalisation used for slugs and search: lower-case, Arabic -> Persian
 * letters (ي ك ة), strip ZWNJ/diacritics/tatweel, Persian/Arabic digits -> ASCII.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u200C\u200D\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function newId(kind: Kind, now = new Date(), rand = Math.random): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  let r = "";
  for (let i = 0; i < 4; i++) r += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rand() * 32)];
  return `${PREFIX[kind]}-${ymd}-${r}`;
}

export function entryPath(kind: Kind, id: string, title: string): string {
  return `${FOLDER[kind]}/${id}-${slugify(title)}.md`;
}

// ---------------------------------------------------------------- frontmatter

function quote(v: string): string {
  if (v === "" || /[:#\[\]{},"'\n]|^\s|\s$|^[-?!&*|>%@`]/.test(v)) return JSON.stringify(v);
  return v;
}

function unquote(v: string): string {
  v = v.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

export function serializeEntry(e: Entry): string {
  const lines = ["---", `id: ${e.id}`, `kind: ${e.kind}`, `title: ${quote(e.title)}`];
  if (e.status) lines.push(`status: ${quote(e.status)}`);
  lines.push(`tags: [${e.tags.map(quote).join(", ")}]`);
  lines.push(`source: ${quote(e.source)}`, `created: ${e.created}`, `updated: ${e.updated}`);
  if (e.supersedes?.length) lines.push(`supersedes: [${e.supersedes.map(quote).join(", ")}]`);
  if (e.supersededBy) lines.push(`superseded_by: ${quote(e.supersededBy)}`);
  if (e.session) lines.push(`session: ${quote(e.session)}`);
  lines.push("---", "");
  const body = e.body.replace(/\s+$/, "");
  return lines.join("\n") + (body ? body + "\n" : "");
}

export function parseEntry(path: string, text: string, sha?: string): Entry | undefined {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const folder = path.split("/")[0];
  const fileKind = kindFromFolder(folder);
  const meta: Record<string, string> = {};
  let body = text;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
      if (kv) meta[kv[1]] = kv[2];
    }
  }
  const kind = isKind(meta.kind) ? meta.kind : fileKind;
  if (!kind) return undefined;
  const base = path.split("/").pop()!.replace(/\.md$/, "");
  const id = meta.id ? unquote(meta.id) : base;
  const list = (v?: string) => {
    if (!v) return [];
    const t = v.trim();
    const inner = t.startsWith("[") && t.endsWith("]") ? t.slice(1, -1) : t;
    return splitList(inner).map(unquote).filter(Boolean);
  };
  const tags = list(meta.tags);
  const supersedes = list(meta.supersedes);
  // Hand-written files without frontmatter: first heading becomes the title.
  let title = meta.title ? unquote(meta.title) : "";
  if (!title) {
    const h = /^#\s+(.+)$/m.exec(body);
    title = h ? h[1].trim() : base;
  }
  return {
    id,
    kind,
    title,
    body: body.replace(/^\r?\n/, "").replace(/\s+$/, ""),
    status: meta.status ? unquote(meta.status) : defaultStatus(kind),
    tags,
    source: meta.source ? unquote(meta.source) : "file",
    created: meta.created ? unquote(meta.created) : "",
    updated: meta.updated ? unquote(meta.updated) : meta.created ? unquote(meta.created) : "",
    path,
    sha,
    ...(supersedes.length ? { supersedes } : {}),
    ...(meta.superseded_by ? { supersededBy: unquote(meta.superseded_by) } : {}),
    ...(meta.session ? { session: unquote(meta.session) } : {}),
  };
}

function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
