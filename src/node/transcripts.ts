import path from "node:path";

/**
 * Parsers for every agent's local session log, normalised to one shape.
 * All of them are best-effort and tolerant: these formats are internal to
 * each tool and change without notice, so unknown lines are skipped and a
 * generic walker is the fallback.
 */

export interface Turn {
  role: "user" | "assistant";
  text: string;
  ts?: string;
}

export interface Transcript {
  tool: string;
  sessionId?: string;
  cwd?: string;
  started?: string;
  ended?: string;
  model?: string;
  turns: Turn[];
  /** files the agent edited (relative to cwd when possible) */
  files: string[];
  commands: number;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "write_file", "replace", "edit", "create", "str_replace", "create_file", "edit_file", "search_replace", "StrReplace", "Delete", "apply_patch"]);
const SHELL_TOOLS = new Set(["Bash", "Shell", "run_shell_command", "exec_command", "shell", "local_shell", "bash", "run_command"]);

/** Wrapper messages tools inject as "user" turns; never real prompts. */
const NOISE = [
  /^<(?:command-|local-command|system-reminder|environment_context|user_instructions|permissions|skills_instructions|session_context|current_datetime|INSTRUCTIONS)/,
  /^# AGENTS\.md instructions/,
  /^Caveat:/,
  /^\[Request interrupted/,
];
export const isNoise = (t: string) => NOISE.some((r) => r.test(t.trim()));

function lines(text: string): any[] {
  const out: any[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* partial line while the tool is still writing */
    }
  }
  return out;
}

const textOf = (c: any): string => {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((x) => (typeof x === "string" ? x : typeof x?.text === "string" && !["thinking", "reasoning"].includes(x?.type) ? x.text : ""))
      .filter(Boolean)
      .join("\n");
  if (c && typeof c.text === "string") return c.text;
  return "";
};

function stripUserQuery(t: string): string {
  const m = /<user_query>([\s\S]*?)<\/user_query>/.exec(t);
  return (m ? m[1] : t).trim();
}

class Builder {
  t: Transcript;
  private files = new Set<string>();
  constructor(tool: string) {
    this.t = { tool, turns: [], files: [], commands: 0 };
  }
  ts(ts?: any) {
    if (!ts) return;
    const iso = typeof ts === "number" ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : String(ts);
    if (!this.t.started || iso < this.t.started) this.t.started = iso;
    if (!this.t.ended || iso > this.t.ended) this.t.ended = iso;
  }
  turn(role: Turn["role"], text: string, ts?: string) {
    const x = stripUserQuery(text || "");
    if (!x.trim()) return;
    if (role === "user" && isNoise(x)) return;
    const last = this.t.turns[this.t.turns.length - 1];
    if (last && last.role === role && last.text === x) return;
    this.t.turns.push({ role, text: x, ...(ts ? { ts } : {}) });
  }
  file(p?: string) {
    if (typeof p !== "string" || !p) return;
    const cwd = this.t.cwd;
    let r = p;
    if (cwd && path.isAbsolute(p)) r = path.relative(cwd, p) || p;
    this.files.add(r.split(path.sep).join("/"));
  }
  tool(name: string, input: any) {
    if (!name) return;
    if (EDIT_TOOLS.has(name)) {
      if (name === "apply_patch") for (const f of patchFiles(typeof input === "string" ? input : input?.input || input?.command || input?.patch || "")) this.file(f);
      else this.file(input?.file_path || input?.path || input?.notebook_path || input?.target_file || input?.filePath);
    }
    if (SHELL_TOOLS.has(name)) this.t.commands++;
  }
  done(): Transcript {
    this.t.files = [...this.files].filter((f) => !f.startsWith("..") && !f.startsWith(".brain/")).sort();
    return this.t;
  }
}

