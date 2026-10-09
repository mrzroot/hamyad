import type { McpServer, RpcResponse } from "./server.js";
import { VERSION } from "../version.js";
import { handleRest, openApiSpec } from "./rest.js";

export interface HttpOptions {
  /** Shared secret. Accepted as `Authorization: Bearer`, `X-Hamyad-Key` header, `?key=` or a `/mcp/<token>` path. */
  token?: string;
  /** Path prefix of the MCP endpoint, default `/mcp` */
  path?: string;
  /** Extra info for the GET / health page */
  label?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, x-hamyad-key, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface RequestContext {
  /** tool that is calling: `?source=` / `X-Hamyad-Source`, else guessed from the User-Agent */
  source?: string;
}

/** claude.ai and ChatGPT call connectors from their clouds; tell them apart so entries are attributed. */
export function requestSource(req: Request, url: URL): string | undefined {
  const explicit = url.searchParams.get("source") || req.headers.get("x-hamyad-source");
  if (explicit) return explicit.replace(/[^\w.-]/g, "").slice(0, 40) || undefined;
  const ua = req.headers.get("user-agent") || "";
  if (/openai|chatgpt/i.test(ua)) return "chatgpt";
  if (/perplexity/i.test(ua)) return "perplexity";
  if (/grok|xai/i.test(ua)) return "grok";
  if (/google|gemini/i.test(ua)) return "gemini-app";
  if (/claude|anthropic/i.test(ua)) return "claude-chat";
  return undefined;
}

/**
 * Stateless MCP Streamable HTTP endpoint built on web-standard Request/Response,
 * so it runs unchanged on Cloudflare Workers, Deno, Bun and Node (via adapter).
 */
export function createHttpHandler(getServer: (ctx: RequestContext) => McpServer | Promise<McpServer>, opts: HttpOptions = {}) {
  const base = (opts.path || "/mcp").replace(/\/+$/, "");
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const origin = `${req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") || url.host}`;
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ name: "hamyad", version: VERSION, mcp: base, rest: "/api", openapi: "/openapi.json", auth: opts.token ? "token" : "none", store: opts.label });
    }
    // the schema holds no data: public, so GPT Actions / Gemini / scripts can import it by URL
    if (url.pathname === "/openapi.json") return json(openApiSpec(origin));
    // No OAuth: tell clients so instead of 404-ing on discovery documents.
    if (url.pathname.startsWith("/.well-known/")) return json({ error: "not_found" }, 404);

    let pathToken: string | undefined;
    let rest: string | undefined;
    if (url.pathname === base) {
      /* ok */
    } else if (url.pathname.startsWith("/api/")) {
      rest = url.pathname;
    } else if (url.pathname.startsWith(base + "/")) {
      pathToken = decodeURIComponent(url.pathname.slice(base.length + 1));
    } else return json({ error: "not_found" }, 404);

    if (opts.token) {
      const auth = req.headers.get("authorization") || "";
      const given =
        (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "") ||
        req.headers.get("x-hamyad-key") ||
        url.searchParams.get("key") ||
        pathToken ||
        "";
      if (!safeEqual(given, opts.token)) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: missing or wrong hamyad token" } }, 401);
      }
    }

    if (rest) {
      const server = await getServer({ source: requestSource(req, url) || "api" });
      server.baseUrl = `${origin}/`;
      try {
        return await handleRest(req, url, rest, server, (b, status = 200, h = {}) => json(b, status, h), (b, type) => new Response(b, { status: 200, headers: { "content-type": type, ...CORS } }));
      } catch (err: any) {
        return json({ error: String(err?.message || err) }, 400);
      }
    }

    if (req.method === "GET" || req.method === "DELETE") {
      // Stateless server: no server-initiated SSE stream and no sessions.
      return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed: use POST" } }, 405, { allow: "POST" });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    const ctx = { source: requestSource(req, url) };
    const server = await getServer(ctx);
    server.openaiCompat = ctx.source === "chatgpt";
    server.baseUrl = `${origin}/`;
    const msgs: any[] = Array.isArray(payload) ? payload : [payload];
    const responses = (await Promise.all(msgs.map((m) => (m && "method" in m ? server.handle(m) : undefined)))).filter(Boolean) as RpcResponse[];
    if (!responses.length) return new Response(null, { status: 202, headers: CORS });
    const body = Array.isArray(payload) ? responses : responses[0];
    const accept = req.headers.get("accept") || "";
    const proto = msgs.find((m) => m?.method === "initialize")?.params?.protocolVersion;
    const extra: Record<string, string> = proto ? { "mcp-protocol-version": (responses[0] as any)?.result?.protocolVersion || proto } : {};
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...CORS, ...extra },
      });
    }
    return json(body, 200, extra);
  };
}
