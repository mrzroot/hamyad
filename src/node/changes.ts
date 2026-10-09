import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { git } from "./git.js";
import { redactText } from "../core/redact.js";

/**
 * Change journal: snapshot the working tree (tracked + untracked, honouring
 * .gitignore) as a git tree object without touching the user's index, then
 * diff two snapshots. Works on dirty trees, never stages or commits anything.
 */

/** Paths hamyad itself generates; never part of an agent's change set. */
export const GENERATED = [".brain", "CLAUDE.md", "AGENTS.md", "GEMINI.md", ".hamyad.json"];

export function snapshotTree(root: string): { tree?: string; head?: string } {
  const head = git(root, ["rev-parse", "--verify", "-q", "HEAD"], { allowFail: true });
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamyad-idx-"));
  const idx = path.join(dir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
    if (head.ok) run(["read-tree", "HEAD"]);
    run(["add", "-A", "--", "."]);
    return { tree: run(["write-tree"]), head: head.ok ? head.out : undefined };
  } catch {
    return { head: head.ok ? head.out : undefined };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface FileStat {
  path: string;
  added: number;
  removed: number;
  binary?: boolean;
}

export interface ChangeSummary {
  files: FileStat[];
  added: number;
  removed: number;
  patch: string;
  truncated: boolean;
  commits: string[];
  /** dibs attribution in the same window, if dibs is installed */
  dibs?: Record<string, string[]>;
}

const excludeSpecs = (extra: string[]) => [...GENERATED, ...extra].map((p) => `:(exclude)${p.replace(/\/$/, "")}`);

export function diffTrees(root: string, from: string, to: string, o: { exclude?: string[]; maxPatchBytes?: number; patch?: boolean } = {}): ChangeSummary {
  const specs = ["--", ".", ...excludeSpecs(o.exclude || [])];
  const ns = git(root, ["diff", "--numstat", "--no-renames", from, to, ...specs], { allowFail: true });
  const files: FileStat[] = [];
  if (ns.ok)
    for (const l of ns.out.split("\n")) {
      const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(l);
      if (m) files.push({ path: m[3], added: m[1] === "-" ? 0 : +m[1], removed: m[2] === "-" ? 0 : +m[2], ...(m[1] === "-" ? { binary: true } : {}) });
    }
  let patch = "";
  let truncated = false;
  if (o.patch !== false && files.length) {
    const max = o.maxPatchBytes ?? 12000;
    const p = git(root, ["diff", "--no-color", "--no-renames", "-U2", from, to, ...specs], { allowFail: true });
    if (p.ok) {
      patch = redactText(p.out);
      if (patch.length > max) {
        truncated = true;
        const cut = patch.lastIndexOf("\n", max);
        patch = patch.slice(0, cut > 0 ? cut : max);
      }
    }
  }
  return { files, added: files.reduce((a, f) => a + f.added, 0), removed: files.reduce((a, f) => a + f.removed, 0), patch, truncated, commits: [] };
}

/** Non-brain commits made between two HEADs (oldest last). */
export function commitsBetween(root: string, from?: string, to?: string): string[] {
  if (!to) return [];
  const range = from && from !== to ? `${from}..${to}` : from === to ? "" : to;
  if (!range) return [];
  const r = git(root, ["log", "--format=%h %s", range, "-n", "30"], { allowFail: true });
  return r.ok ? r.out.split("\n").filter((l) => l && !/^\w+ brain:/.test(l)) : [];
}

/** dibs (github.com/mrzroot/dibs) journal: who changed which file, by line, in a time window. */
export function dibsAttribution(root: string, fromIso: string, toIso?: string): Record<string, string[]> | undefined {
  const gd = git(root, ["rev-parse", "--git-common-dir"], { allowFail: true });
  if (!gd.ok) return undefined;
  const f = path.join(path.resolve(root, gd.out), "dibs", "journal.jsonl");
  if (!existsSync(f)) return undefined;
  const from = Date.parse(fromIso) / 1000;
  const to = toIso ? Date.parse(toIso) / 1000 : Infinity;
  const out: Record<string, Set<string>> = {};
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l);
      if (e.kind !== "change" || e.ts < from || e.ts > to) continue;
      (out[e.actor] ||= new Set()).add(e.path);
    } catch {
      /* skip */
    }
  }
  const res: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(out)) res[k] = [...v].sort();
  return Object.keys(res).length ? res : undefined;
}

export function changeBody(c: ChangeSummary, o: { tool: string; session: string; started?: string }): string {
  const out: string[] = [];
  out.push(`Session \`${o.session}\`${o.started ? ` from ${o.started.slice(0, 16).replace("T", " ")} UTC` : ""}: ${c.files.length} file(s), +${c.added} −${c.removed}.`);
  out.push("", "### Files");
  for (const f of c.files.slice(0, 40)) out.push(`- \`${f.path}\` ${f.binary ? "(binary)" : `+${f.added} −${f.removed}`}`);
  if (c.files.length > 40) out.push(`- …and ${c.files.length - 40} more`);
  if (c.commits.length) {
    out.push("", "### Commits");
    for (const x of c.commits.slice(0, 15)) out.push(`- ${x}`);
  }
  if (c.dibs) {
    out.push("", "### Who changed what (dibs)");
    for (const [actor, files] of Object.entries(c.dibs)) out.push(`- **${actor}**: ${files.slice(0, 12).map((f) => `\`${f}\``).join(", ")}${files.length > 12 ? " …" : ""}`);
  } else out.push("", "_The diff covers the whole working tree during the session, so it can include edits you made by hand at the same time (install dibs for per-line attribution)._");
  if (c.patch) {
    out.push("", `### Patch${c.truncated ? " (truncated)" : ""}`, "```diff", c.patch.replace(/```/g, "ˋˋˋ"), "```");
  }
  return out.join("\n");
}
