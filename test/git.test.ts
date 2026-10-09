// The GitHub-is-the-source-of-truth loop, using a local bare repo as "GitHub".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, gitInit, rm, sh, tmp } from "./helpers.js";

function clone(remote: string, into: string) {
  sh(path.dirname(into), "git", ["clone", "-q", remote, into]);
  sh(into, "git", ["config", "user.email", "t@example.com"]);
  sh(into, "git", ["config", "user.name", "Test"]);
  sh(into, "git", ["config", "commit.gpgsign", "false"]);
}

test("laptop <-> GitHub <-> chat-side commits: sync, hooks, safe push", () => {
  const root = tmp("hamyad-git-");
  try {
    const remote = path.join(root, "origin.git");
    sh(root, "git", ["init", "-q", "--bare", "-b", "main", remote]);
    const a = path.join(root, "laptop");
    clone(remote, a);
    writeFileSync(path.join(a, "CLAUDE.md"), "# Project rules\n\nAlways run tests.\n");
    sh(a, "git", ["add", "."]);
    sh(a, "git", ["commit", "-qm", "initial"]);
    sh(a, "git", ["push", "-q", "-u", "origin", "main"]);

    assert.equal(cli(a, ["init", "--project", "shop"]).code, 0);
    sh(a, "git", ["add", "."]);
    sh(a, "git", ["commit", "-qm", "add hamyad"]);
    sh(a, "git", ["push", "-q"]);

    // first Claude Code session on the laptop records the baseline
    const start1 = cli(a, ["hook", "session-start"], JSON.stringify({ session_id: "s1", cwd: a, source: "startup" }));
    assert.equal(start1.code, 0, start1.err);
    const out1 = JSON.parse(start1.out);
    assert.equal(out1.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(out1.hookSpecificOutput.additionalContext, /Shared project brain/);

    // "Claude chat" writes through GitHub (simulated by another clone + sync)
    const b = path.join(root, "chat");
    clone(remote, b);
    const add = cli(b, ["add", "decision", "Use Zarinpal for payments", "-m", "decided in claude.ai chat", "--source", "claude-chat"]);
    assert.equal(add.code, 0, add.err);
    const sync = cli(b, ["sync"]);
    assert.match(sync.out, /commit .*brain: sync \[cli\]/);
    assert.match(sync.out, /push .*1 brain commit/);

    // next laptop session pulls it in and announces it
    const start2 = JSON.parse(cli(a, ["hook", "session-start"], JSON.stringify({ session_id: "s2", cwd: a, source: "startup" })).out);
    const ctx = start2.hookSpecificOutput.additionalContext;
    assert.match(ctx, /DECISIONS CHANGED since your last Claude Code session/);
    assert.match(ctx, /Use Zarinpal for payments/);
    assert.match(ctx, /\(Claude\.ai chat\)/);
    assert.match(ctx, /fast-forwarded/);
    const md = readFileSync(path.join(a, "CLAUDE.md"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(md.startsWith("# Project rules\n\nAlways run tests.\n"), "user content kept");
    assert.match(md, /Use Zarinpal for payments/);

    // session end: transcript -> session entry -> commit -> push (CLAUDE.md block change included)
    const tr = path.join(root, "t.jsonl");
    writeFileSync(
      tr,
      [
        { type: "user", timestamp: new Date(Date.now() - 60000).toISOString(), message: { role: "user", content: "Implement Zarinpal checkout" } },
        { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: path.join(a, "pay.py") } }, { type: "text", text: "Checkout implemented." }] } },
      ].map((x) => JSON.stringify(x)).join("\n"),
    );
    const end = cli(a, ["hook", "session-end"], JSON.stringify({ session_id: "s2", cwd: a, transcript_path: tr, reason: "prompt_input_exit" }));
    assert.equal(end.code, 0);
    assert.match(end.err, /logged session s-\d{8}/);
    assert.match(end.err, /1 brain commit\(s\)/);
    assert.equal(sh(a, "git", ["status", "--porcelain"]), "", "laptop clean: brain + CLAUDE.md block committed");
    assert.equal(sh(a, "git", ["rev-list", "--count", "@{u}..HEAD"]), "0");

    // chat side sees the Claude Code session after pulling
    sh(b, "git", ["pull", "-q"]);
    assert.match(cli(b, ["list", "session"]).out, /Claude Code: Implement Zarinpal checkout/);

    // never push the user's own unpushed work
    writeFileSync(path.join(a, "wip.txt"), "secret wip\n");
    sh(a, "git", ["add", "wip.txt"]);
    sh(a, "git", ["commit", "-qm", "wip: local only"]);
    cli(a, ["add", "note", "A note"]);
    const s3 = cli(a, ["sync"]);
    assert.match(s3.out, /skip .*unpushed non-brain commits/);
    assert.equal(sh(a, "git", ["rev-list", "--count", "@{u}..HEAD"]), "2");
    assert.doesNotMatch(sh(remote, "git", ["log", "--format=%s", "main"]), /wip: local only/);
  } finally {
    rm(root);
  }
});

test("CLAUDE.md with the user's own uncommitted edits is never committed by hamyad", () => {
  const dir = tmp();
  try {
    gitInit(dir);
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Rules\n");
    sh(dir, "git", ["add", "."]);
    sh(dir, "git", ["commit", "-qm", "init"]);
    cli(dir, ["init"]);
    sh(dir, "git", ["add", "."]);
    sh(dir, "git", ["commit", "-qm", "hamyad"]);
    writeFileSync(path.join(dir, "CLAUDE.md"), readFileSync(path.join(dir, "CLAUDE.md"), "utf8").replace("# Rules", "# Rules\n\nMy unsaved idea"));
    cli(dir, ["add", "note", "n1"]);
    cli(dir, ["sync"]);
    assert.match(sh(dir, "git", ["status", "--porcelain"]), /M CLAUDE\.md/);
    assert.doesNotMatch(sh(dir, "git", ["status", "--porcelain"]), /\.brain/);
  } finally {
    rm(dir);
  }
});
