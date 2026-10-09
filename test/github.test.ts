import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/core/brain.js";
import { GitHubBackend, b64 } from "../src/backends/github.js";
import { createWorker } from "../src/worker.js";
import { fakeGitHub } from "./helpers.js";

test("b64 is UTF-8 safe", () => {
  assert.equal(Buffer.from(b64("سلام ✓ hi"), "base64").toString("utf8"), "سلام ✓ hi");
});

test("GitHubBackend: one GraphQL read, one commit per write, sha-guarded updates", async () => {
  const gh = fakeGitHub({ token: "ghp" });
  gh.files.set(".brain/config.json", { content: '{"project":"remote"}', sha: "c0" });
  gh.files.set(".brain/notes/hand-written.md", { content: "# Written on github.com\n\nhello", sha: "h0" });
  gh.files.set("src/app.ts", { content: "ignored", sha: "x" });
  const be = new GitHubBackend({ repo: "me/proj", token: "ghp", fetch: gh.fetch });
  const brain = new Brain(be, { source: "claude-chat" });

  const snap = await brain.snapshot();
  assert.equal(snap.config.project, "remote");
  assert.equal(snap.entries.length, 1);
  assert.equal(snap.entries[0].sha, "h0");
  assert.equal(gh.calls.length, 1);

  const e = await brain.add({ kind: "task", title: "Deploy worker" });
  const put = gh.calls.at(-1)!;
  assert.equal(put.method, "PUT");
  assert.match(put.url, /\/repos\/me\/proj\/contents\/\.brain\/tasks\/t-\d{8}-\w{4}-deploy-worker\.md$/);
  assert.match(gh.files.get(".brain/" + e.path)!.content, /title: Deploy worker/);

  await brain.update(e.id, { status: "done" });
  assert.match(gh.files.get(".brain/" + e.path)!.content, /status: done/);

  // concurrent edit elsewhere -> stale sha -> clear error
  const stale = (await brain.snapshot()).entries.find((x) => x.id === e.id)!;
  gh.files.set(".brain/" + e.path, { content: gh.files.get(".brain/" + e.path)!.content, sha: "changed-on-github" });
  await assert.rejects(be.write(stale.path, "x", "m", stale.sha), /changed in the meantime/);
});

test("GitHubBackend: empty repo, bad credentials, bad repo name", async () => {
  const gh = fakeGitHub({ token: "right" });
  assert.deepEqual(await new GitHubBackend({ repo: "a/b", token: "right", fetch: gh.fetch }).readAll(), []);
  await assert.rejects(new GitHubBackend({ repo: "a/b", token: "wrong", fetch: gh.fetch }).readAll(), /401/);
  assert.throws(() => new GitHubBackend({ repo: "nope", token: "x" }), /owner\/repo/);
});

test("Cloudflare Worker entry: claude.ai connector flow end to end against fake GitHub", async () => {
  const gh = fakeGitHub({ token: "pat" });
  const worker = createWorker(gh.fetch);
  const env = { GITHUB_TOKEN: "pat", GITHUB_REPO: "me/proj", HAMYAD_TOKEN: "s3cret" };
  const rpc = (body: any, path = "/mcp/s3cret") =>
    worker.fetch(new Request(`https://hamyad.example.workers.dev${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), env);

  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "/mcp")).status, 401);
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0" } } })).json();
  assert.equal(init.result.serverInfo.name, "hamyad");
  const saved = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "brain_remember", arguments: { kind: "decision", title: "Chat decided: use Zarinpal sandbox" } } })).json();
  assert.match(saved.result.content[0].text, /Saved decision/);
  const file = [...gh.files.keys()].find((k) => k.startsWith(".brain/decisions/"))!;
  assert.match(gh.files.get(file)!.content, /source: claude-chat/);
  const ctx = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "brain_context", arguments: {} } })).json();
  assert.match(ctx.result.content[0].text, /Zarinpal sandbox/);

  const misconfigured = await worker.fetch(new Request("https://x/mcp", { method: "POST", body: "{}" }), { GITHUB_TOKEN: "", GITHUB_REPO: "" } as any);
  assert.equal(misconfigured.status, 500);
});
