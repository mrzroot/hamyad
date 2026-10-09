import http from "node:http";
import { createHttpHandler, HttpOptions, RequestContext } from "../mcp/http.js";
import type { McpServer } from "../mcp/server.js";

/** Run the web-standard MCP handler on a Node http server. */
export function serveHttp(getServer: (ctx: RequestContext) => McpServer, opts: HttpOptions & { port: number; host?: string }): Promise<http.Server> {
  const handler = createHttpHandler(getServer, opts);
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const url = `http://${req.headers.host || "localhost"}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" || !body.length ? undefined : body,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host || "127.0.0.1", () => resolve(server)));
}
