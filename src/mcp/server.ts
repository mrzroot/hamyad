import { Brain, changesSince } from "../core/brain.js";
import { Entry, KINDS, TASK_STATUSES, isKind } from "../core/entry.js";
import { renderBrief, renderChanges } from "../core/render.js";
import { brainTimeline, renderTimeline, sortTimeline } from "../core/timeline.js";
import { sourceFromClient, toolLabel } from "../core/tools.js";
import { VERSION } from "../version.js";

/**
 * A small, dependency-free MCP server core (JSON-RPC 2.0). The same object is
 * driven by the stdio transport (Claude Code / Claude Desktop) and the
 * Streamable HTTP transport (claude.ai custom connector, Workers, self-host).
 */

export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Json = any;
export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Json;
}
export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Json;
  error?: { code: number; message: string; data?: Json };
}

export const INSTRUCTIONS = `hamyad is this project's shared brain: ONE memory used by every AI tool on the project (Claude Code, Claude.ai, Codex, ChatGPT, Gemini CLI, Cursor, Copilot, Windsurf, aider) and stored in the repo's .brain/ folder (or a shared MEMORY.md).
- At the start of a conversation about the project, call brain_context once. Decisions in it are binding; superseded ones are not.
- When the user makes or confirms a decision, call brain_remember with kind "decision" (title = the decision, body = why + alternatives rejected). If it replaces or contradicts an earlier decision, pass supersedes: [old ids] so every other tool stops following the old one. brain_remember also tells you about likely conflicts.
- New work items -> kind "task"; research findings, links, gotchas -> kind "note"; stable facts about the project (stack, goals, constraints) -> kind "context".
- Before proposing something that may already be decided, call brain_search.
- When a task changes state, call brain_update with its id and the new status.
- brain_timeline shows what each tool did recently (chats, sessions, code changes, decisions).
- At the end of a substantial chat, call brain_log_session with a 3-8 line summary so the coding agents see it next session.`;

const kindProp = { type: "string", enum: [...KINDS], description: "decision | task | note | context | session" };

