import type { McpServer } from "./server.js";
import { changesSince } from "../core/brain.js";
import { isKind } from "../core/entry.js";
import { renderBrief, renderChanges, renderMemoryMd } from "../core/render.js";
import { brainTimeline, sortTimeline } from "../core/timeline.js";
import { VERSION } from "../version.js";

/**
 * Plain REST + OpenAPI 3.1 view of the same brain, for AI tools that cannot speak MCP:
 * ChatGPT custom GPT Actions, Gemini / Grok / Perplexity (via URL fetch of /api/memory.md),
 * scripts, CI, Raycast, Shortcuts… Same auth as /mcp (Bearer, X-Hamyad-Key or ?key=).
 */

const ENTRY = {
  type: "object",
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["decision", "task", "note", "context", "session", "change"] },
    title: { type: "string" },
    body: { type: "string" },
    status: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    source: { type: "string", description: "which AI tool wrote it (claude-code, chatgpt, codex, cursor, gemini-cli, …)" },
    created: { type: "string" },
    updated: { type: "string" },
    supersedes: { type: "array", items: { type: "string" } },
    supersededBy: { type: "string" },
  },
};

const MESSAGE = { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } } };

export function openApiSpec(serverUrl: string) {
  const json = (schema: unknown) => ({ "application/json": { schema } });
  const ok = (schema: unknown, description = "OK") => ({ "200": { description, content: json(schema) } });
  const q = (name: string, description: string, required = false) => ({ name, in: "query", required, description, schema: { type: "string" } });
  return {
    openapi: "3.1.0",
    info: {
      title: "hamyad project brain",
      version: VERSION,
      description:
        "One shared memory for every AI tool on a project (Claude, ChatGPT, Codex, Gemini, Cursor, Copilot, Windsurf, Grok, Perplexity, aider…). Call getContext at the start of a conversation. Save decisions with remember (pass supersedes when one replaces an older decision).",
    },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas: { Entry: ENTRY } },
    security: [{ bearer: [] }],
    paths: {
      "/api/context": {
        get: {
          operationId: "getContext",
          summary: "Project brief: decisions in force (and superseded ones), open tasks, recent sessions and code changes from every AI tool",
          parameters: [q("since", "ISO time: also list what changed since then")],
          responses: ok({ type: "object", properties: { brief: { type: "string" }, changes: { type: "string" } } }),
        },
      },
      "/api/search": {
        get: {
          operationId: "searchBrain",
          summary: "Search decisions, tasks, notes, context, sessions and changes",
          parameters: [q("q", "query", true), q("kind", "decision|task|note|context|session|change")],
          responses: ok({ type: "object", properties: { results: { type: "array", items: { $ref: "#/components/schemas/Entry" } } } }),
        },
      },
      "/api/entries": {
        get: {
          operationId: "listEntries",
          summary: "List entries, newest first",
          parameters: [q("kind", "decision|task|note|context|session|change"), q("status", "e.g. open, active, superseded"), q("limit", "max results (default 30)")],
          responses: ok({ type: "object", properties: { entries: { type: "array", items: { $ref: "#/components/schemas/Entry" } } } }),
        },
        post: {
          operationId: "remember",
          summary: "Save a decision, task, note or context fact. Pass supersedes (ids) when it replaces older decisions.",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["kind", "title"],
              properties: {
                kind: { type: "string", enum: ["decision", "task", "note", "context"] },
                title: { type: "string" },
                body: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                status: { type: "string" },
                supersedes: { type: "array", items: { type: "string" } },
              },
            }),
          },
          responses: ok(MESSAGE),
        },
      },
      "/api/entries/{id}": {
        get: {
          operationId: "getEntry",
          summary: "One entry with its full body",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: ok({ $ref: "#/components/schemas/Entry" }),
        },
        patch: {
          operationId: "updateEntry",
          summary: "Change status (e.g. task done), append a note, or mark it superseded_by a newer entry",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: json({ type: "object", properties: { status: { type: "string" }, append: { type: "string" }, title: { type: "string" }, superseded_by: { type: "string" } } }),
          },
          responses: ok(MESSAGE),
        },
      },
      "/api/sessions": {
        post: {
          operationId: "logSession",
          summary: "Save a 3-8 line summary of this conversation so every other AI tool sees it",
          requestBody: { required: true, content: json({ type: "object", required: ["summary"], properties: { summary: { type: "string" }, title: { type: "string" } } }) },
          responses: ok(MESSAGE),
        },
      },
      "/api/timeline": {
        get: {
          operationId: "timeline",
          summary: "Recent activity across all AI tools (sessions, code changes, decisions, supersessions)",
          parameters: [q("tool", "filter by tool id"), q("since", "ISO time"), q("limit", "default 40")],
          responses: ok({ type: "object", properties: { items: { type: "array", items: { type: "object" } } } }),
        },
      },
      "/api/memory.md": {
        get: {
          operationId: "memoryMarkdown",
          summary: "The whole brain as one MEMORY.md (for tools that read a URL or take a file upload)",
          responses: { "200": { description: "Markdown", content: { "text/markdown": { schema: { type: "string" } } } } },
        },
      },
    },
  };
}

