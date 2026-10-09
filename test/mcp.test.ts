import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/core/brain.js";
import { MemoryBackend } from "../src/core/backend.js";
import { McpServer, TOOLS } from "../src/mcp/server.js";
import { createHttpHandler } from "../src/mcp/http.js";

function server(source = "claude-chat") {
  const be = new MemoryBackend();
  return { be, s: new McpServer(new Brain(be, { source }), { source }) };
}

const call = async (s: McpServer, name: string, args: any = {}) => {
  const r = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  assert.ok(r && r.result, JSON.stringify(r));
  return r!.result as { content: { text: string }[]; isError?: boolean };
};

test("initialize negotiates protocol and advertises tools", async () => {
  const { s } = server();
  const r = await s.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(r!.result.protocolVersion, "2025-06-18");
  assert.ok(r!.result.capabilities.tools);
  assert.match(r!.result.instructions, /brain_context/);
  const odd = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(odd!.result.protocolVersion, "2025-11-25");
  const list = await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(list!.result.tools.map((t: any) => t.name), TOOLS.map((t) => t.name));
  for (const t of TOOLS) assert.equal(t.inputSchema.type, "object");
});

test("notifications get no response; unknown methods get -32601", async () => {
  const { s } = server();
  assert.equal(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
  const r = await s.handle({ jsonrpc: "2.0", id: 9, method: "nope" });
  assert.equal(r!.error!.code, -32601);
  const bad = await s.handle({ foo: 1 } as any);
  assert.equal(bad!.error!.code, -32600);
});

test("tool round trip: remember, search, list, get, update, log, context", async () => {
  const { s, be } = server();
  const saved = await call(s, "brain_remember", { kind: "decision", title: "Use Cloudflare Workers", body: "free tier", tags: ["infra"] });
  assert.match(saved.content[0].text, /Saved decision `d-\d{8}-\w{4}` \[active\] Use Cloudflare Workers #infra/);
  const id = /`(d-[^`]+)`/.exec(saved.content[0].text)![1];
  assert.match([...be.files.values()][0], /source: claude-chat/);

  assert.match((await call(s, "brain_search", { query: "workers" })).content[0].text, /Use Cloudflare Workers/);
  assert.match((await call(s, "brain_list", { kind: "decision" })).content[0].text, new RegExp(id));
  assert.match((await call(s, "brain_get", { id })).content[0].text, /free tier/);
  assert.match((await call(s, "brain_update", { id, append: "confirmed by team" })).content[0].text, /Updated/);
  assert.match((await call(s, "brain_get", { id })).content[0].text, /confirmed by team/);
  assert.match((await call(s, "brain_log_session", { summary: "Explored hosting\nPicked Workers" })).content[0].text, /Logged session/);
  const ctx = (await call(s, "brain_context")).content[0].text;
  assert.match(ctx, /## Decisions/);
  assert.match(ctx, /## Recent sessions/);
});

test("tool errors are reported as isError results, not protocol errors", async () => {
  const { s } = server();
  assert.equal((await call(s, "brain_remember", { kind: "nope", title: "x" })).isError, true);
  assert.equal((await call(s, "brain_get", { id: "missing" })).isError, true);
  assert.equal((await call(s, "brain_update", { id: "missing", status: "done" })).isError, true);
  const unknown = await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rm_rf" } });
  assert.equal(unknown!.error!.code, -32602);
});

test("resources and prompts", async () => {
  const { s } = server();
  await call(s, "brain_remember", { kind: "context", title: "Stack: Node 20" });
  const res = await s.handle({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "brain://brief" } });
  assert.match(res!.result.contents[0].text, /Stack: Node 20/);
  const missing = await s.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "brain://entry/zzz" } });
  assert.equal(missing!.error!.code, -32002);
  const p = await s.handle({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "brain_kickoff" } });
  assert.match(p!.result.messages[0].content.text, /Stack: Node 20/);
});

// ------------------------------------------------------------------- HTTP

const post = (url: string, body: any, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

test("HTTP: token auth via bearer, header, path and query", async () => {
  const { s } = server();
  const h = createHttpHandler(() => s, { token: "sekret" });
  assert.equal((await h(post("https://x/mcp", ping))).status, 401);
  assert.equal((await h(post("https://x/mcp", ping, { authorization: "Bearer wrong" }))).status, 401);
  assert.equal((await h(post("https://x/mcp", ping, { authorization: "Bearer sekret" }))).status, 200);
  assert.equal((await h(post("https://x/mcp", ping, { "x-hamyad-key": "sekret" }))).status, 200);
  assert.equal((await h(post("https://x/mcp/sekret", ping))).status, 200);
  assert.equal((await h(post("https://x/mcp/nope", ping))).status, 401);
  assert.equal((await h(post("https://x/mcp?key=sekret", ping))).status, 200);
  assert.equal((await h(post("https://x/elsewhere", ping))).status, 404);
});

test("HTTP: notifications -> 202, batch, GET -> 405, health, SSE framing, parse error", async () => {
  const { s } = server();
  const h = createHttpHandler(() => s);
  assert.equal((await h(post("https://x/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }))).status, 202);
  const batch = await h(post("https://x/mcp", [ping, { ...ping, id: 2 }]));
  assert.deepEqual((await batch.json()).map((r: any) => r.id), [1, 2]);
  assert.equal((await h(new Request("https://x/mcp"))).status, 405);
  assert.equal((await (await h(new Request("https://x/"))).json()).name, "hamyad");
  assert.equal((await h(new Request("https://x/.well-known/oauth-protected-resource"))).status, 404);
  const sse = await h(post("https://x/mcp", ping, { accept: "text/event-stream" }));
  assert.equal(sse.headers.get("content-type"), "text/event-stream");
  assert.match(await sse.text(), /^event: message\ndata: \{"jsonrpc":"2\.0","id":1,"result":\{\}\}\n\n$/);
  const bad = await h(new Request("https://x/mcp", { method: "POST", body: "{nope" }));
  assert.equal(bad.status, 400);
  assert.equal((await h(new Request("https://x/mcp", { method: "OPTIONS" }))).status, 204);
});
