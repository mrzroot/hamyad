import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, gitInit, rm, sh, tmp } from "./helpers.js";
import { init, mergeHooks } from "../src/node/init.js";
import { sessionBody } from "../src/node/hooks.js";
import { parseClaude } from "../src/node/transcripts.js";
import { parseArgs } from "../src/cli.js";
import { autoMemoryDir } from "../src/node/absorb.js";

test("init is idempotent and preserves existing config files", async () => {
  const dir = tmp();
  try {
    mkdirSync(path.join(dir, ".claude"));
    const userHook = { type: "command", command: "echo mine" };
    writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { SessionStart: [{ hooks: [userHook] }] } }));
    writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Rules\n\nUse tabs.\n");
    const r1 = await init(dir, { project: "p1" });
    assert.ok(r1.created.length >= 8);
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
    assert.deepEqual(settings.hooks.SessionStart[0].hooks[0], userHook);
    assert.equal(settings.hooks.SessionStart[1].hooks[0].command, "hamyad hook claude SessionStart");
    assert.equal(settings.hooks.SessionEnd[0].hooks[0].command, "hamyad hook claude SessionEnd");
    const mcp = JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf8"));
    assert.ok(mcp.mcpServers.other && mcp.mcpServers.hamyad);
    const md = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    assert.ok(md.startsWith("# Rules\n\nUse tabs.\n"));
    assert.match(md, /hamyad:begin/);
    assert.ok(existsSync(path.join(dir, ".brain", "BRAIN.md")));

    const r2 = await init(dir, { project: "p1" });
    assert.deepEqual(r2.created, []);
    assert.equal(readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), md);
  } finally {
    rm(dir);
  }
});

test("mergeHooks updates our hook command in place instead of duplicating", () => {
  const a = mergeHooks({}, "hamyad");
  const b = mergeHooks(a, "npx -y hamyad");
  assert.equal(b.hooks.SessionStart.length, 1);
  assert.equal(b.hooks.SessionStart[0].hooks[0].command, "npx -y hamyad hook claude SessionStart");
});

const transcript = [
  { type: "user", timestamp: "2026-10-09T10:00:00Z", message: { role: "user", content: "Add SMS login with Kavenegar" } },
  { type: "user", isMeta: true, message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { type: "assistant", timestamp: "2026-10-09T10:01:00Z", message: { content: [{ type: "text", text: "Planning" }, { type: "tool_use", name: "Write", input: { file_path: "/repo/app/sms.py" } }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/repo/app/routes.py" } }, { type: "tool_use", name: "Bash", input: { command: "pytest" } }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/repo/.brain/notes/x.md" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
  { type: "user", message: { role: "user", content: [{ type: "text", text: "<system-reminder>ignore</system-reminder>" }] } },
  { type: "user", timestamp: "2026-10-09T10:05:00Z", message: { role: "user", content: [{ type: "text", text: "now add rate limiting" }] } },
  { type: "assistant", timestamp: "2026-10-09T10:09:00Z", message: { content: [{ type: "text", text: "Done: SMS login works, rate limited to 3/min." }] } },
  "not json",
].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");

test("parseClaude + sessionBody extract prompts, files, commands and outcome", () => {
  const t = parseClaude(transcript);
  assert.deepEqual(t.turns.filter((x) => x.role === "user").map((x) => x.text), ["Add SMS login with Kavenegar", "now add rate limiting"]);
  assert.ok(t.files.includes("/repo/app/sms.py") && t.files.includes("/repo/app/routes.py"));
  assert.equal(t.commands, 1);
  assert.equal(t.started, "2026-10-09T10:00:00Z");
  const body = sessionBody({ ...t, tool: "claude-code", sessionId: "s1" }, { maxPromptChars: 300 });
  assert.match(body, /### Asked\n- Add SMS login/);
  assert.match(body, /### Files touched/);
  assert.match(body, /rate limited/);
  assert.match(body, /1 shell command/);
});

test("parseArgs handles short flags, =values, --no- and positionals", () => {
  const { pos, flags } = parseArgs(["add", "task", "Ship", "it", "-m", "body text", "--tags=a,b", "--no-push", "--json"]);
  assert.deepEqual(pos, ["add", "task", "Ship", "it"]);
  assert.equal(flags.body, "body text");
  assert.equal(flags.tags, "a,b");
  assert.equal(flags.push, false);
  assert.equal(flags.json, true);
});

test("CLI: add / list / search / done / show / context / absorb", () => {
  const dir = tmp();
  try {
    assert.equal(cli(dir, ["init", "--project", "cli-demo", "--no-hooks"]).code, 0);
    const add = cli(dir, ["add", "task", "Write", "README", "-t", "docs"]);
    assert.equal(add.code, 0, add.err);
    const id = /(t-\d{8}-\w{4})/.exec(add.out)![1];
    assert.equal(cli(dir, ["add", "bogus", "x"]).code, 2);
    assert.match(cli(dir, ["list", "task"]).out, /\[open\] Write README/);
    assert.match(cli(dir, ["search", "readme"]).out, new RegExp(id));
    assert.match(cli(dir, ["done", id, "-m", "shipped"]).out, /\[done\]/);
    assert.match(cli(dir, ["show", id]).out, /shipped/);
    assert.equal(cli(dir, ["show", "missing"]).code, 1);
    assert.match(cli(dir, ["context"]).out, /Recently done\n- \[x\] Write README/);
    assert.equal(JSON.parse(cli(dir, ["list", "--json"]).out).length, 1);
    assert.match(readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /Write README/);

    const mem = path.join(dir, "fake-auto-memory");
    mkdirSync(mem);
    writeFileSync(path.join(mem, "MEMORY.md"), "- [x](feedback_tests.md)\n");
    writeFileSync(path.join(mem, "feedback_tests.md"), "---\nname: tests need redis\ntype: project\n---\nAPI tests require a local Redis on 6379.\n");
    assert.match(cli(dir, ["absorb", "--from", mem]).out, /\+ Claude Code memory: tests need redis/);
    assert.match(cli(dir, ["absorb", "--from", mem]).out, /1 already absorbed/);
    assert.match(cli(dir, ["search", "redis"]).out, /tests need redis/);
    assert.match(cli(dir, ["status"]).out, /1 tasks \(0 open\) · 1 notes/);
    assert.match(cli(dir, ["connect"]).out, /Add custom connector/);
  } finally {
    rm(dir);
  }
});

test("autoMemoryDir mirrors Claude Code's per-repo folder naming", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.equal(autoMemoryDir("/home/me/my.repo", "/home/me"), path.join("/home/me", ".claude", "projects", "-home-me-my-repo", "memory"));
  if (prev) process.env.CLAUDE_CONFIG_DIR = prev;
});

test("hook commands never fail the session", () => {
  const dir = tmp();
  try {
    const r = cli(dir, ["hook", "session-end"], "{not json");
    assert.equal(r.code, 0);
    assert.equal(cli(dir, ["hook", "wat"], "{}").code, 0);
  } finally {
    rm(dir);
  }
});

export { gitInit, sh };
