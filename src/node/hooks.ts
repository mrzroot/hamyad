import { spawn } from "node:child_process";
import { existsSync, mkdirSync, promises as fs, readdirSync, readFileSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import path from "node:path";
import { changesSince, isEmptyChangeSet } from "../core/brain.js";
import { captureEnabled } from "../core/config.js";
import type { Entry } from "../core/entry.js";
import { renderBrief, renderChanges } from "../core/render.js";
import { redactText } from "../core/redact.js";
import { toolLabel } from "../core/tools.js";
import { changeBody, commitsBetween, diffTrees, dibsAttribution, snapshotTree } from "./changes.js";
import { commitBrain, pullFastForward, pushBrain, SyncReport } from "./git.js";
import { BRAIN_DIR, Project, openProject, readState, regenerate, writeState } from "./project.js";
import { parseTranscript, stripInjected, Transcript, Turn } from "./transcripts.js";

/**
 * One hook entry point for every agent:  `hamyad hook <tool> <event>`.
 *
 *   phase    claude-code      codex            gemini-cli    cursor              copilot              windsurf
 *   start    SessionStart     SessionStart     SessionStart  sessionStart        sessionStart         (first pre_user_prompt)
 *   prompt   UserPromptSubmit UserPromptSubmit BeforeAgent   beforeSubmitPrompt  userPromptSubmitted  pre_user_prompt
 *   response                                                 afterAgentResponse
 *   turn     Stop             Stop             AfterAgent    stop                agentStop            post_cascade_response_with_transcript
 *   end      SessionEnd       SessionEnd       SessionEnd    sessionEnd          sessionEnd
 *
 * start  : commit leftovers, fast-forward pull, refresh CLAUDE.md/AGENTS.md/MEMORY.md, snapshot the
 *          working tree, and tell the agent which decisions changed since ITS last session.
 * prompt : record the prompt; if another tool changed a decision mid-session, say so now.
 * turn   : upsert this session's summary + change-journal entry (cheap, idempotent).
 * end    : final capture, commit .brain/, push in the background (never blocks the agent).
 *
 * Every handler fails open: errors go to <state dir>/hook-errors.log and the agent continues.
 */

export type Phase = "start" | "prompt" | "response" | "turn" | "end" | "commit" | "ignore";

export interface HookEvent {
  tool: string;
  event: string;
  phase: Phase;
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  prompt?: string;
  response?: string;
  /** SessionStart source (startup/resume/clear/compact) */
  source?: string;
  /** output dialect for tools that accept two (Copilot camelCase vs VS Code PascalCase) */
  pascal?: boolean;
}

export const HOOK_TOOLS = ["claude", "codex", "gemini", "cursor", "copilot", "windsurf", "git"] as const;
const TOOL_ID: Record<string, string> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
  gemini: "gemini-cli",
  "gemini-cli": "gemini-cli",
  cursor: "cursor",
  copilot: "copilot",
  windsurf: "windsurf",
  git: "git",
};

const PHASES: Record<string, Phase> = {
  sessionstart: "start",
  "session-start": "start",
  userpromptsubmit: "prompt",
  userpromptsubmitted: "prompt",
  beforeagent: "prompt",
  beforesubmitprompt: "prompt",
  pre_user_prompt: "prompt",
  afteragentresponse: "response",
  post_cascade_response: "response",
  stop: "turn",
  afteragent: "turn",
  agentstop: "turn",
  post_cascade_response_with_transcript: "turn",
  sessionend: "end",
  "session-end": "end",
  "post-commit": "commit",
};

