import type { Backend } from "./backend.js";
import { BrainConfig, mergeConfig } from "./config.js";
import { redactText } from "./redact.js";
import {
  Entry,
  SUPERSEDABLE,
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
  /** ids of older entries this one replaces; they are marked superseded and linked */
  supersedes?: string[];
  /** capture key `<tool>:<session id>` (session/change entries) */
  session?: string;
}

export interface UpdateInput {
  title?: string;
  body?: string;
  append?: string;
  status?: string;
  tags?: string[];
  source?: string;
  supersededBy?: string;
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
    readonly opts: { source?: string; now?: () => Date; redact?: boolean; afterWrite?: () => Promise<void> | void } = {},
  ) {}

  private clean(s: string | undefined): string {
    return this.opts.redact === false ? s || "" : redactText(s || "");
  }

  private async written() {
    if (this.opts.afterWrite) await this.opts.afterWrite();
  }

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
    const title = this.clean((input.title || "").trim().replace(/\s+/g, " "));
    if (!title) throw new Error("title is required");
    const known = input.supersedes?.length ? (await this.snapshot()).entries : [];
    const olds = (input.supersedes || []).map((id) => {
      const o = findEntry(known, id);
      if (!o) throw new Error(`supersedes: no entry matches "${id}"`);
      return o;
    });
    const now = this.now();
    const ts = now.toISOString();
    const id = newId(input.kind, now);
    const e: Entry = {
      id,
      kind: input.kind,
      title: title.slice(0, 200),
      body: this.clean(input.body).trim(),
      status: input.status || defaultStatus(input.kind),
      tags: cleanTags(input.tags),
      source: input.source || this.opts.source || "cli",
      created: ts,
      updated: ts,
      path: entryPath(input.kind, id, title),
      ...(olds.length ? { supersedes: olds.map((o) => o.id) } : {}),
      ...(input.session ? { session: input.session } : {}),
    };
    const res = await this.backend.write(e.path, serializeEntry(e), `brain: add ${e.kind} "${short(e.title)}" [${e.source}]`);
    e.sha = res.sha;
    for (const o of olds) await this.markSuperseded(o, e);
    await this.written();
    return e;
  }

  /** Mark `old` as superseded by `by` (status, back-link and a dated note). */
  private async markSuperseded(old: Entry, by: Entry): Promise<Entry> {
    const next: Entry = { ...old, tags: [...old.tags], status: "superseded", supersededBy: by.id, updated: this.now().toISOString() };
    const stamp = next.updated.slice(0, 16).replace("T", " ");
    next.body = `${old.body}\n\n**${stamp} (${by.source})** Superseded by \`${by.id}\`: ${by.title}`.trim();
    const res = await this.backend.write(
      old.path,
      serializeEntry(next),
      `brain: supersede ${old.kind} "${short(old.title)}" -> ${by.id} [${by.source}]`,
      old.sha,
    );
    next.sha = res.sha;
    return next;
  }

  /** Mark `oldId` superseded by the existing entry `newId`. */
  async supersede(oldId: string, newId: string): Promise<{ old: Entry; by: Entry }> {
    const { entries } = await this.snapshot();
    const old = findEntry(entries, oldId);
    const by = findEntry(entries, newId);
    if (!old) throw new Error(`no entry matches "${oldId}"`);
    if (!by) throw new Error(`no entry matches "${newId}"`);
    if (old.id === by.id) throw new Error("an entry cannot supersede itself");
    const updated = await this.markSuperseded(old, by);
    if (!(by.supersedes || []).includes(old.id)) {
      const nb: Entry = { ...by, supersedes: [...(by.supersedes || []), old.id] };
      const res = await this.backend.write(by.path, serializeEntry(nb), `brain: link ${by.id} supersedes ${old.id}`, by.sha);
      nb.sha = res.sha;
      await this.written();
      return { old: updated, by: nb };
    }
    await this.written();
    return { old: updated, by };
  }

  /** Active entries of the same kind that look like they say something about the same topic. */
  async conflicts(input: { kind: Kind; title: string; body?: string; tags?: string[] }, excludeId?: string): Promise<Entry[]> {
    if (!SUPERSEDABLE.includes(input.kind)) return [];
    const { entries } = await this.snapshot();
    return findConflicts(entries, input, excludeId);
  }

  /** Create or update the entry captured for `session` (a `<tool>:<id>` key). */
  async upsertCaptured(kind: Kind, session: string, input: Omit<AddInput, "kind" | "session">): Promise<Entry> {
    const { entries } = await this.snapshot();
    const e = entries.find((x) => x.kind === kind && x.session === session);
    if (!e) return this.add({ ...input, kind, session });
    const body = this.clean(input.body).trim();
    const title = this.clean(input.title).trim().slice(0, 200);
    if (e.body === body && e.title === title) return e;
    const next: Entry = { ...e, title, body, tags: input.tags ? cleanTags(input.tags) : e.tags, updated: this.now().toISOString() };
    const res = await this.backend.write(e.path, serializeEntry(next), `brain: update ${kind} "${short(title)}" [${e.source}]`, e.sha);
    next.sha = res.sha;
    await this.written();
    return next;
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
    if (patch.title) next.title = this.clean(patch.title.trim());
    if (patch.body !== undefined) next.body = this.clean(patch.body).trim();
    if (patch.supersededBy) next.supersededBy = patch.supersededBy;
    if (patch.append) {
      const stamp = this.now().toISOString().slice(0, 16).replace("T", " ");
      const src = patch.source || this.opts.source || "cli";
      next.body = `${next.body}\n\n**${stamp} (${src})** ${this.clean(patch.append.trim())}`.trim();
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
    await this.written();
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

function topicTokens(s: string): Set<string> {
  const stop = new Set(["the", "and", "for", "with", "use", "using", "will", "should", "from", "into", "this", "that", "are", "not", "our", "all", "از", "به", "با", "در", "که", "را", "این", "برای", "استفاده", "می", "شود", "کنیم"]);
  return new Set(
    normalizeText(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !stop.has(t)),
  );
}

/**
 * Heuristic: same kind, still in force, and the titles share enough topic words
 * (or share a tag plus one word). Used to *suggest* supersession; hamyad never
 * supersedes on its own without an explicit id.
 */
export function findConflicts(entries: Entry[], input: { kind: Kind; title: string; body?: string; tags?: string[] }, excludeId?: string): Entry[] {
  const a = topicTokens(input.title);
  if (!a.size) return [];
  const tags = new Set(cleanTags(input.tags).map((t) => normalizeText(t)));
  const out: { e: Entry; score: number }[] = [];
  for (const e of entries) {
    if (e.id === excludeId || e.kind !== input.kind) continue;
    if (e.status === "superseded" || e.status === "reverted" || e.status === "dropped") continue;
    const b = topicTokens(e.title);
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    const tagHit = e.tags.some((t) => tags.has(normalizeText(t)));
    const score = shared / Math.max(1, Math.min(a.size, b.size)) + (tagHit ? 0.34 : 0);
    if ((shared >= 2 && score >= 0.5) || (shared >= 1 && tagHit) || score >= 0.99) out.push({ e, score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 5).map((x) => x.e);
}

export interface ChangeSet {
  /** decisions/context added since `since` (excluding superseded ones) */
  added: Entry[];
  /** entries that were superseded since `since`, with the replacing entry */
  superseded: { old: Entry; by?: Entry }[];
  /** tasks whose status changed or that were added */
  tasks: Entry[];
  /** session summaries from other tools */
  sessions: Entry[];
  /** other new notes */
  notes: Entry[];
}

/** What changed in the brain since `since`, ignoring entries written by `self` (the asking tool). */
export function changesSince(entries: Entry[], since: string | undefined, self?: string): ChangeSet {
  const cs: ChangeSet = { added: [], superseded: [], tasks: [], sessions: [], notes: [] };
  if (!since) return cs;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const fresh = (e: Entry) => (e.updated || e.created) > since;
  const other = (e: Entry) => !self || e.source !== self;
  for (const e of entries) {
    if (!fresh(e)) continue;
    if (e.status === "superseded" && e.supersededBy) {
      const by = byId.get(e.supersededBy);
      if (!self || (by ? by.source !== self : true)) cs.superseded.push({ old: e, by });
      continue;
    }
    if (!other(e)) continue;
    if (e.kind === "decision" || e.kind === "context") cs.added.push(e);
    else if (e.kind === "task") cs.tasks.push(e);
    else if (e.kind === "session") cs.sessions.push(e);
    else if (e.kind === "note") cs.notes.push(e);
  }
  return cs;
}

export function isEmptyChangeSet(c: ChangeSet): boolean {
  return !c.added.length && !c.superseded.length && !c.tasks.length && !c.sessions.length && !c.notes.length;
}
