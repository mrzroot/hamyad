/**
 * Cloudflare Workers entry: a remote MCP server for claude.ai custom connectors
 * (and Claude Desktop / any MCP client) whose storage is the `.brain/` folder of
 * a GitHub repository. Every write becomes a commit, so GitHub stays the source
 * of truth and `hamyad sync` / the Claude Code hooks pull it locally.
 *
 * Secrets: GITHUB_TOKEN (fine-grained, Contents: read & write on one repo),
 *          HAMYAD_TOKEN (shared secret for the connector URL / header).
 * Vars:    GITHUB_REPO ("owner/repo"), GITHUB_BRANCH (default main), BRAIN_DIR (default .brain),
 *          HAMYAD_SOURCE (default attribution when the client is not recognised),
 *          HAMYAD_MEMORY_EXPORT ("0" disables refreshing .brain/MEMORY.md after each write)
 *
 * The same Worker serves claude.ai and ChatGPT (developer-mode connectors): add
 * `?source=chatgpt` / `?source=claude-chat` to the URL to label entries explicitly.
 */
import { Brain } from "./core/brain.js";
import type { Backend } from "./core/backend.js";
import { mergeConfig } from "./core/config.js";
import { parseEntry, Entry } from "./core/entry.js";
import { renderMemoryMd } from "./core/render.js";
import { GitHubBackend } from "./backends/github.js";
import { McpServer } from "./mcp/server.js";
import { createHttpHandler } from "./mcp/http.js";

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH?: string;
  BRAIN_DIR?: string;
  HAMYAD_TOKEN?: string;
  HAMYAD_SOURCE?: string;
  /** set to "1" to allow running without HAMYAD_TOKEN (not recommended) */
  HAMYAD_ALLOW_NO_AUTH?: string;
  HAMYAD_MEMORY_EXPORT?: string;
}

/** Re-render `<brain>/MEMORY.md` on GitHub so file-upload-only tools and Projects stay current. */
export async function refreshMemoryExport(backend: Backend): Promise<void> {
  const files = await backend.readAll();
  let config = mergeConfig({});
  const entries: Entry[] = [];
  for (const f of files) {
    if (f.path === "config.json") {
      try {
        config = mergeConfig(JSON.parse(f.content));
      } catch {
        /* defaults */
      }
    } else if (f.path.includes("/") && f.path.endsWith(".md")) {
      const e = parseEntry(f.path, f.content, f.sha);
      if (e) entries.push(e);
    }
  }
  if (!config.exports.some((x) => /(^|\/)\.brain\/MEMORY\.md$|^MEMORY\.md$/.test(x))) return;
  entries.sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
  const data = files.filter((f) => f.path === "config.json" || (f.path.includes("/") && f.path.endsWith(".md")));
  const next = renderMemoryMd(config, entries, data);
  const old = files.find((f) => f.path === "MEMORY.md");
  if (old && old.content === next) return;
  await backend.write("MEMORY.md", next, "brain: refresh MEMORY.md [hamyad]", old?.sha);
}

export function createWorker(fetchImpl?: typeof fetch) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      if (!env.HAMYAD_TOKEN && env.HAMYAD_ALLOW_NO_AUTH !== "1") {
        return new Response(
          JSON.stringify({ error: "HAMYAD_TOKEN secret is not set. Run: npx wrangler secret put HAMYAD_TOKEN" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return new Response(JSON.stringify({ error: "GITHUB_TOKEN secret and GITHUB_REPO var are required" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      const backend = new GitHubBackend({
        repo: env.GITHUB_REPO,
        token: env.GITHUB_TOKEN,
        branch: env.GITHUB_BRANCH,
        dir: env.BRAIN_DIR,
        fetch: fetchImpl,
        userAgent: "hamyad-worker",
      });
      const exportMemory = env.HAMYAD_MEMORY_EXPORT !== "0";
      const handler = createHttpHandler(
        (ctx) => {
          const fallback = env.HAMYAD_SOURCE || "claude-chat";
          const brain = new Brain(backend, {
            source: ctx.source || fallback,
            afterWrite: exportMemory ? () => refreshMemoryExport(backend).catch(() => undefined) : undefined,
          });
          return new McpServer(brain, { source: ctx.source, fallbackSource: fallback });
        },
        { token: env.HAMYAD_TOKEN, label: `github:${env.GITHUB_REPO}` },
      );
      return handler(request);
    },
  };
}

export default createWorker();
