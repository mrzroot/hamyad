import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli, gitInit, rm, sh, tmp } from "./helpers.js";
import { Brain, changesSince } from "../src/core/brain.js";
import { MemoryBackend } from "../src/core/backend.js";
import { renderChanges, parseMemoryMd } from "../src/core/render.js";
import { redact, redactText } from "../src/core/redact.js";
import { brainTimeline } from "../src/core/timeline.js";
import { sourceFromClient } from "../src/core/tools.js";
import { McpServer } from "../src/mcp/server.js";
import { MemoryFileBackend } from "../src/backends/memfile.js";
import { init } from "../src/node/init.js";
import { openProject, regenerate } from "../src/node/project.js";
import { hookOutput, normalizeHook, runHook } from "../src/node/hooks.js";
import { parseTranscript, parseAiderHistory } from "../src/node/transcripts.js";
import { importTool } from "../src/node/importers.js";
import { commitTool, projectTimeline } from "../src/node/timeline.js";
import { refreshMemoryExport } from "../src/worker.js";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");
const fx = (n: string) => readFileSync(path.join(FX, n), "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
process.env.HAMYAD_NO_BACKGROUND = "1";

function clock(start = Date.parse("2026-10-09T08:00:00Z")) {
  let t = start;
  return () => new Date((t += 60_000));
}

test("redact masks common secrets but keeps prose", () => {
  const src = [
    "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
    "gh ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
    "postgres://app:hunter2secret@db.local/app",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
    "We picked Postgres because the team knows it.",
  ].join("\n");
  const r = redact(src);
  for (const leak of ["abcdefghijklmnopqrstuvwxyz0123", "ghp_abc", "hunter2secret", "MIIEow", "sk-proj-abc"]) assert.ok(!r.text.includes(leak), leak);
  assert.match(r.text, /We picked Postgres because the team knows it\./);
  assert.ok(r.count >= 6);
  assert.equal(redactText("nothing to see"), "nothing to see");
});

test("brain redacts entries by default", async () => {
  const be = new MemoryBackend();
  const b = new Brain(be, { source: "t" });
  const e = await b.add({ kind: "note", title: "token", body: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789 for CI" });
  assert.ok(!e.body.includes("ghp_abcdef"));
  assert.ok(![...be.files.values()].some((f) => f.includes("ghp_abcdef")));
});

test("supersession: explicit supersedes, conflict hints, changes since last session", async () => {
  const be = new MemoryBackend();
  const b = new Brain(be, { source: "claude-chat", now: clock() });
  const old = await b.add({ kind: "decision", title: "Use MySQL for the main database", tags: ["db"] });
  const since = "2026-10-09T08:01:30Z";
  const hint = await b.conflicts({ kind: "decision", title: "Use PostgreSQL for the main database", tags: ["db"] });
  assert.deepEqual(hint.map((e) => e.id), [old.id]);
  const neu = await b.add({ kind: "decision", title: "Use PostgreSQL for the main database", body: "JSONB + team knows it", source: "claude-chat", supersedes: [old.id.slice(-4)] });
  assert.deepEqual(neu.supersedes, [old.id]);
  const o2 = (await b.get(old.id))!;
  assert.equal(o2.status, "superseded");
  assert.equal(o2.supersededBy, neu.id);
  assert.match(o2.body, /Superseded by/);
  await assert.rejects(b.add({ kind: "decision", title: "x", supersedes: ["nope"] }), /no entry matches/);

  const { entries, config } = await b.snapshot();
  const cs = changesSince(entries, since, "codex");
  assert.equal(cs.superseded.length, 1);
  const txt = renderChanges(cs, { since, tool: "codex" });
  assert.match(txt, /DECISIONS CHANGED since your last Codex session/);
  assert.match(txt, /REPLACED: "Use MySQL for the main database".*"Use PostgreSQL/);
  // the tool that made the change is not nagged about it
  assert.equal(changesSince(entries, since, "claude-chat").superseded.length, 0);
  // the brief lists it under Superseded
  const { renderBrief } = await import("../src/core/render.js");
  assert.match(renderBrief(config, entries), /Superseded[\s\S]*Use MySQL/);
  // timeline shows the supersession
  assert.ok(brainTimeline(entries).some((i) => i.type === "superseded" && /MySQL.*PostgreSQL/.test(i.title)));
  // supersede() links two existing entries
  const third = await b.add({ kind: "decision", title: "Use SQLite for tests" });
  const r = await b.supersede(neu.id, third.id);
  assert.equal(r.old.status, "superseded");
  assert.deepEqual(r.by.supersedes, [neu.id]);
});

test("MCP: clientInfo attribution, supersedes, conflict hints, timeline, since", async () => {
  const be = new MemoryBackend();
  const s = new McpServer(new Brain(be), { fallbackSource: "mcp" });
  await s.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "codex-mcp-client", version: "1" } } });
  const call = async (name: string, args: any = {}) => ((await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }))!.result as any).content[0].text as string;
  const a = await call("brain_remember", { kind: "decision", title: "Deploy on Fly.io", tags: ["deploy"] });
  assert.match(a, /\(2026|Codex\)/);
  assert.match([...be.files.values()][0], /source: codex/);
  const id = /`(d-[^`]+)`/.exec(a)![1];
  const b = await call("brain_remember", { kind: "decision", title: "Deploy on Hetzner VPS", tags: ["deploy"] });
  assert.match(b, /Possibly conflicting[\s\S]*Deploy on Fly\.io/);
  const bid = /`(d-[^`]+)`/.exec(b)![1];
  assert.match(await call("brain_update", { id, superseded_by: bid }), /now superseded/);
  const tl = await call("brain_timeline", {});
  assert.match(tl, /Fly\.io → Deploy on Hetzner/);
  const ctx = await call("brain_context", { since: "2000-01-01T00:00:00Z" });
  assert.match(ctx, /Superseded/);
  assert.equal(sourceFromClient("claude-code"), "claude-code");
  assert.equal(sourceFromClient("gemini-cli-mcp-client"), "gemini-cli");
  assert.equal(sourceFromClient("Visual Studio Code"), "copilot");
});