/** File paths touched by a Codex `apply_patch` envelope. */
export function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const l of String(patch || "").split(/\r?\n/)) {
    const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(l) || /^\*\*\* Move to: (.+)$/.exec(l);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// ------------------------------------------------------------------ per tool

export function parseClaude(text: string): Transcript {
  const b = new Builder("claude-code");
  for (const ev of lines(text)) {
    if (ev.sessionId && !b.t.sessionId) b.t.sessionId = ev.sessionId;
    if (ev.cwd && !b.t.cwd) b.t.cwd = ev.cwd;
    if (ev.isSidechain) continue;
    if (ev.type === "user" || ev.type === "assistant") b.ts(ev.timestamp);
    const msg = ev.message;
    if (ev.type === "user" && msg && !ev.isMeta) {
      if (Array.isArray(msg.content) && msg.content.every((c: any) => c?.type === "tool_result")) continue;
      b.turn("user", textOf(msg.content), ev.timestamp);
    } else if (ev.type === "assistant" && msg && Array.isArray(msg.content)) {
      if (msg.model && !b.t.model && msg.model !== "<synthetic>") b.t.model = msg.model;
      const t = textOf(msg.content.filter((c: any) => c?.type === "text"));
      if (t) b.turn("assistant", t, ev.timestamp);
      for (const c of msg.content) if (c?.type === "tool_use") b.tool(c.name, c.input);
    }
  }
  return b.done();
}

export function parseCodex(text: string): Transcript {
  const b = new Builder("codex");
  for (const ev of lines(text)) {
    const p = ev.payload || {};
    b.ts(ev.timestamp);
    if (ev.type === "session_meta") {
      b.t.sessionId = p.id || b.t.sessionId;
      b.t.cwd = p.cwd || b.t.cwd;
      continue;
    }
    if (ev.type === "turn_context" && p.model && !b.t.model) b.t.model = p.model;
    if (ev.type !== "response_item") continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) b.turn(p.role, textOf(p.content), ev.timestamp);
    else if (p.type === "function_call") {
      let args: any = {};
      try {
        args = JSON.parse(p.arguments || "{}");
      } catch {
        args = { input: p.arguments };
      }
      b.tool(p.name, args);
    } else if (p.type === "custom_tool_call") b.tool(p.name, p.input);
    else if (p.type === "local_shell_call") b.t.commands++;
  }
  return b.done();
}

export function parseGemini(text: string): Transcript {
  const b = new Builder("gemini-cli");
  let msgs: any[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && !trimmed.includes("\n{")) {
    // older single-JSON format
    try {
      const j = JSON.parse(trimmed);
      b.t.sessionId = j.sessionId;
      b.ts(j.startTime);
      msgs = j.messages || [];
    } catch {
      /* fall through */
    }
  } else {
    const byId = new Map<string, any>();
    for (const ev of lines(text)) {
      if (ev.sessionId && ev.startTime) {
        b.t.sessionId = ev.sessionId;
        b.ts(ev.startTime);
        continue;
      }
      if (ev.$set) {
        if (Array.isArray(ev.$set.messages)) for (const m of ev.$set.messages) if (m?.id) byId.set(m.id, m);
        continue;
      }
      if (ev.id && ev.type) byId.set(ev.id, ev);
    }
    msgs = [...byId.values()];
  }
  for (const m of msgs) {
    b.ts(m.timestamp);
    if (m.type === "user") {
      if (Array.isArray(m.content) && m.content.every((c: any) => c?.functionResponse)) continue;
      b.turn("user", textOf(m.content), m.timestamp);
    } else if (m.type === "gemini" || m.type === "model") {
      if (m.model && !b.t.model) b.t.model = m.model;
      b.turn("assistant", textOf(m.content), m.timestamp);
      for (const tc of m.toolCalls || []) b.tool(tc.name, tc.args);
    }
  }
  return b.done();
}

export function parseCopilot(text: string): Transcript {
  const b = new Builder("copilot");
  for (const ev of lines(text)) {
    const d = ev.data || {};
    b.ts(ev.timestamp || d.timestamp || d.startTime);
    if (ev.type === "session.start") {
      b.t.sessionId = d.sessionId;
      b.t.cwd = d.context?.gitRoot || d.context?.cwd;
      b.t.model = d.selectedModel;
    } else if (ev.type === "user.message") b.turn("user", textOf(d.content));
    else if (ev.type === "assistant.message") {
      b.turn("assistant", textOf(d.content));
      for (const r of d.toolRequests || []) {
        let args = r.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            /* keep */
          }
        }
        b.tool(r.name, args);
      }
    }
  }
  return b.done();
}

