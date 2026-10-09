import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureEnabled } from "../core/config.js";
import type { Entry } from "../core/entry.js";
import { toolLabel } from "../core/tools.js";
import { git } from "./git.js";
import { sessionBody } from "./hooks.js";
import { Project, readState, regenerate, writeState } from "./project.js";
import { parseAiderHistory, parseTranscript, Transcript } from "./transcripts.js";

/**
 * Transcript importers: read each tool's own local session logs and turn the
 * sessions that belong to this project into brain entries. Covers tools and
 * sessions the hooks never saw (aider, hooks not installed yet, other machines'
 * logs copied over). Idempotent: one entry per `<tool>:<session id>`.
 */

export const IMPORT_TOOLS = ["claude-code", "codex", "gemini-cli", "copilot", "cursor", "windsurf", "aider"] as const;

const home = () => os.homedir();

function walk(dir: string, re: RegExp, depth = 5, out: string[] = []): string[] {
  if (depth < 0 || !existsSync(dir)) return out;
  let items: import("node:fs").Dirent[] = [];
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    const f = path.join(dir, it.name);
    if (it.isDirectory()) walk(f, re, depth - 1, out);
    else if (re.test(it.name)) out.push(f);
  }
  return out;
}

function head(file: string, bytes = 65536): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const inside = (child: string | undefined, root: string) => {
  if (!child) return false;
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export const claudeProjectDir = (root: string) => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home(), ".claude"), "projects", root.replace(/[^a-zA-Z0-9]/g, "-"));

/** Candidate transcript files for `tool` that may belong to `root`. */
export function discover(tool: string, root: string): string[] {
  switch (tool) {
    case "claude-code":
      return walk(claudeProjectDir(root), /\.jsonl$/, 0);
    case "codex": {
      const base = process.env.CODEX_HOME || path.join(home(), ".codex");
      return [...walk(path.join(base, "sessions"), /^rollout-.*\.jsonl$/), ...walk(path.join(base, "archived_sessions"), /^rollout-.*\.jsonl$/)].filter((f) => {
        try {
          const first = JSON.parse(head(f, 32768).split("\n")[0]);
          return inside(first?.payload?.cwd, root);
        } catch {
          return false;
        }
      });
    }
    case "gemini-cli": {
      const base = path.join(process.env.GEMINI_CLI_HOME || home(), ".gemini");
      const names = new Set<string>([createHash("sha256").update(root).digest("hex")]);
      try {
        const pj = JSON.parse(readFileSync(path.join(base, "projects.json"), "utf8"));
        for (const [k, v] of Object.entries(pj.projects || {})) if (path.resolve(k) === path.resolve(root)) names.add(String(v));
      } catch {
        /* none */
      }
      return [...names].flatMap((n) => walk(path.join(base, "tmp", n, "chats"), /\.jsonl?$/, 0));
    }
    case "copilot": {
      const base = process.env.COPILOT_HOME || path.join(home(), ".copilot");
      return walk(path.join(base, "session-state"), /^events\.jsonl$/, 1).filter((f) => {
        try {
          const d = JSON.parse(head(f, 32768).split("\n")[0])?.data;
          return inside(d?.context?.gitRoot || d?.context?.cwd, root);
        } catch {
          return false;
        }
      });
    }
    case "cursor": {
      const base = path.join(home(), ".cursor", "projects");
      const abs = path.resolve(root);
      const slugs = new Set([abs.replace(/^[/\\]+/, "").replace(/[/\\:]+/g, "-"), abs.replace(/^[/\\]+/, "").replace(/[^a-zA-Z0-9]+/g, "-")]);
      return [...slugs].flatMap((s) => walk(path.join(base, s, "agent-transcripts"), /\.(jsonl|txt|json)$/, 1));
    }
    case "windsurf":
      return walk(path.join(home(), ".windsurf", "transcripts"), /\.jsonl$/, 0);
    case "aider": {
      const f = process.env.AIDER_CHAT_HISTORY_FILE || path.join(root, ".aider.chat.history.md");
      return existsSync(f) ? [f] : [];
    }
  }
  return [];
}