test("no-GitHub mode: a single MEMORY.md in a shared folder is the whole brain", async () => {
  const shared = tmp("hamyad-drive-");
  const a = tmp("hamyad-a-");
  const b = tmp("hamyad-b-");
  try {
    const store = path.join(shared, "MEMORY.md");
    const i = cli(a, ["init", "--store", store, "--tools", "claude", "--project", "drive-demo"]);
    assert.equal(i.code, 0, i.err + i.out);
    assert.ok(existsSync(path.join(a, ".hamyad.json")));
    assert.ok(!existsSync(path.join(a, ".brain")));
    const add = cli(a, ["add", "decision", "Use Supabase auth", "-m", "body with <!-- hamyad:file x --> marker"]);
    assert.equal(add.code, 0, add.err);
    const mem = readFileSync(store, "utf8");
    assert.match(mem, /Use Supabase auth/);
    assert.match(mem, /# drive-demo|drive-demo/);
    const files = parseMemoryMd(mem);
    const dec = files.find((f) => f.path.startsWith("decisions/"))!;
    assert.match(dec.content, /<!-- hamyad:file x -->/, "markers in bodies survive the round trip");
    // second machine / second checkout pointing at the same file
    writeFileSync(path.join(b, ".hamyad.json"), JSON.stringify({ store }));
    assert.match(cli(b, ["list"]).out, /Use Supabase auth/);
    const add2 = cli(b, ["add", "task", "Wire login page"]);
    assert.equal(add2.code, 0, add2.err);
    assert.match(cli(a, ["list"]).out, /Wire login page/);
    assert.match(readFileSync(path.join(a, "CLAUDE.md"), "utf8"), /Use Supabase auth/);
    assert.match(cli(a, ["status"]).out, /single file/);
    // the backend tolerates concurrent writers by re-reading before each write
    const be1 = new MemoryFileBackend(store);
    const be2 = new MemoryFileBackend(store);
    await new Brain(be1).add({ kind: "note", title: "from one" });
    await new Brain(be2).add({ kind: "note", title: "from two" });
    const titles = (await new Brain(new MemoryFileBackend(store)).list()).map((e) => e.title);
    assert.ok(titles.includes("from one") && titles.includes("from two"));
  } finally {
    rm(shared);
    rm(a);
    rm(b);
  }
});

test("no-GitHub mode: folder store + MEMORY.md export next to it", async () => {
  const shared = tmp("hamyad-drive-");
  const a = tmp("hamyad-a-");
  try {
    const store = path.join(shared, "brain");
    assert.equal(cli(a, ["init", "--store", store, "--tools", "claude"]).code, 0);
    assert.equal(cli(a, ["add", "note", "Folder store works"]).code, 0);
    assert.ok(existsSync(path.join(store, "notes")));
    assert.match(readFileSync(path.join(store, "MEMORY.md"), "utf8"), /Folder store works/);
    const out = path.join(a, "upload", "M.md");
    assert.equal(cli(a, ["export", "--out", out]).code, 0);
    assert.match(readFileSync(out, "utf8"), /hamyad:entries/);
  } finally {
    rm(shared);
    rm(a);
  }
});

test("dir store keeps .brain/MEMORY.md fresh after every CLI and MCP write", async () => {
  const dir = tmp();
  try {
    await init(dir, { project: "m", tools: ["claude"] });
    const p = openProject(dir, "claude-code", { autoRegenerate: true });
    await p.brain.add({ kind: "decision", title: "Fresh export please" });
    assert.match(readFileSync(path.join(dir, ".brain", "MEMORY.md"), "utf8"), /Fresh export please/);
  } finally {
    rm(dir);
  }
});

test("worker refreshes MEMORY.md on GitHub after a write", async () => {
  const { fakeGitHub } = await import("./helpers.js");
  const { GitHubBackend } = await import("../src/backends/github.js");
  const gh = fakeGitHub();
  const be = new GitHubBackend({ repo: "o/r", token: "x", fetch: gh.fetch });
  const brain = new Brain(be, { source: "chatgpt", afterWrite: () => refreshMemoryExport(be) });
  await brain.add({ kind: "decision", title: "Remote decision" });
  assert.match(gh.files.get(".brain/MEMORY.md")!.content, /Remote decision/);
  await brain.add({ kind: "task", title: "Second" });
  assert.match(gh.files.get(".brain/MEMORY.md")!.content, /Second/);
});

test("normalizeHook maps every tool's events and detects Cursor/Copilot running Claude hooks", () => {
  const env = {} as NodeJS.ProcessEnv;
  const c = normalizeHook("claude", "SessionStart", { session_id: "s", cwd: "/r", source: "startup" }, env);
  assert.deepEqual([c.tool, c.phase, c.sessionId, c.cwd], ["claude-code", "start", "s", "/r"]);
  assert.equal(normalizeHook("claude", "SessionStart", { session_id: "s", cursor_version: "2.4" }, env).tool, "cursor");
  assert.equal(normalizeHook("claude", "Stop", {}, { COPILOT_CLI: "1" } as any).tool, "copilot");
  assert.equal(normalizeHook("gemini", "AfterAgent", { prompt_response: "ok" }, env).phase, "turn");
  assert.equal(normalizeHook("gemini", "BeforeAgent", { prompt: "hi" }, env).prompt, "hi");
  const cu = normalizeHook("cursor", "sessionStart", { conversation_id: "c1", workspace_roots: ["/w"] }, env);
  assert.deepEqual([cu.tool, cu.sessionId, cu.cwd], ["cursor", "c1", "/w"]);
  assert.equal(normalizeHook("copilot", "agentStop", { sessionId: "x", transcriptPath: "/t" }, env).transcriptPath, "/t");
  const w = normalizeHook("windsurf", "pre_user_prompt", { trajectory_id: "tr", tool_info: { user_prompt: "do it" } }, env);
  assert.deepEqual([w.phase, w.sessionId, w.prompt], ["prompt", "tr", "do it"]);
  assert.equal(normalizeHook("codex", "PreToolUse", {}, env).phase, "ignore");

  assert.deepEqual(JSON.parse(hookOutput(c, "CTX")), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "CTX" } });
  assert.deepEqual(JSON.parse(hookOutput(cu, "CTX")), { additional_context: "CTX" });
  assert.deepEqual(JSON.parse(hookOutput(normalizeHook("copilot", "sessionStart", {}, env), "CTX")), { additionalContext: "CTX" });
  assert.equal(hookOutput(w, "CTX"), "");
});

