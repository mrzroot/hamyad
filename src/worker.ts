/**
 * Cloudflare Workers entry: a remote MCP server for claude.ai custom connectors
 * (and Claude Desktop / any MCP client) whose storage is the `.brain/` folder of
 * a GitHub repository. Every write becomes a commit, so GitHub stays the source
 * of truth and `hamyad sync` / the Claude Code hooks pull it locally.
 *
 * Secrets: GITHUB_TOKEN (fine-grained, Contents: read & write on one repo),
 *          HAMYAD_TOKEN (shared secret for the connector URL / header).
 * Vars:    GITHUB_REPO ("owner/repo"), GITHUB_BRANCH (default main), BRAIN_DIR (default .brain)
 */
import { Brain } from "./core/brain.js";
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
      const handler = createHttpHandler(
        () => new McpServer(new Brain(backend, { source: env.HAMYAD_SOURCE || "claude-chat" }), { source: env.HAMYAD_SOURCE || "claude-chat" }),
        { token: env.HAMYAD_TOKEN, label: `github:${env.GITHUB_REPO}` },
      );
      return handler(request);
    },
  };
}

export default createWorker();
