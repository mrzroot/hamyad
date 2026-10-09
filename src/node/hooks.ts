import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Entry } from "../core/entry.js";
import { commitBrain, git, pullFastForward, pushBrain, SyncReport } from "./git.js";
import { BRAIN_DIR, Project, readState, regenerate, writeState } from "./project.js";

export interface TranscriptSummary {
  prompts: string[];
  files: string[];
  commands: number;
  lastAssistant: string;
  started?: string;
  ended?: string;
}

const SYSTEM_PREFIXES = ["<command-", "<local-command", "Caveat:", "<system-reminder", "[Request interrupted"];

function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
  return "";
}

/** Parse a Claude Code transcript (JSONL) into a deterministic, LLM-free summary. */
export function summarizeTranscript(jsonl: string, cwd?: string): TranscriptSummary {
  const s: TranscriptSummary = { prompts: [], files: [], commands: 0, lastAssistant: "" };
  const files = new Set<string>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.timestamp) {
      s.started = s.started || ev.timestamp;
      s.ended = ev.timestamp;
    }
    const msg = ev.message;
    if (ev.type === "user" && msg && !ev.isMeta && !ev.isSidechain) {
      const t = textOf(msg.content).trim();
      if (t && !SYSTEM_PREFIXES.some((p) => t.startsWith(p))) s.prompts.push(t);
    } else if (ev.type === "assistant" && msg && Array.isArray(msg.content) && !ev.isSidechain) {
      for (const c of msg.content) {
        if (c?.type === "text" && c.text?.trim()) s.lastAssistant = c.text.trim();
        if (c?.type === "tool_use") {
          const fp = c.input?.file_path || c.input?.notebook_path;
          if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name) && typeof fp === "string") {
            files.add((cwd && path.isAbsolute(fp) ? path.relative(cwd, fp) || fp : fp).split(path.sep).join("/"));
          }
          if (c.name === "Bash") s.commands++;
        }
      }
    }
  }
  s.files = [...files].filter((f) => !f.startsWith(BRAIN_DIR + "/") && !f.startsWith("..")).sort();
  return s;
}

const clip = (t: string, n: number) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

export function sessionEntryBody(s: TranscriptSummary, commits: string[]): string {
  const out: string[] = [];
  out.push("### Asked");
  for (const p of s.prompts.slice(0, 8)) out.push(`- ${clip(p, 220)}`);
  if (s.prompts.length > 8) out.push(`- …and ${s.prompts.length - 8} more prompts`);
  if (s.files.length) {
    out.push("", "### Files changed");
    for (const f of s.files.slice(0, 25)) out.push(`- \`${f}\``);
    if (s.files.length > 25) out.push(`- …and ${s.files.length - 25} more`);
  }
  if (commits.length) {
    out.push("", "### Commits");
    for (const c of commits.slice(0, 15)) out.push(`- ${c}`);
  }
  if (s.lastAssistant) out.push("", "### Outcome (Claude's last message)", clip(s.lastAssistant, 700));
  if (s.commands) out.push("", `_${s.commands} shell command(s) run._`);
  return out.join("\n");
}

async function readStdin(): Promise<any> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function newFromOthers(entries: Entry[], since?: string): Entry[] {
  if (!since) return [];
  return entries.filter((e) => (e.updated || e.created) > since && e.source !== "claude-code");
}

/**
 * SessionStart: fast-forward the repo, regenerate CLAUDE.md, and inject what
 * changed on the chat side since the previous Claude Code session.
 */
export async function hookSessionStart(p: Project, input: any = {}): Promise<{ output: any; report: SyncReport }> {
  const report: SyncReport = { skipped: [] };
  const { config } = await p.brain.snapshot();
  if (p.isGit && config.git.pull && input.source !== "compact") pullFastForward(p.root, report);
  await regenerate(p);
  const { entries } = await p.brain.snapshot();
  const state = readState(p);
  const fresh = newFromOthers(entries, state.lastSessionStart);
  const now = new Date().toISOString();
  state.lastSessionStart = now;
  state.sessionStarts = { ...(state.sessionStarts || {}), [input.session_id || "unknown"]: now };
  await writeState(p, state);

  const lines: string[] = [];
  lines.push(`[hamyad] Shared project brain loaded from ${BRAIN_DIR}/ (${entries.length} entries). The brief is in CLAUDE.md; use brain_search / brain_remember / brain_update MCP tools.`);
  if (fresh.length) {
    lines.push(`New since your last Claude Code session (from Claude chat / Desktop / GitHub):`);
    for (const e of fresh.slice(0, 15)) lines.push(`- ${e.kind} \`${e.id}\`${e.status ? ` [${e.status}]` : ""}: ${e.title}${e.body ? ` (${clip(e.body, 160)})` : ""} [${e.source}]`);
  }
  if (report.pulled && report.pulled !== "already up to date") lines.push(`git: ${report.pulled}.`);
  for (const sk of report.skipped) lines.push(`git: ${sk}`);
  return {
    output: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } },
    report,
  };
}

/** SessionEnd: write a session summary entry, regenerate, commit and (safely) push. */
export async function hookSessionEnd(p: Project, input: any = {}): Promise<{ entry?: Entry; report: SyncReport }> {
  const report: SyncReport = { skipped: [] };
  const { config } = await p.brain.snapshot();
  let entry: Entry | undefined;
  if (config.sessionLog && input.transcript_path && existsSync(input.transcript_path)) {
    const s = summarizeTranscript(readFileSync(input.transcript_path, "utf8"), input.cwd || p.root);
    if (s.prompts.length) {
      let commits: string[] = [];
      if (p.isGit && s.started) {
        const r = git(p.root, ["log", `--since=${s.started}`, "--format=%h %s"], { allowFail: true });
        commits = r.ok ? r.out.split("\n").filter((l) => l && !/^\w+ brain:/.test(l)) : [];
      }
      entry = await p.brain.add({
        kind: "session",
        title: `Claude Code: ${clip(s.prompts[0], 90)}`,
        body: sessionEntryBody(s, commits),
        tags: input.reason && input.reason !== "other" ? [String(input.reason)] : [],
        source: "claude-code",
      });
    }
  }
  await regenerate(p);
  if (p.isGit && config.git.commit) {
    commitBrain(p.root, path.relative(p.root, p.brainDir) || BRAIN_DIR, `brain: ${entry ? "session summary" : "sync"} [claude-code]`, report);
    if (config.git.push) pushBrain(p.root, report);
  }
  return { entry, report };
}

export { readStdin };