test("transcript parsers read real Claude Code, Codex, Gemini CLI and Copilot logs", () => {
  const cc = parseTranscript("claude-code", fx("claude.jsonl"));
  assert.equal(cc.turns[0].text, "create a.py please");
  assert.ok(cc.files.length >= 1);
  const cx = parseTranscript("codex", fx("codex.jsonl"));
  assert.equal(cx.cwd, "/tmp/probe");
  assert.deepEqual(cx.turns.map((t) => t.role), ["user", "assistant"]);
  assert.equal(cx.commands, 1);
  const gm = parseTranscript("gemini-cli", fx("gemini.jsonl"));
  assert.equal(gm.turns[0].text, "create c.py");
  assert.ok(gm.files.some((f) => f.endsWith("c.py")));
  const cp = parseTranscript("copilot", fx("copilot.jsonl"));
  assert.equal(cp.cwd, "/tmp/probe");
  assert.equal(cp.turns[0].text, "say hi");
  const ai = parseAiderHistory("\n# aider chat started at 2026-10-09 10:00:00\n\n#### add a health endpoint\n\nAdded `/health`.\n\n#### and tests\n\nDone.\n");
  assert.equal(ai.length, 1);
  assert.deepEqual(ai[0].turns.filter((t) => t.role === "user").map((t) => t.text), ["add a health endpoint", "and tests"]);
});