export const TOOLS = [
  {
    name: "brain_context",
    title: "Read the project brain",
    description:
      "Return the shared project brief: context, decisions in force (and what was superseded), open tasks, recent notes, and recent sessions and code changes from every AI tool. Call this once at the start of any conversation about the project. Pass `since` (ISO time) to get what changed since then first.",
    inputSchema: {
      type: "object",
      properties: {
        max_chars: { type: "integer", minimum: 500, maximum: 50000 },
        since: { type: "string", description: "ISO timestamp; prepend the decisions/tasks changed since then" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "brain_remember",
    title: "Remember a decision, task, note or fact",
    description:
      "Save a durable item to the shared project brain (every other AI tool on the project sees it). Use kind=decision for choices made, task for work items, note for research/findings, context for stable project facts. When a decision replaces an older one, pass its id in `supersedes`; the old one is marked superseded everywhere.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { ...kindProp, enum: ["decision", "task", "note", "context"] },
        title: { type: "string", description: "One line. For decisions, state the decision itself." },
        body: { type: "string", description: "Markdown details: rationale, alternatives, links, acceptance criteria." },
        tags: { type: "array", items: { type: "string" } },
        status: { type: "string", description: `task: ${TASK_STATUSES.join("|")}; decision: active|superseded|reverted` },
        supersedes: { type: "array", items: { type: "string" }, description: "ids of older decisions/facts this one replaces" },
      },
      required: ["kind", "title"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "brain_search",
    title: "Search the project brain",
    description: "Keyword search (English and Persian aware) over all entries. Use before re-deciding something.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, kind: kindProp, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "brain_list",
    title: "List brain entries",
    description: "List entries, newest first, optionally filtered by kind, status or tag.",
    inputSchema: {
      type: "object",
      properties: {
        kind: kindProp,
        status: { type: "string" },
        tag: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "brain_get",
    title: "Read one entry",
    description: "Return the full Markdown of one entry by id (or unique id suffix).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "brain_update",
    title: "Update an entry",
    description:
      "Change an entry: set a task's status (open|doing|blocked|done|dropped), mark a decision superseded, append a dated follow-up, retitle or retag. Prefer `append` over replacing `body`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        append: { type: "string", description: "Text appended with a timestamp and source." },
        title: { type: "string" },
        body: { type: "string", description: "Replaces the whole body." },
        tags: { type: "array", items: { type: "string" } },
        superseded_by: { type: "string", description: "id of the newer entry that replaces this one (marks it superseded)" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "brain_timeline",
    title: "Cross-tool timeline",
    description:
      "Recent activity across every AI tool on the project, newest first: chat/agent sessions, code change sets, decisions made and superseded, tasks. Filter by tool (claude-code, claude-chat, codex, chatgpt, gemini-cli, cursor, copilot, windsurf, aider).",
    inputSchema: {
      type: "object",
      properties: { tool: { type: "string" }, since: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "brain_log_session",
    title: "Log a conversation summary",
    description:
      "Record a short summary of this conversation (what was explored, decided, left open) so the next session in any tool (Claude Code, Codex, Cursor, Gemini…) can pick it up.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, summary: { type: "string" } },
      required: ["summary"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

function fmtEntry(e: Entry): string {
  return `${e.kind} \`${e.id}\`${e.status ? ` [${e.status}]` : ""} ${e.title}${e.tags.length ? ` #${e.tags.join(" #")}` : ""} (${(e.updated || e.created).slice(0, 10)}, ${toolLabel(e.source)})${e.supersededBy ? ` → superseded by \`${e.supersededBy}\`` : ""}`;
}

function full(e: Entry): string {
  return `# ${e.title}\n\nid: ${e.id} · kind: ${e.kind}${e.status ? ` · status: ${e.status}` : ""} · source: ${e.source} · created: ${e.created} · updated: ${e.updated}${e.tags.length ? ` · tags: ${e.tags.join(", ")}` : ""}\npath: .brain/${e.path}\n\n${e.body}`;
}

/** ChatGPT deep research / company knowledge expect read-only `search` + `fetch` tools with this shape. */
export const OPENAI_COMPAT_TOOLS = [
  {
    name: "search",
    title: "Search the project brain",
    description: "Search the shared project brain (decisions, tasks, notes, context, sessions and code changes from every AI tool). Returns ids for fetch.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "fetch",
    title: "Fetch a brain entry",
    description: "Fetch one entry of the shared project brain by id (use `brief` for the whole brief).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export class McpServer {
  /** set from initialize.clientInfo when no explicit source was configured */
  clientSource?: string;
  /** also expose OpenAI's `search`/`fetch` tools (set for ChatGPT requests) */
  openaiCompat = false;
  /** public URL of entries, used in `fetch` results */
  baseUrl?: string;
  constructor(
    readonly brain: Brain,
    readonly info: { name?: string; source?: string; fallbackSource?: string } = {},
  ) {}

  get source(): string | undefined {
    return this.info.source || this.clientSource || this.info.fallbackSource;
  }

  /** Handle one JSON-RPC message. Returns undefined for notifications. */
  async handle(msg: RpcRequest): Promise<RpcResponse | undefined> {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return { jsonrpc: "2.0", id: (msg as any)?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
    }
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      const result = await this.dispatch(msg.method, msg.params || {});
      if (isNotification) return undefined;
      return { jsonrpc: "2.0", id: msg.id!, result };
    } catch (err: any) {
      if (isNotification) return undefined;
      const code = typeof err?.rpcCode === "number" ? err.rpcCode : -32603;
      return { jsonrpc: "2.0", id: msg.id!, error: { code, message: String(err?.message || err) } };
    }
  }

  private async dispatch(method: string, p: Json): Promise<Json> {
    switch (method) {
      case "initialize": {
        const requested = p?.protocolVersion;
        this.clientSource = sourceFromClient(p?.clientInfo?.name);
        return {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: this.info.name || "hamyad", title: "hamyad: shared project brain", version: VERSION },
          instructions: INSTRUCTIONS,
        };
      }
      case "ping":
        return {};
      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/roots/list_changed":
        return {};
      case "tools/list":
        return { tools: this.openaiCompat ? [...TOOLS, ...OPENAI_COMPAT_TOOLS] : TOOLS };
      case "tools/call":
        return this.callTool(p?.name, p?.arguments || {});
      case "resources/list":
        return {
          resources: [
            { uri: "brain://brief", name: "brief", title: "Project brain brief", mimeType: "text/markdown", description: "Compact brief of the shared project brain" },
          ],
        };
      case "resources/templates/list":
        return { resourceTemplates: [{ uriTemplate: "brain://entry/{id}", name: "entry", mimeType: "text/markdown" }] };
      case "resources/read": {
        const uri = String(p?.uri || "");
        if (uri === "brain://brief") {
          const s = await this.brain.snapshot();
          return { contents: [{ uri, mimeType: "text/markdown", text: renderBrief(s.config, s.entries) }] };
        }
        const m = /^brain:\/\/entry\/(.+)$/.exec(uri);
        if (m) {
          const e = await this.brain.get(decodeURIComponent(m[1]));
          if (e) return { contents: [{ uri, mimeType: "text/markdown", text: full(e) }] };
        }
        throw Object.assign(new Error(`resource not found: ${uri}`), { rpcCode: -32002 });
      }
      case "prompts/list":
        return {
          prompts: [
            { name: "brain_kickoff", title: "Start with the project brain", description: "Load the shared brain and summarise where the project stands." },
            { name: "brain_wrapup", title: "Save this conversation to the brain", description: "Extract decisions, tasks and notes from this conversation and save them." },
          ],
        };
      case "prompts/get": {
        const name = p?.name;
        if (name === "brain_kickoff") {
          const s = await this.brain.snapshot();
          return {
            description: "Project brain kickoff",
            messages: [
              {
                role: "user",
                content: { type: "text", text: `Here is the shared project brain. Summarise where the project stands in 5 bullets, then ask what we work on.\n\n${renderBrief(s.config, s.entries)}` },
              },
            ],
          };
        }
        if (name === "brain_wrapup") {
          return {
            description: "Save conversation to brain",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "Go through this conversation. For every decision we made call brain_remember(kind=decision), for every new work item brain_remember(kind=task), for findings brain_remember(kind=note); update finished tasks with brain_update; finally call brain_log_session with a short summary. Show me the list of what you saved.",
                },
              },
            ],
          };
        }
        throw Object.assign(new Error(`unknown prompt: ${name}`), { rpcCode: -32602 });
      }
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { rpcCode: -32601 });
    }
  }

  async callTool(name: string, a: Json): Promise<Json> {
    const source = this.source;
    try {
      switch (name) {
        case "search": {
          const hits = await this.brain.search(String(a.query || ""), { limit: 20 });
          const results = hits.map((e) => ({ id: e.id, title: `${e.kind}: ${e.title}`, url: `${this.baseUrl || "brain://entry/"}${this.baseUrl ? "api/entries/" : ""}${e.id}` }));
          return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
        }
        case "fetch": {
          const id = String(a.id || "");
          if (id === "brief") {
            const s = await this.brain.snapshot();
            return { content: [{ type: "text", text: JSON.stringify({ id, title: "Project brain brief", text: renderBrief(s.config, s.entries), url: "brain://brief" }) }] };
          }
          const e = await this.brain.get(id);
          if (!e) return text(`no entry matches "${id}"`, true);
          return { content: [{ type: "text", text: JSON.stringify({ id: e.id, title: e.title, text: full(e), url: `${this.baseUrl ? `${this.baseUrl}api/entries/` : "brain://entry/"}${e.id}`, metadata: { kind: e.kind, status: e.status, source: e.source, updated: e.updated } }) }] };
        }
        case "brain_context": {
          const s = await this.brain.snapshot();
          const brief = renderBrief(s.config, s.entries, { maxChars: a.max_chars ? Number(a.max_chars) : s.config.briefChars });
          const changed = a.since ? renderChanges(changesSince(s.entries, String(a.since), source), { since: String(a.since) }) : "";
          return text(changed ? `${changed}\n\n${brief}` : brief);
        }
        case "brain_remember": {
          if (!["decision", "task", "note", "context"].includes(a.kind)) return text(`kind must be one of decision, task, note, context`, true);
          const supersedes = Array.isArray(a.supersedes) ? a.supersedes.map(String) : typeof a.supersedes === "string" && a.supersedes ? a.supersedes.split(/[\s,]+/) : [];
          const e = await this.brain.add({ kind: a.kind, title: String(a.title || ""), body: a.body, tags: a.tags, status: a.status, source, supersedes });
          let msg = `Saved ${fmtEntry(e)}\nfile: .brain/${e.path}`;
          if (supersedes.length) msg += `\nMarked superseded: ${e.supersedes!.map((x) => `\`${x}\``).join(", ")}. Every tool now sees the new decision instead.`;
          else {
            const maybe = await this.brain.conflicts({ kind: e.kind, title: e.title, tags: e.tags }, e.id);
            if (maybe.length)
              msg += `\n\nPossibly conflicting earlier ${e.kind}s still in force:\n${maybe.map((m) => `- ${fmtEntry(m)}`).join("\n")}\nIf the new one replaces any of them, call brain_update with {id: <old id>, superseded_by: "${e.id}"} (ask the user if unsure).`;
          }
          return text(msg);
        }
        case "brain_timeline": {
          const s = await this.brain.snapshot();
          const items = sortTimeline(brainTimeline(s.entries), { tool: a.tool ? String(a.tool) : undefined, since: a.since ? String(a.since) : undefined, limit: a.limit ? Number(a.limit) : 40 });
          return text(items.length ? renderTimeline(items) : "Nothing recorded yet.");
        }
        case "brain_search": {
          const hits = await this.brain.search(String(a.query || ""), { kind: isKind(a.kind) ? a.kind : undefined, limit: a.limit ? Number(a.limit) : 10 });
          if (!hits.length) return text(`No entries match "${a.query}".`);
          return text(hits.map((e) => `- ${fmtEntry(e)}\n  ${e.body.split("\n").find((l) => l.trim())?.slice(0, 200) || ""}`).join("\n"));
        }
        case "brain_list": {
          const list = await this.brain.list({ kind: isKind(a.kind) ? a.kind : undefined, status: a.status, tag: a.tag, limit: a.limit ? Number(a.limit) : 30 });
          return text(list.length ? list.map((e) => `- ${fmtEntry(e)}`).join("\n") : "No entries.");
        }
        case "brain_get": {
          const e = await this.brain.get(String(a.id || ""));
          return e ? text(full(e)) : text(`No entry matches "${a.id}".`, true);
        }
        case "brain_update": {
          if (a.superseded_by) {
            const { old, by } = await this.brain.supersede(String(a.id || ""), String(a.superseded_by));
            return text(`Updated ${fmtEntry(old)}\nIt is now superseded by ${fmtEntry(by)}; every tool will be told at its next session start.`);
          }
          const e = await this.brain.update(String(a.id || ""), { status: a.status, append: a.append, title: a.title, body: a.body, tags: a.tags, source });
          return text(`Updated ${fmtEntry(e)}`);
        }
        case "brain_log_session": {
          const summary = String(a.summary || "").trim();
          if (!summary) return text("summary is required", true);
          const title = String(a.title || "").trim() || `${toolLabel(source || "chat")}: ${summary.split("\n")[0].slice(0, 80)}`;
          const e = await this.brain.add({ kind: "session", title, body: summary, source });
          return text(`Logged ${fmtEntry(e)}`);
        }
        default:
          throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
      }
    } catch (err: any) {
      if (err?.rpcCode) throw err;
      return text(`Error: ${err?.message || err}`, true);
    }
  }
}