function commitsInWindow(root: string, from?: string, to?: string): string[] {
  if (!from) return [];
  const args = ["log", `--since=${from}`, "--format=%h %an: %s", "-n", "20"];
  if (to) args.push(`--until=${new Date(Date.parse(to) + 120000).toISOString()}`);
  const r = git(root, args, { allowFail: true });
  return r.ok ? r.out.split("\n").filter((l) => l && !/ brain:/.test(l)) : [];
}

export interface ImportResult {
  tool: string;
  files: number;
  imported: Entry[];
  unchanged: number;
}

export async function importTool(p: Project, tool: string, o: { since?: string; dryRun?: boolean } = {}): Promise<ImportResult> {
  const res: ImportResult = { tool, files: 0, imported: [], unchanged: 0 };
  const { config, entries } = await p.brain.snapshot();
  if (!captureEnabled(config, tool)) return res;
  const files = discover(tool, p.root);
  res.files = files.length;
  const known = new Map(entries.filter((e) => e.kind === "session" && e.session).map((e) => [e.session!, e]));
  const transcripts: Transcript[] = [];
  for (const f of files) {
    try {
      if (o.since && statSync(f).mtime.toISOString() < o.since) continue;
      const text = readFileSync(f, "utf8");
      if (tool === "aider") transcripts.push(...parseAiderHistory(text));
      else {
        const t = parseTranscript(tool, text);
        if (!t.sessionId) t.sessionId = path.basename(f).replace(/\.(jsonl?|txt)$/, "").replace(/^rollout-/, "").slice(-36);
        if (tool === "windsurf") {
          // Windsurf transcripts carry no cwd: keep sessions that edited files in this project
          const own = t.files.filter((x) => inside(x, p.root));
          if (!own.length) continue;
          t.files = own.map((x) => path.relative(p.root, x).split(path.sep).join("/"));
        } else if (t.cwd && !inside(t.cwd, p.root)) continue;
        transcripts.push(t);
      }
    } catch {
      /* unreadable file: skip */
    }
  }
  for (const t of transcripts) {
    if (o.since && (t.ended || t.started || "") < o.since) continue;
    const first = t.turns.find((x) => x.role === "user");
    if (!first) continue;
    const key = `${tool}:${t.sessionId}`;
    const old = known.get(key);
    // hooks already captured this session live (with its change set): leave that richer entry alone
    if (old && (!old.tags.includes("imported") || (t.ended && (old.updated || "") >= t.ended))) {
      res.unchanged++;
      continue;
    }
    const commits = p.isGit ? commitsInWindow(p.root, t.started, t.ended) : [];
    let body = sessionBody(t, { maxPromptChars: config.capture.maxPromptChars });
    if (commits.length) body += `\n\n### Commits in this time window\n${commits.map((c) => `- ${c}`).join("\n")}`;
    body += `\n\n_Imported from ${toolLabel(tool)}'s local session log by \`hamyad import\`._`;
    if (o.dryRun) {
      res.imported.push({ id: "(dry-run)", kind: "session", title: first.text.slice(0, 90), body, tags: [tool], source: tool, created: t.started || "", updated: t.ended || "", path: "" });
      continue;
    }
    const clip = first.text.replace(/\s+/g, " ").trim();
    const e = await p.brain.upsertCaptured("session", key, {
      title: `${toolLabel(tool)}: ${clip.length > 90 ? clip.slice(0, 89) + "…" : clip}`,
      body,
      tags: [tool, "imported"],
      source: tool,
    });
    res.imported.push(e);
  }
  return res;
}

export async function importAll(p: Project, tools: string[] = [...IMPORT_TOOLS], o: { since?: string; dryRun?: boolean } = {}): Promise<ImportResult[]> {
  const state = readState(p);
  const out: ImportResult[] = [];
  const started = new Date().toISOString();
  for (const t of tools) {
    const since = o.since || state.lastImport?.[t] || new Date(Date.now() - 14 * 864e5).toISOString();
    out.push(await importTool(p, t, { since, dryRun: o.dryRun }));
  }
  if (!o.dryRun) {
    const s = readState(p);
    s.lastImport = { ...(s.lastImport || {}) };
    for (const t of tools) s.lastImport[t] = started;
    await writeState(p, s);
    if (out.some((r) => r.imported.length)) await regenerate(p);
  }
  return out;
}