test("init --all wires every tool with configs that parse, and is idempotent", async () => {
  const dir = tmp();
  try {
    gitInit(dir);
    mkdirSync(path.join(dir, ".codex"));
    writeFileSync(path.join(dir, ".codex", "config.toml"), 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\nargs = ["a", "b"]\n');
    const r = await init(dir, { tools: "all", project: "all" });
    assert.deepEqual(r.tools, ["claude", "codex", "gemini", "cursor", "copilot", "windsurf", "aider", "zed", "roo", "junie"]);
    for (const f of [".zed/settings.json", ".roo/mcp.json", ".junie/mcp/mcp.json", ".mcp.json", ".claude/settings.json", ".codex/hooks.json", ".gemini/settings.json", ".cursor/hooks.json", ".cursor/mcp.json", ".github/hooks/hamyad.json", ".vscode/mcp.json", ".windsurf/hooks.json", ".devin/hooks.json"]) {
      const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      assert.ok(JSON.stringify(j).includes("hamyad"), f);
    }
    const toml = readFileSync(path.join(dir, ".codex", "config.toml"), "utf8");
    assert.match(toml, /\[mcp_servers\.hamyad\]\ncommand = "hamyad"/);
    assert.match(toml, /\[mcp_servers\.other\]\ncommand = "x"\nargs = \["a", "b"\]/);
    assert.match(toml, /^model = "o3"/);
    const gem = JSON.parse(readFileSync(path.join(dir, ".gemini", "settings.json"), "utf8"));
    assert.ok(gem.hooks.SessionStart[0].hooks[0].command.includes("hamyad hook gemini SessionStart"));
    assert.ok([].concat(gem.context.fileName).includes("AGENTS.md" as never));
    const cur = JSON.parse(readFileSync(path.join(dir, ".cursor", "hooks.json"), "utf8"));
    assert.equal(cur.version, 1);
    assert.ok(cur.hooks.sessionStart[0].command.includes("hamyad hook cursor sessionStart"));
    const cop = JSON.parse(readFileSync(path.join(dir, ".github", "hooks", "hamyad.json"), "utf8"));
    assert.ok(cop.hooks.sessionStart[0].bash.includes("hamyad hook copilot sessionStart"));
    assert.match(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), /hamyad:begin/);
    assert.match(readFileSync(path.join(dir, ".aider.conf.yml"), "utf8"), /AGENTS\.md/);
    assert.match(readFileSync(path.join(dir, ".git", "hooks", "post-commit"), "utf8"), /hamyad hook git post-commit/);
    const again = await init(dir, { tools: "all", project: "all" });
    assert.deepEqual(again.created, []);
    assert.equal(readFileSync(path.join(dir, ".codex", "config.toml"), "utf8"), toml);
  } finally {
    rm(dir);
  }
});