export function normalizeHook(toolArg: string, event: string, p: any, env: NodeJS.ProcessEnv = process.env): HookEvent {
  let tool = TOOL_ID[toolArg] || toolArg;
  let ev = event || p?.hook_event_name || p?.agent_action_name || "";
  // Cursor and Copilot CLI also run hooks from .claude/settings.json; attribute them correctly.
  if (tool === "claude-code" && (p?.cursor_version || env.CURSOR_VERSION)) tool = "cursor";
  else if (tool === "claude-code" && env.COPILOT_CLI === "1") tool = "copilot";
  const ti = p?.tool_info || {};
  const roots: string[] = p?.workspace_roots || [];
  const cwd = p?.cwd || roots[0] || ti.cwd || env.CLAUDE_PROJECT_DIR || env.CURSOR_PROJECT_DIR || env.GEMINI_PROJECT_DIR || env.COPILOT_PROJECT_DIR || process.cwd();
  const sessionId = String(p?.session_id || p?.sessionId || p?.conversation_id || p?.trajectory_id || env.CLAUDE_CODE_SESSION_ID || "unknown");
  const key = ev.replace(/^on/, "").toLowerCase();
  return {
    tool,
    event: ev,
    phase: PHASES[key] || "ignore",
    sessionId,
    cwd,
    transcriptPath: p?.transcript_path || p?.transcriptPath || ti.transcript_path || env.CURSOR_TRANSCRIPT_PATH || undefined,
    prompt: p?.prompt ?? ti.user_prompt ?? p?.initialPrompt ?? p?.initial_prompt,
    response: p?.prompt_response ?? p?.text ?? ti.response ?? p?.last_assistant_message,
    source: p?.source,
    pascal: /^[A-Z]/.test(ev) && tool === "copilot",
  };
}

/** Is this tool's own hook file installed? Then the cross-tool copy in .claude/settings.json must stay quiet. */
function ownHooksInstalled(root: string, tool: string): boolean {
  const f = tool === "cursor" ? path.join(root, ".cursor", "hooks.json") : tool === "copilot" ? path.join(root, ".github", "hooks", "hamyad.json") : "";
  return !!f && existsSync(f) && readFileSync(f, "utf8").includes("hamyad hook");
}

// ------------------------------------------------------------------ session records

export interface SessionRecord {
  tool: string;
  sessionId: string;
  started: string;
  lastSeenBefore?: string;
  briefAt?: string;
  baseTree?: string;
  baseHead?: string;
  transcriptPath?: string;
  prompts: Turn[];
  responses: Turn[];
  ended?: string;
}

const recFile = (p: Project, tool: string, sid: string) => path.join(p.stateDir, "sessions", `${tool}__${sid.replace(/[^\w.-]+/g, "_").slice(0, 80)}.json`);

export function loadRecord(p: Project, tool: string, sid: string): SessionRecord | undefined {
  try {
    return JSON.parse(readFileSync(recFile(p, tool, sid), "utf8"));
  } catch {
    return undefined;
  }
}

async function saveRecord(p: Project, r: SessionRecord) {
  const f = recFile(p, r.tool, r.sessionId);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(r, null, 1));
}

