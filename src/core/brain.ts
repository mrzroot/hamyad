import type { Backend } from "./backend.js";
import { BrainConfig, mergeConfig } from "./config.js";
import {
  Entry,
  Kind,
  KINDS,
  defaultStatus,
  entryPath,
  isKind,
  newId,
  normalizeText,
  parseEntry,
  serializeEntry,
} from "./entry.js";

export interface AddInput {
  kind: Kind;
  title: string;
  body?: string;
  tags?: string[];
  status?: string;
  source?: string;
}

export interface UpdateInput {
  title?: string;
  body?: string;
  append?: string;
  status?: string;
  tags?: string[];
  source?: string;
}

export interface ListFilter {
  kind?: Kind;
  status?: string;
  tag?: string;
  since?: string;
  limit?: number;
}

export interface Snapshot {
  config: BrainConfig;
  entries: Entry[];
}

/** The project brain: a typed view over the `.brain/` folder of a backend. */
export class Brain {
  constructor(
    readonly backend: Backend,
    readonly opts: { source?: string; now?: () => Date } = {},
  ) {}

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  async snapshot(): Promise<Snapshot> {
    const files = await this.backend.readAll();
    let config = mergeConfig({});
    const entries: Entry[] = [];
    for (const f of files) {
      if (f.path === "config.json") {
        try {
          config = mergeConfig(JSON.parse(f.content));
        } catch {
          /* keep defaults */
        }
        continue;
      }
      if (!f.path.endsWith(".md") || !f.path.includes("/")) continue;
      const e = parseEntry(f.path, f.content, f.sha);
      if (e) entries.push(e);
    }
    entries.sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created) || a.id.localeCompare(b.id));
    return { config, entries };
  }

  async add(input: AddInput): Promise<Entry> {
    if (!isKind(input.kind)) throw new Error(`unknown kind "${input.kind}" (use one of ${KINDS.join(", ")})`);
    const title = (input.title || "").trim().replace(/\s+/g, " ");
    if (!title) throw new Error("title is required");
    const now = this.now();
    const ts = now.toISOString();
    const id = newId(input.kind, now);
    const e: Entry = {
      id,
      kind: input.kind,
      title: title.slice(0, 200),
      body: (input.body || "").trim(),
      status: input.status || defaultStatus(input.kind),
      tags: cleanTags(input.tags),
      source: input.source || this.opts.source || "cli",
      created: ts,
      updated: ts,
      path: entryPath(input.kind, id, title),
    };
    const res = await this.backend.write(e.path, serializeEntry(e), `brain: add ${e.kind} "${short(e.title)}" [${e.source}]`);
    e.sha = res.sha;
    return e;
  }

  async get(idOrPrefix: string): Promise<Entry | undefined> {
    const { entries } = await this.snapshot();
    return findEntry(entries, idOrPrefix);
  }

  async update(idOrPrefix: string, patch: UpdateInput): Promise<Entry> {
    const { entries } = await this.snapshot();
    const e = findEntry(entries, idOrPrefix);
    if (!e) throw new Error(`no entry matches "${idOrPrefix}"`);
    const next: Entry = { ...e, tags: [...e.tags] };
    if (patch.title) next.title = patch.title.trim();
    if (patch.body !== undefined) next.body = patch.body.trim();
    if (patch.append) {
      const stamp = this.now().toISOString().slice(0, 16).replace("T", " ");
      const src = patch.source || this.opts.source || "cli";
      next.body = `${next.body}\n\n**${stamp} (${src})** ${patch.append.trim()}`.trim();
    }
    if (patch.status) next.status = patch.status;
    if (patch.tags) next.tags = cleanTags(patch.tags);
    next.updated = this.now().toISOString();
    const res = await this.backend.write(
      e.path,
      serializeEntry(next),
      `brain: update ${e.kind} "${short(next.title)}"${patch.status ? ` -> ${patch.status}` : ""} [${patch.source || this.opts.source || "cli"}]`,
      e.sha,
    );
    next.sha = res.sha;
    return next;
  }

  async list(filter: ListFilter = {}): Promise<Entry[]> {
    const { entries } = await this.snapshot();
    return filterEntries(entries, filter);
  }

  async search(query: string, filter: ListFilter = {}): Promise<Entry[]> {
    const { entries } = await this.snapshot();
    return searchEntries(filterEntries(entries, { ...filter, limit: undefined }), query).slice(0, filter.limit ?? 10);
  }
}

export function cleanTags(tags?: string[] | string): string[] {
  const arr = typeof tags === "string" ? tags.split(",") : tags || [];
  return [...new Set(arr.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))].slice(0, 12);
}

export function findEntry(entries: Entry[], idOrPrefix: string): Entry | undefined {
  const q = idOrPrefix.trim();
  if (!q) return undefined;
  return (
    entries.find((e) => e.id === q) ||
    entries.find((e) => e.path === q || e.path.endsWith("/" + q) || e.path.endsWith("/" + q + ".md")) ||
    (() => {
      const hits = entries.filter((e) => e.id.startsWith(q) || e.id.endsWith(q));
      return hits.length === 1 ? hits[0] : undefined;
    })()
  );
}

export function filterEntries(entries: Entry[], f: ListFilter): Entry[] {
  let out = entries;
  if (f.kind) out = out.filter((e) => e.kind === f.kind);
  if (f.status) out = out.filter((e) => (e.status || "") === f.status);
  if (f.tag) out = out.filter((e) => e.tags.includes(f.tag!));
  if (f.since) out = out.filter((e) => (e.updated || e.created) >= f.since!);
  return f.limit ? out.slice(0, f.limit) : out;
}

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

export function searchEntries(entries: Entry[], query: string): Entry[] {
  const q = tokens(query);
  if (!q.length) return entries;
  const phrase = normalizeText(query).trim();
  const scored = entries.map((e) => {
    const title = normalizeText(e.title);
    const tags = normalizeText(e.tags.join(" "));
    const body = normalizeText(e.body);
    let score = 0;
    for (const t of q) {
      if (title.includes(t)) score += 3;
      if (tags.includes(t)) score += 2;
      if (body.includes(t)) score += 1;
    }
    if (phrase.length > 3 && (title + " " + body).includes(phrase)) score += 4;
    if (score > 0 && e.kind === "decision" && e.status === "active") score += 0.5;
    if (score > 0 && (e.status === "superseded" || e.status === "dropped")) score = Math.max(0.1, score - 1);
    return { e, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.e.updated || "").localeCompare(a.e.updated || ""))
    .map((s) => s.e);
}

function short(s: string, n = 60) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