type Reply = (body: unknown, status?: number, headers?: Record<string, string>) => Response;

const firstText = (r: any): string => r?.content?.map((c: any) => c.text).join("\n") ?? "";

/** Handle /api/* (auth already checked). */
export async function handleRest(req: Request, url: URL, path: string, server: McpServer, reply: Reply, raw: (body: string, type: string) => Response): Promise<Response> {
  const brain = server.brain;
  const p = url.searchParams;
  const body = req.method === "POST" || req.method === "PATCH" ? await req.json().catch(() => ({})) : {};
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await server.callTool(name, args);
    return reply({ ok: !r.isError, message: firstText(r) }, r.isError ? 400 : 200);
  };
  const m = /^\/api\/entries\/([^/]+)$/.exec(path);
  if (path === "/api/context" && req.method === "GET") {
    const s = await brain.snapshot();
    const since = p.get("since") || undefined;
    return reply({ brief: renderBrief(s.config, s.entries), changes: since ? renderChanges(changesSince(s.entries, since, server.source), { since }) : "" });
  }
  if (path === "/api/memory.md" && req.method === "GET") {
    const s = await brain.snapshot();
    const files = (await brain.backend.readAll()).filter((f) => f.path === "config.json" || (f.path.includes("/") && f.path.endsWith(".md")));
    return raw(renderMemoryMd(s.config, s.entries, files), "text/markdown; charset=utf-8");
  }
  if (path === "/api/search" && req.method === "GET") {
    const kind = p.get("kind");
    return reply({ results: await brain.search(p.get("q") || "", { kind: isKind(kind) ? kind : undefined, limit: Number(p.get("limit") || 15) }) });
  }
  if (path === "/api/entries" && req.method === "GET") {
    const kind = p.get("kind");
    return reply({ entries: await brain.list({ kind: isKind(kind) ? kind : undefined, status: p.get("status") || undefined, tag: p.get("tag") || undefined, limit: Number(p.get("limit") || 30) }) });
  }
  if (path === "/api/entries" && req.method === "POST") return call("brain_remember", body);
  if (m && req.method === "GET") {
    const e = await brain.get(decodeURIComponent(m[1]));
    return e ? reply(e) : reply({ error: "not_found" }, 404);
  }
  if (m && req.method === "PATCH") return call("brain_update", { ...body, id: decodeURIComponent(m[1]) });
  if (path === "/api/sessions" && req.method === "POST") return call("brain_log_session", body);
  if (path === "/api/timeline" && req.method === "GET") {
    const s = await brain.snapshot();
    return reply({ items: sortTimeline(brainTimeline(s.entries), { tool: p.get("tool") || undefined, since: p.get("since") || undefined, limit: Number(p.get("limit") || 40) }) });
  }
  return reply({ error: "not_found" }, 404);
}