function pruneRecords(p: Project, days = 14) {
  const dir = path.join(p.stateDir, "sessions");
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - days * 864e5;
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    try {
      if (statSync(f).mtimeMs < cutoff) unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

async function ensureRecord(p: Project, ev: HookEvent, withBaseline: boolean): Promise<{ rec: SessionRecord; created: boolean }> {
  const old = loadRecord(p, ev.tool, ev.sessionId);
  if (old) {
    if (ev.transcriptPath && !old.transcriptPath) old.transcriptPath = ev.transcriptPath;
    return { rec: old, created: false };
  }
  const state = readState(p);
  const rec: SessionRecord = {
    tool: ev.tool,
    sessionId: ev.sessionId,
    started: new Date().toISOString(),
    lastSeenBefore: state.lastSeen?.[ev.tool],
    transcriptPath: ev.transcriptPath,
    prompts: [],
    responses: [],
  };
  if (withBaseline && p.isGit) {
    const s = snapshotTree(p.root);
    rec.baseTree = s.tree;
    rec.baseHead = s.head;
  }
  return { rec, created: true };
}

// ------------------------------------------------------------------ phases

const clip = (t: string, n: number) => {
  const one = (t || "").replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

async function markSeen(p: Project, tool: string, at: string) {
  const state = readState(p);
  state.lastSeen = { ...(state.lastSeen || {}), [tool]: at };
  state.lastSessionStart = at;
  await writeState(p, state);
}

/** Start of a session: returns the context text for the agent. */
export async function phaseStart(p: Project, ev: HookEvent): Promise<{ context: string; report: SyncReport }> {
  const report: SyncReport = { skipped: [] };
  const { config } = await p.brain.snapshot();
  if (p.brainInGit && ev.source !== "compact" && ev.source !== "resume") {
    // brain changes left by a session whose end hook never ran (crash, Gemini exit) go first
    if (config.git.commit) commitBrain(p.root, brainRel(p), "brain: sync [leftover]", report, config.instructionFiles);
    if (config.git.pull) pullFastForward(p.root, report);
  }
  await regenerate(p);
  const { rec, created } = await ensureRecord(p, ev, config.capture.changes);
  const { entries } = await p.brain.snapshot();
  const since = rec.lastSeenBefore;
  const cs = changesSince(entries, since, ev.tool);
  rec.briefAt = new Date().toISOString();
  await saveRecord(p, rec);
  if (created) await markSeen(p, ev.tool, rec.started);
  pruneRecords(p);

  const lines: string[] = [];
  const changes = renderChanges(cs, { since, tool: ev.tool });
  if (changes) lines.push(changes, "");
  lines.push(
    `[hamyad] Shared project brain: ${entries.length} entries in ${p.store.external ? p.brainDir : BRAIN_DIR + "/"} (shared with ${otherTools(ev.tool)}). ${config.instructionFiles.length ? `The brief is in ${config.instructionFiles.join(" / ")}. ` : ""}Use brain_search / brain_remember (pass supersedes when a decision replaces an older one) / brain_update.`,
  );
  if (!config.instructionFiles.length) lines.push("", renderBrief(config, entries, { maxChars: Math.min(config.briefChars, 5000) }));
  if (report.pulled && report.pulled !== "already up to date") lines.push(`git: ${report.pulled}.`);
  for (const sk of report.skipped) if (!/no upstream|no remote/.test(sk)) lines.push(`git: ${sk}`);
  return { context: lines.join("\n"), report };
}

const otherTools = (self: string) =>
  ["Claude Code", "Claude.ai", "Codex/ChatGPT", "Gemini CLI", "Cursor", "Copilot", "Windsurf", "aider"].filter((t) => t !== toolLabel(self)).join(", ");

/** A prompt: record it; warn about decisions that changed while this session was running. */
export async function phasePrompt(p: Project, ev: HookEvent): Promise<string> {
  const { config, entries } = await p.brain.snapshot();
  const { rec, created } = await ensureRecord(p, ev, config.capture.changes);
  const asked = stripInjected(ev.prompt || "");
  if (asked && captureEnabled(config, ev.tool)) rec.prompts.push({ role: "user", text: clip(redactText(asked), 4000), ts: new Date().toISOString() });
  let out = "";
  if (created) {
    // tools without a session-start hook (Windsurf) or a missed start: show the full "since last session" block once
    const cs = changesSince(entries, rec.lastSeenBefore, ev.tool);
    out = renderChanges(cs, { since: rec.lastSeenBefore, tool: ev.tool });
    await markSeen(p, ev.tool, rec.started);
  } else if (rec.briefAt) {
    const cs = changesSince(entries, rec.briefAt, ev.tool);
    const only = { ...cs, tasks: [], sessions: [], notes: [] };
    if (!isEmptyChangeSet(only)) out = "[hamyad] While you were working, another tool changed the shared brain:\n" + renderChanges(only, { since: rec.briefAt });
  }
  rec.briefAt = new Date().toISOString();
  await saveRecord(p, rec);
  return out;
}

export async function phaseResponse(p: Project, ev: HookEvent) {
  const { config } = await p.brain.snapshot();
  const { rec } = await ensureRecord(p, ev, config.capture.changes);
  if (ev.response && captureEnabled(config, ev.tool)) rec.responses.push({ role: "assistant", text: clip(redactText(ev.response), 4000), ts: new Date().toISOString() });
  await saveRecord(p, rec);
}

function readTranscript(tool: string, file?: string, maxBytes = 20 * 1024 * 1024): Transcript | undefined {
  if (!file || !existsSync(file)) return undefined;
  try {
    const st = statSync(file);
    let text = readFileSync(file, "utf8");
    if (st.size > maxBytes) text = text.slice(-maxBytes);
    return parseTranscript(tool, text);
  } catch {
    return undefined;
  }
}

/** Merge the tool's own transcript with what our prompt/response hooks recorded. */
export function mergeTranscript(rec: SessionRecord, parsed?: Transcript): Transcript {
  if (parsed && parsed.turns.some((t) => t.role === "user")) return parsed;
  const turns = [...rec.prompts, ...rec.responses].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return {
    tool: rec.tool,
    sessionId: rec.sessionId,
    started: rec.started,
    ended: turns[turns.length - 1]?.ts,
    turns,
    files: parsed?.files || [],
    commands: parsed?.commands || 0,
    model: parsed?.model,
  };
}

export function sessionBody(t: Transcript, o: { maxPromptChars: number; changeId?: string; transcriptFile?: string; diffFiles?: string[] }): string {
  const out: string[] = [];
  const prompts = t.turns.filter((x) => x.role === "user");
  const last = [...t.turns].reverse().find((x) => x.role === "assistant");
  const when = t.started ? `${t.started.slice(0, 16).replace("T", " ")}${t.ended && t.ended !== t.started ? `–${t.ended.slice(11, 16)}` : ""} UTC` : "";
  out.push(`**Tool:** ${toolLabel(t.tool)} · **Session:** \`${t.sessionId || "?"}\`${when ? ` · ${when}` : ""}${t.model ? ` · ${t.model}` : ""}`);
  out.push("", "### Asked");
  for (const x of prompts.slice(0, 8)) out.push(`- ${clip(x.text, o.maxPromptChars)}`);
  if (prompts.length > 8) out.push(`- …and ${prompts.length - 8} more prompts`);
  const files = [...new Set([...(t.files || []), ...(o.diffFiles || [])])].sort();
  if (files.length) {
    out.push("", "### Files touched");
    for (const f of files.slice(0, 25)) out.push(`- \`${f}\``);
    if (files.length > 25) out.push(`- …and ${files.length - 25} more`);
  }
  if (last) out.push("", "### Outcome (last reply)", clip(last.text, 700));
  const tail: string[] = [];
  if (t.commands) tail.push(`${t.commands} shell command(s)`);
  if (o.changeId) tail.push(`change set \`${o.changeId}\``);
  if (o.transcriptFile) tail.push(`full transcript: \`${o.transcriptFile}\``);
  if (tail.length) out.push("", `_${tail.join(" · ")}._`);
  return out.join("\n");
}

export function transcriptMarkdown(t: Transcript, maxBytes: number): string {
  const head = `# ${toolLabel(t.tool)} session ${t.sessionId || ""}\n\n_Captured by hamyad (capture.sessions = "full"). Secrets are redacted; long sessions are clipped._\n`;
  let body = "";
  for (const x of t.turns) {
    const block = `\n## ${x.role === "user" ? "User" : toolLabel(t.tool)}${x.ts ? ` · ${x.ts.slice(0, 16).replace("T", " ")}` : ""}\n\n${redactText(x.text)}\n`;
    if (head.length + body.length + block.length > maxBytes) {
      body += "\n_…clipped (capture.maxTranscriptBytes)._\n";
      break;
    }
    body += block;
  }
  return head + body;
}

/** End of a turn (and of the session): upsert the session summary and the change-journal entry. */
export async function phaseTurn(p: Project, ev: HookEvent): Promise<{ session?: Entry; change?: Entry }> {
  const { config } = await p.brain.snapshot();
  if (!captureEnabled(config, ev.tool)) return {};
  const { rec } = await ensureRecord(p, ev, config.capture.changes);
  if (ev.response && !rec.responses.some((r) => r.text === clip(redactText(ev.response!), 4000)))
    rec.responses.push({ role: "assistant", text: clip(redactText(ev.response), 4000), ts: new Date().toISOString() });
  const t = mergeTranscript(rec, readTranscript(ev.tool, ev.transcriptPath || rec.transcriptPath));
  const key = `${ev.tool}:${ev.sessionId}`;
  let change: Entry | undefined;
  let diffFiles: string[] = [];
  if (config.capture.changes && p.isGit && rec.baseTree) {
    const now = snapshotTree(p.root);
    if (now.tree) {
      const c = diffTrees(p.root, rec.baseTree, now.tree, { exclude: config.capture.exclude, maxPatchBytes: config.capture.maxPatchBytes, patch: config.capture.patch });
      c.commits = commitsBetween(p.root, rec.baseHead, now.head);
      c.dibs = dibsAttribution(p.root, rec.started);
      diffFiles = c.files.map((f) => f.path);
      if (c.files.length || c.commits.length) {
        change = await p.brain.upsertCaptured("change", key, {
          title: `${toolLabel(ev.tool)}: ${c.files.length} file(s) +${c.added} −${c.removed}${t.turns[0] ? ` — ${clip(t.turns.find((x) => x.role === "user")?.text || "", 60)}` : ""}`,
          body: changeBody(c, { tool: ev.tool, session: ev.sessionId, started: rec.started }),
          tags: [ev.tool],
          source: ev.tool,
        });
      }
    }
  }
  let transcriptFile: string | undefined;
  if (config.capture.sessions === "full" && p.store.kind === "dir" && t.turns.length) {
    const rel = `transcripts/${ev.tool}/${(t.started || rec.started).slice(0, 10)}-${ev.sessionId.replace(/[^\w-]+/g, "").slice(0, 12)}.md`;
    const abs = path.join(p.brainDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, transcriptMarkdown(t, config.capture.maxTranscriptBytes));
    transcriptFile = `${p.store.external ? p.brainDir + "/" : BRAIN_DIR + "/"}${rel}`;
  }
  let session: Entry | undefined;
  const firstPrompt = t.turns.find((x) => x.role === "user");
  if (firstPrompt) {
    session = await p.brain.upsertCaptured("session", key, {
      title: `${toolLabel(ev.tool)}: ${clip(firstPrompt.text, 90)}`,
      body: sessionBody(t, { maxPromptChars: config.capture.maxPromptChars, changeId: change?.id, transcriptFile, diffFiles }),
      tags: [ev.tool],
      source: ev.tool,
    });
  }
  await saveRecord(p, rec);
  await regenerate(p);
  return { session, change };
}

export function brainRel(p: Project): string[] {
  if (!p.brainInGit) return [];
  const out = [path.relative(p.root, p.store.kind === "file" ? p.brainDir : p.brainDir) || BRAIN_DIR];
  return out;
}

/** Push without making the agent wait (Codex allows SessionEnd hooks 1-3 s, Gemini does not wait at all). */
export function pushInBackground(root: string) {
  const cli = process.argv[1];
  // only when we are the hamyad CLI (not a test runner or a library caller)
  if (!cli || process.env.HAMYAD_NO_BACKGROUND || !/(^|[\\/])(cli\.js|hamyad(\.js|\.cmd)?)$/.test(cli)) return false;
  try {
    const child = spawn(process.execPath, [cli, "sync", "--no-pull", "--quiet", "--dir", root], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function phaseEnd(p: Project, ev: HookEvent): Promise<{ entry?: Entry; change?: Entry; report: SyncReport }> {
  const report: SyncReport = { skipped: [] };
  const { session, change } = await phaseTurn(p, ev);
  const rec = loadRecord(p, ev.tool, ev.sessionId);
  if (rec) {
    rec.ended = new Date().toISOString();
    await saveRecord(p, rec);
  }
  const { config } = await p.brain.snapshot();
  if (p.brainInGit && config.git.commit) {
    commitBrain(p.root, brainRel(p), `brain: ${session ? "session summary" : "sync"} [${ev.tool}]`, report, config.instructionFiles);
    if (config.git.push && report.committed) {
      if (process.env.HAMYAD_SYNC_PUSH === "1") pushBrain(p.root, report);
      else if (pushInBackground(p.root)) report.pushed = "in background";
      else pushBrain(p.root, report);
    }
  }
  return { entry: session, change, report };
}

/** git post-commit: keep MEMORY.md / instruction files fresh and pick up aider's chat. */
export async function phaseCommit(p: Project): Promise<void> {
  if (process.env.HAMYAD_INTERNAL === "1") return;
  const { importTool } = await import("./importers.js");
  if (existsSync(path.join(p.root, ".aider.chat.history.md"))) await importTool(p, "aider", {});
  await regenerate(p);
}

// ------------------------------------------------------------------ output

export function hookOutput(ev: HookEvent, context: string): string {
  const t = ev.tool;
  if (t === "windsurf" || t === "git") return "";
  if (t === "cursor") {
    if (ev.phase === "start") return JSON.stringify(context ? { additional_context: context } : {});
    if (ev.phase === "prompt") return JSON.stringify(context ? { continue: true, additional_context: context } : { continue: true });
    return "{}";
  }
  if (t === "copilot" && !ev.pascal) {
    if ((ev.phase === "start" || ev.phase === "prompt") && context) return JSON.stringify({ additionalContext: context });
    return "{}";
  }
  if ((ev.phase === "start" || ev.phase === "prompt") && context) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: ev.event, additionalContext: context }, ...(t === "copilot" ? { additionalContext: context } : {}) });
  }
  return "{}";
}

export async function readStdin(): Promise<any> {
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

function logError(p: Project | undefined, ev: string, err: any) {
  try {
    const dir = p?.stateDir;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "hook-errors.log"), `--- ${new Date().toISOString()} ${ev}\n${err?.stack || err}\n`);
  } catch {
    /* nothing left to do */
  }
}

/** Run one hook invocation. Returns what to print on stdout. Never throws. */
export async function runHook(toolArg: string, event: string, payload: any, dir?: string, log?: (line: string) => void): Promise<string> {
  let p: Project | undefined;
  let ev: HookEvent | undefined;
  try {
    ev = normalizeHook(toolArg, event, payload);
    if (ev.phase === "ignore") return "{}";
    p = openProject(dir || ev.cwd, ev.tool);
    // Not a hamyad project (hooks installed globally, or another repo): do nothing.
    if (!existsSync(p.brainDir)) return ev.tool === "windsurf" ? "" : "{}";
    if (toolArg === "claude" && ev.tool !== "claude-code" && ownHooksInstalled(p.root, ev.tool)) return hookOutput(ev, "");
    switch (ev.phase) {
      case "start":
        return hookOutput(ev, (await phaseStart(p, ev)).context);
      case "prompt":
        return hookOutput(ev, await phasePrompt(p, ev));
      case "response":
        await phaseResponse(p, ev);
        return hookOutput(ev, "");
      case "turn":
        await phaseTurn(p, ev);
        return hookOutput(ev, "");
      case "end": {
        const r = await phaseEnd(p, ev);
        log?.(`[hamyad] ${r.entry ? `logged session ${r.entry.id}` : "no session logged"}${r.change ? `, change set ${r.change.id}` : ""}; ${[r.report.committed, r.report.pushed, ...r.report.skipped].filter(Boolean).join("; ")}`);
        return hookOutput(ev, "");
      }
      case "commit":
        await phaseCommit(p);
        return "";
    }
    return "{}";
  } catch (err) {
    logError(p, `${toolArg} ${event}`, err);
    return ev ? hookOutput(ev, "") : "{}";
  }
}

// ------------------------------------------------------------------ 0.1 API (kept for scripts and tests)

export async function hookSessionStart(p: Project, input: any = {}) {
  const ev = normalizeHook("claude", "SessionStart", input);
  const r = await phaseStart(p, ev);
  return { output: JSON.parse(hookOutput(ev, r.context)), report: r.report };
}

export async function hookSessionEnd(p: Project, input: any = {}) {
  const ev = normalizeHook("claude", "SessionEnd", input);
  const r = await phaseEnd(p, ev);
  return { entry: r.entry, change: r.change, report: r.report };
}

export { openProject };
