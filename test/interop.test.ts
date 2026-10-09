// Interop with the official MCP TypeScript SDK client, over both transports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CLI, gitInit, rm, tmp, cli } from "./helpers.js";
import { Brain } from "../src/core/brain.js";
import { MemoryBackend } from "../src/core/backend.js";
import { McpServer } from "../src/mcp/server.js";
import { serveHttp } from "../src/node/serve.js";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

const textOf = (r: any) => r.content.map((c: any) => c.text).join("\n");

test("official SDK client over stdio (Claude Code / Desktop path)", async () => {
  const dir = tmp();
  try {
    gitInit(dir);
    assert.equal(cli(dir, ["init", "--project", "stdio-demo"]).code, 0);
    const client = new Client({ name: "claude-code", version: "1.0.0" }); // clientInfo drives attribution
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp", "--dir", dir], stderr: "pipe" }));
    assert.equal(client.getServerVersion()?.name, "hamyad");
    assert.match(client.getInstructions() || "", /shared brain/);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "brain_remember"));
    const r = await client.callTool({ name: "brain_remember", arguments: { kind: "task", title: "Wire up SDK test", tags: ["ci"] } });
    assert.match(textOf(r), /Saved task/);
    const ctx = await client.callTool({ name: "brain_context", arguments: {} });
    assert.match(textOf(ctx), /# Project brain: stdio-demo/);
    assert.match(textOf(ctx), /Wire up SDK test/);
    const res = await client.readResource({ uri: "brain://brief" });
    assert.match(String((res.contents[0] as any).text), /Wire up SDK test/);
    await client.close();
    const files = readdirSync(path.join(dir, ".brain", "tasks")).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1);
    assert.match(readFileSync(path.join(dir, ".brain", "tasks", files[0]), "utf8"), /source: claude-code/);
  } finally {
    rm(dir);
  }
});

test("official SDK client over Streamable HTTP with bearer token and with token in path (claude.ai path)", async () => {
  const be = new MemoryBackend();
  const brain = new Brain(be, { source: "claude-chat" });
  const http = await serveHttp(() => new McpServer(brain, { source: "claude-chat" }), { port: 0, token: "t0ken" });
  const port = (http.address() as AddressInfo).port;
  try {
    const c1 = new Client({ name: "sdk-http", version: "1.0.0" });
    await c1.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { authorization: "Bearer t0ken" } } }));
    const saved = await c1.callTool({ name: "brain_remember", arguments: { kind: "decision", title: "تصمیم: استفاده از Workers", body: "رایگان" } });
    assert.match(textOf(saved), /Saved decision/);
    await c1.close();

    const c2 = new Client({ name: "sdk-http-path", version: "1.0.0" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/t0ken`)));
    const found = await c2.callTool({ name: "brain_search", arguments: { query: "workers" } });
    assert.match(textOf(found), /تصمیم: استفاده از Workers/);
    const prompts = await c2.listPrompts();
    assert.ok(prompts.prompts.some((p) => p.name === "brain_wrapup"));
    await c2.close();

    const c3 = new Client({ name: "sdk-http-noauth", version: "1.0.0" });
    await assert.rejects(c3.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))));
  } finally {
    http.close();
  }
});