test("hooks: a Codex session is captured with its code changes, and Gemini is told what changed", async () => {
  const dir = tmp();
  try {
    gitInit(dir);
    writeFileSync(path.join(dir, "app.py"), "print('v1')\n");
    await init(dir, { tools: ["claude", "codex", "gemini"], project: "h" });
    sh(dir, "git", ["add", "-A"]);
    sh(dir, "git", ["commit", "-qm", "init"]);

    // Gemini session 1 (sets its "last seen")
    const g1 = JSON.parse(await runHook("gemini", "SessionStart", { session_id: "g1", cwd: dir }));
    assert.match(g1.hookSpecificOutput.additionalContext, /Shared project brain/);
    await runHook("gemini", "SessionEnd", { session_id: "g1", cwd: dir });
    // an earlier Codex session (first sessions get the full brief, later ones the diff)
    await runHook("codex", "SessionStart", { session_id: "cx0", cwd: dir });
    await runHook("codex", "SessionEnd", { session_id: "cx0", cwd: dir });
    await sleep(20);

    // a decision made in chat, replacing an older one
    const p = openProject(dir, "claude-chat");
    const old = await p.brain.add({ kind: "decision", title: "Use Flask", source: "claude-chat" });
    await sleep(5);
    await p.brain.add({ kind: "decision", title: "Use FastAPI instead of Flask", source: "claude-chat", supersedes: [old.id] });

    // Codex session that edits code
    const s = JSON.parse(await runHook("codex", "SessionStart", { session_id: "cx1", cwd: dir, source: "startup" }));
    assert.match(s.hookSpecificOutput.additionalContext, /DECISIONS CHANGED[\s\S]*REPLACED: "Use Flask"/);
    await runHook("codex", "UserPromptSubmit", { session_id: "cx1", cwd: dir, prompt: "switch to fastapi, key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" });
    writeFileSync(path.join(dir, "app.py"), "from fastapi import FastAPI\napp = FastAPI()\n");
    writeFileSync(path.join(dir, "new.py"), "x = 1\n");
    await runHook("codex", "Stop", { session_id: "cx1", cwd: dir, last_assistant_message: "Switched to FastAPI." });
    await runHook("codex", "SessionEnd", { session_id: "cx1", cwd: dir });

    const { entries } = await openProject(dir).brain.snapshot();
    const sess = entries.find((e) => e.kind === "session" && e.source === "codex")!;
    assert.ok(sess, "codex session captured");
    assert.equal(sess.session, "codex:cx1");
    assert.match(sess.body, /switch to fastapi/);
    assert.ok(!sess.body.includes("abcdefghijklmnopqrstuvwxyz0123"), "prompt secrets redacted");
    const ch = entries.find((e) => e.kind === "change" && e.source === "codex")!;
    assert.ok(ch, "change set captured");
    assert.match(ch.body, /app\.py/);
    assert.match(ch.body, /new\.py/);
    assert.match(ch.body, /FastAPI/);
    assert.ok(!/\.brain\//.test(ch.body.split("```")[0]), "generated files excluded");
    // only one session/change entry per session even with several Stop events
    await runHook("codex", "Stop", { session_id: "cx1", cwd: dir });
    const again = (await openProject(dir).brain.snapshot()).entries;
    assert.equal(again.filter((e) => e.session === "codex:cx1" && e.kind === "session").length, 1);
    // the brain was committed by the end hook
    assert.match(sh(dir, "git", ["log", "--format=%s", "-n", "3"]), /brain: session summary \[codex\]/);

    // Gemini session 2 sees the decision change and Codex's session
    const g2 = JSON.parse(await runHook("gemini", "SessionStart", { session_id: "g2", cwd: dir }));
    const ctx = g2.hookSpecificOutput.additionalContext;
    assert.match(ctx, /DECISIONS CHANGED since your last Gemini CLI session/);
    assert.match(ctx, /Use FastAPI instead of Flask/);
    assert.match(ctx, /\[Codex\]/);

    // timeline merges brain + git
    const tl = await projectTimeline(openProject(dir));
    assert.ok(tl.some((i) => i.type === "change" && i.tool === "codex"));
    assert.ok(tl.some((i) => i.type === "commit" && i.title === "init"));
    const out = cli(dir, ["timeline", "-n", "50"]).out;
    assert.match(out, /Codex/);
    assert.match(out, /Use Flask → Use FastAPI/);

    // a broken payload never fails the agent
    assert.equal(await runHook("codex", "Stop", "garbage" as any), "{}");
  } finally {
    rm(dir);
  }
});

test("importers pick up Codex and Claude Code logs for this project only", async () => {
  const dir = tmp();
  const home = tmp("hamyad-home-");
  const keep = { CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  try {
    await init(dir, { tools: ["claude"], project: "imp" });
    process.env.CODEX_HOME = path.join(home, "codex");
    process.env.CLAUDE_CONFIG_DIR = path.join(home, "claude");
    const day = path.join(home, "codex", "sessions", "2026", "10", "09");
    mkdirSync(day, { recursive: true });
    writeFileSync(path.join(day, "rollout-2026-10-09T10-00-00-01a12157-9d01-7982-b1f7-0933463e3879.jsonl"), fx("codex.jsonl").split("/tmp/probe").join(JSON.stringify(dir).slice(1, -1)));
    writeFileSync(path.join(day, "rollout-other.jsonl"), fx("codex.jsonl")); // cwd /tmp/probe: another project
    const cdir = path.join(home, "claude", "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(cdir, { recursive: true });
    writeFileSync(path.join(cdir, "859b5aec.jsonl"), fx("claude.jsonl").split("/tmp/probe").join(JSON.stringify(dir).slice(1, -1)));
    const p = openProject(dir);
    const r = await importTool(p, "codex");
    assert.equal(r.files, 1);
    assert.equal(r.imported.length, 1);
    assert.match(r.imported[0].title, /^Codex: create b\.py/);
    assert.equal((await importTool(p, "codex")).unchanged, 1, "re-import is a no-op");
    const rc = await importTool(p, "claude-code");
    assert.equal(rc.imported.length, 1);
    const out = cli(dir, ["import", "codex", "--dry-run"], undefined);
    assert.equal(out.code, 0);
    // capture off disables import
    const cfgF = path.join(dir, ".brain", "config.json");
    const cfg = JSON.parse(readFileSync(cfgF, "utf8"));
    cfg.capture.sessions = "off";
    writeFileSync(cfgF, JSON.stringify(cfg));
    assert.equal((await importTool(openProject(dir), "codex")).files, 0);
  } finally {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rm(dir);
    rm(home);
  }
});

test("capture full writes a redacted transcript under .brain/transcripts", async () => {
  const dir = tmp();
  try {
    gitInit(dir);
    await init(dir, { tools: ["claude"], project: "full", capture: "full" });
    const tp = path.join(dir, "t.jsonl");
    writeFileSync(tp, fx("claude.jsonl").replace("create a.py please", "create a.py please, password=SuperSecret123"));
    await runHook("claude", "SessionStart", { session_id: "859b5aec-791a-4433-b806-562d03983f85", cwd: dir });
    await runHook("claude", "SessionEnd", { session_id: "859b5aec-791a-4433-b806-562d03983f85", cwd: dir, transcript_path: tp });
    const tdir = path.join(dir, ".brain", "transcripts", "claude-code");
    const files = existsSync(tdir) ? (await import("node:fs")).readdirSync(tdir) : [];
    assert.equal(files.length, 1);
    const t = readFileSync(path.join(tdir, files[0]), "utf8");
    assert.match(t, /create a\.py please/);
    assert.ok(!t.includes("SuperSecret123"));
    // transcripts are not entries
    assert.ok(!(await openProject(dir).brain.list()).some((e) => e.path.startsWith("transcripts/")));
  } finally {
    rm(dir);
  }
});

test("commitTool attributes commits to agents", () => {
  assert.equal(commitTool("Paul (aider)", ""), "aider");
  assert.equal(commitTool("me", "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>"), "claude-code");
  assert.equal(commitTool("me", "x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>"), "cursor");
  assert.equal(commitTool("me", "plain"), "human");
});

test("CLI: supersede, add --supersedes, context --since, status matrix, git post-commit trigger", () => {
  const dir = tmp();
  try {
    gitInit(dir);
    assert.equal(cli(dir, ["init", "--all", "--project", "cli2"]).code, 0);
    const a = cli(dir, ["add", "decision", "Host on Vercel", "-t", "hosting"]);
    const id = /(d-\d{8}-\w{4})/.exec(a.out)![1];
    const b = cli(dir, ["add", "decision", "Host on Netlify", "-t", "hosting"]);
    assert.match(b.out, /possibly conflicting[\s\S]*Host on Vercel/);
    const bid = /(d-\d{8}-\w{4})/.exec(b.out)![1];
    assert.match(cli(dir, ["supersede", id, bid]).out, /superseded by/);
    const c = cli(dir, ["add", "decision", "Host on Cloudflare Pages", "--supersedes", bid]);
    assert.match(c.out, /is now superseded/);
    assert.match(cli(dir, ["context", "--since", "2000-01-01"]).out, /DECISIONS CHANGED/);
    assert.match(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), /Cloudflare Pages/);
    const st = cli(dir, ["status"]).out;
    for (const t of ["Claude Code", "Codex", "Gemini CLI", "Cursor", "Copilot", "Windsurf", "aider", "ChatGPT"]) assert.match(st, new RegExp(t));
    assert.match(st, /git post-commit trigger/);
    writeFileSync(path.join(dir, ".aider.chat.history.md"), "\n# aider chat started at 2026-10-09 10:00:00\n\n#### add healthcheck\n\nok\n");
    sh(dir, "git", ["add", "-A"]);
    const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };
    // run the installed post-commit hook the way git does (hamyad may not be on PATH in CI)
    const hook = readFileSync(path.join(dir, ".git", "hooks", "post-commit"), "utf8");
    assert.match(hook, /hamyad hook git post-commit/);
    assert.equal(cli(dir, ["hook", "git", "post-commit"]).code, 0);
    assert.match(cli(dir, ["list", "session"]).out, /aider: add healthcheck/);
    void env;
  } finally {
    rm(dir);
  }
});

test("REST + OpenAPI: GPT Actions and non-MCP tools use the same brain", async () => {
  const { createHttpHandler } = await import("../src/mcp/http.js");
  const be = new MemoryBackend();
  const h = createHttpHandler((ctx) => new McpServer(new Brain(be, { source: ctx.source || "api" }), { source: ctx.source, fallbackSource: "api" }), { token: "sekret" });
  const req = (path: string, init: RequestInit = {}, auth = true) =>
    h(new Request(`https://brain.example${path}`, { ...init, headers: { ...(auth ? { authorization: "Bearer sekret" } : {}), "content-type": "application/json", ...(init.headers as any) } }));
  const spec = await (await req("/openapi.json", {}, false)).json();
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.servers[0].url, "https://brain.example");
  for (const op of ["getContext", "searchBrain", "remember", "updateEntry", "logSession", "timeline", "memoryMarkdown"])
    assert.ok(JSON.stringify(spec.paths).includes(`"operationId":"${op}"`), op);
  assert.equal((await req("/api/context", {}, false)).status, 401);
  const a = await (await req("/api/entries?source=chatgpt", { method: "POST", body: JSON.stringify({ kind: "decision", title: "Use Redis for sessions", tags: ["cache"] }) })).json();
  assert.equal(a.ok, true);
  const id = /`(d-[^`]+)`/.exec(a.message)![1];
  const b = await (await req("/api/entries", { method: "POST", headers: { "user-agent": "Mozilla/5.0 ChatGPT-User/1.0; +https://openai.com/bot" }, body: JSON.stringify({ kind: "decision", title: "Use Valkey for sessions", supersedes: [id] }) })).json();
  assert.match(b.message, /Marked superseded/);
  const old = await (await req(`/api/entries/${id}`)).json();
  assert.equal(old.status, "superseded");
  assert.equal(old.source, "chatgpt");
  const ctx = await (await req("/api/context?since=2000-01-01T00:00:00Z")).json();
  assert.match(ctx.brief, /Use Valkey/);
  assert.match(ctx.changes, /DECISIONS CHANGED/);
  assert.equal((await (await req("/api/search?q=valkey")).json()).results[0].title, "Use Valkey for sessions");
  assert.match(await (await req("/api/memory.md?key=sekret", {}, false)).text(), /hamyad:entries/);
  assert.ok((await (await req("/api/timeline")).json()).items.some((i: any) => i.type === "superseded"));
  assert.match((await (await req("/api/sessions", { method: "POST", body: JSON.stringify({ summary: "Talked caching." }) })).json()).message, /Saved session|Logged|session/i);
  // ChatGPT gets OpenAI's search/fetch tools on the MCP endpoint, others do not
  const rpc = async (ua: string, body: any) => (await (await req("/mcp", { method: "POST", headers: { "user-agent": ua, accept: "application/json" }, body: JSON.stringify(body) })).json());
  const gptTools = (await rpc("openai-mcp/1.0", { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools.map((t: any) => t.name);
  assert.ok(gptTools.includes("search") && gptTools.includes("fetch"));
  const claudeTools = (await rpc("Claude-User", { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools.map((t: any) => t.name);
  assert.ok(!claudeTools.includes("search"));
  const found = JSON.parse((await rpc("openai-mcp/1.0", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "valkey" } } })).result.content[0].text);
  assert.ok(found.results.length >= 1);
  const doc = JSON.parse((await rpc("openai-mcp/1.0", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fetch", arguments: { id: found.results[0].id } } })).result.content[0].text);
  assert.match(doc.text, /Valkey/);
});

test("connect: a guide for every AI tool, chat apps included", async () => {
  const { GUIDES, findGuide, renderMatrix } = await import("../src/node/connect.js");
  for (const id of ["chatgpt", "claude-ai", "claude-desktop", "claude-code", "codex", "cursor", "windsurf", "copilot", "gemini-cli", "gemini-app", "grok", "perplexity", "zed", "cline", "jetbrains", "aider", "any"])
    assert.ok(GUIDES.some((g) => g.id === id), id);
  assert.equal(findGuide("vscode")!.id, "copilot");
  assert.equal(findGuide("Roo Code")!.id, "cline");
  assert.match(renderMatrix(), /\| ChatGPT/);
  const dir = tmp();
  try {
    await init(dir, { tools: ["claude"], project: "c" });
    const gpt = cli(dir, ["connect", "chatgpt", "--url", "https://b.example"]).out;
    assert.match(gpt, /https:\/\/b\.example\/openapi\.json/);
    assert.match(gpt, /https:\/\/b\.example\/mcp\/<HAMYAD_TOKEN>\?source=chatgpt/);
    assert.match(cli(dir, ["connect", "grok"]).out, /grok\.com/);
    assert.match(cli(dir, ["connect", "instructions"]).out, /brain_context/);
    assert.equal(cli(dir, ["connect", "nope"]).code, 2);
  } finally {
    rm(dir);
  }
});