export function parseWindsurf(text: string): Transcript {
  const b = new Builder("windsurf");
  for (const ev of lines(text)) {
    b.ts(ev.timestamp || ev.created_at);
    if (ev.type === "user_input") b.turn("user", ev.user_input?.user_response || textOf(ev.user_input));
    else if (ev.type === "planner_response") b.turn("assistant", ev.planner_response?.response || "");
    else if (ev.type === "code_action") b.file(ev.code_action?.path || ev.code_action?.file_path);
    else if (/command/.test(String(ev.type))) b.t.commands++;
  }
  return b.done();
}

/** aider's `.aider.chat.history.md`: one file per repo, sessions start with `# aider chat started at`. */
export function parseAiderHistory(md: string): Transcript[] {
  const out: Transcript[] = [];
  const parts = md.split(/^# aider chat started at /m).slice(1);
  for (const part of parts) {
    const b = new Builder("aider");
    const nl = part.indexOf("\n");
    const stamp = part.slice(0, nl).trim();
    const started = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) ? new Date(stamp.replace(" ", "T")).toISOString() : undefined;
    b.t.sessionId = stamp.replace(/[^0-9]/g, "");
    if (started) b.ts(started);
    let assistant: string[] = [];
    const flush = () => {
      const t = assistant.join("\n").trim();
      if (t) b.turn("assistant", t);
      assistant = [];
    };
    for (const l of part.slice(nl + 1).split(/\r?\n/)) {
      const u = /^#### (.*)$/.exec(l);
      if (u) {
        flush();
        if (!u[1].startsWith("/")) b.turn("user", u[1]);
        continue;
      }
      if (l.startsWith("> ")) {
        const f = /^> Applied edit to (.+)$/.exec(l);
        if (f) b.file(f[1].trim());
        if (/^> Commit [0-9a-f]{7}/.test(l)) b.t.commands += 0;
        continue;
      }
      assistant.push(l);
    }
    flush();
    if (b.t.turns.length) out.push(b.done());
  }
  return out;
}

/** Cursor transcripts (txt or jsonl) and anything unknown: role/text walker. */
export function parseGeneric(text: string, tool: string): Transcript {
  const b = new Builder(tool);
  const objs = lines(text);
  if (!objs.length) {
    // plain-text transcript: "user:" / "assistant:" (or "A:") headed blocks
    let role: Turn["role"] | undefined;
    let buf: string[] = [];
    const flush = () => {
      if (role) b.turn(role, buf.join("\n"));
      buf = [];
    };
    for (const l of text.split(/\r?\n/)) {
      const h = /^(user|human|assistant|a|ai|model):\s*$/i.exec(l.trim());
      if (h) {
        flush();
        role = /^(user|human)$/i.test(h[1]) ? "user" : "assistant";
      } else buf.push(l);
    }
    flush();
    return b.done();
  }
  for (const o of objs) {
    b.ts(o.timestamp || o.created_at || o.time);
    const role = String(o.role || o.message?.role || o.type || o.author || "").toLowerCase();
    const content = o.message?.content ?? o.content ?? o.text ?? o.message;
    const t = textOf(content);
    if (/^(user|human)$/.test(role)) b.turn("user", t);
    else if (/^(assistant|model|ai|gemini|agent)$/.test(role)) b.turn("assistant", t);
    const parts = Array.isArray(o.message?.content) ? o.message.content : Array.isArray(o.content) ? o.content : [];
    for (const c of parts) if (c?.type === "tool_use" || c?.type === "tool_call") b.tool(c.name, c.input || c.args);
  }
  return b.done();
}

/** Context that hooks (ours included) inject into the user's message: never part of what they asked. */
const INJECTED = /<(hook_context|hamyad-context|additional_context|system-reminder)>[\s\S]*?<\/\1>\s*/g;
export const stripInjected = (t: string) => (t || "").replace(INJECTED, "").trim();

function clean(t: Transcript): Transcript {
  t.turns = t.turns
    .map((x) => (x.role === "user" ? { ...x, text: stripInjected(x.text) } : x))
    .filter((x) => x.text && !(x.role === "user" && isNoise(x.text)));
  return t;
}

export function parseTranscript(tool: string, text: string): Transcript {
  switch (tool) {
    case "claude-code":
      return clean(parseClaude(text));
    case "codex":
      return clean(parseCodex(text));
    case "gemini-cli":
      return clean(parseGemini(text));
    case "copilot":
      return clean(parseCopilot(text));
    case "windsurf":
      return clean(parseWindsurf(text));
    default:
      return clean(parseGeneric(text, tool));
  }
}
