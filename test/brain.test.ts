import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/core/brain.js";
import { MemoryBackend } from "../src/core/backend.js";
import { mergeConfig } from "../src/core/config.js";
import { renderBrief, renderClaudeBlock, upsertBlock, BLOCK_END } from "../src/core/render.js";

function clock(start = Date.parse("2026-10-09T08:00:00Z")) {
  let t = start;
  return () => new Date((t += 60_000));
}

test("add, list, get, update, search", async () => {
  const be = new MemoryBackend();
  const b = new Brain(be, { source: "test", now: clock() });
  const d = await b.add({ kind: "decision", title: "Use pnpm workspaces", body: "npm was slow", tags: ["tooling"] });
  const t = await b.add({ kind: "task", title: "Migrate CI to pnpm" });
  await b.add({ kind: "note", title: "پیامک با کاوه‌نگار", body: "API key در تنظیمات" });
  assert.equal(be.writes.length, 3);
  assert.match(be.writes[0].message, /^brain: add decision "Use pnpm workspaces" \[test\]$/);

  const all = await b.list();
  assert.equal(all.length, 3);
  assert.equal(all[0].kind, "note", "newest first");
  assert.equal((await b.list({ kind: "task" }))[0].status, "open");

  assert.equal((await b.get(d.id))?.title, "Use pnpm workspaces");
  assert.equal((await b.get(d.id.slice(-4)))?.id, d.id, "unique suffix lookup");

  const u = await b.update(t.id, { status: "done", append: "merged in #12" });
  assert.equal(u.status, "done");
  assert.match(u.body, /merged in #12/);
  assert.equal((await b.list({ kind: "task", status: "done" })).length, 1);

  const hits = await b.search("pnpm");
  assert.equal(hits[0].id, d.id, "title + tag + body match ranks first");
  const fa = await b.search("پيامك"); // Arabic yeh/kaf
  assert.equal(fa.length, 1);
  assert.equal((await b.search("nothing-here")).length, 0);
});

test("add validates kind and title", async () => {
  const b = new Brain(new MemoryBackend());
  await assert.rejects(b.add({ kind: "bogus" as any, title: "x" }), /unknown kind/);
  await assert.rejects(b.add({ kind: "note", title: "  " }), /title is required/);
  await assert.rejects(b.update("nope", { status: "done" }), /no entry matches/);
});

test("config.json is read from the brain dir", async () => {
  const b = new Brain(new MemoryBackend({ "config.json": JSON.stringify({ project: "abc", git: { push: false } }) }));
  const s = await b.snapshot();
  assert.equal(s.config.project, "abc");
  assert.equal(s.config.git.push, false);
  assert.equal(s.config.git.pull, true);
});

test("brief groups entries and hides done/superseded from active lists", async () => {
  const b = new Brain(new MemoryBackend(), { now: clock() });
  await b.add({ kind: "context", title: "Stack", body: "Laravel + Vue" });
  const old = await b.add({ kind: "decision", title: "Use MySQL" });
  await b.update(old.id, { status: "superseded" });
  await b.add({ kind: "decision", title: "Use PostgreSQL" });
  const t = await b.add({ kind: "task", title: "Write migration" });
  await b.add({ kind: "task", title: "Ship v1" });
  await b.update(t.id, { status: "done" });
  const s = await b.snapshot();
  const brief = renderBrief(mergeConfig({ project: "demo" }), s.entries);
  assert.match(brief, /# Project brain: demo/);
  assert.match(brief, /## Context\n- \*\*Stack\*\* — Laravel \+ Vue/);
  assert.match(brief, /Use PostgreSQL/);
  assert.doesNotMatch(brief, /Use MySQL/);
  assert.match(brief, /## Open tasks\n- \[ \] Ship v1/);
  assert.match(brief, /## Recently done\n- \[x\] Write migration/);
});

test("brief respects maxChars", async () => {
  const b = new Brain(new MemoryBackend(), { now: clock() });
  for (let i = 0; i < 40; i++) await b.add({ kind: "note", title: `note number ${i} `.repeat(5), body: "x".repeat(200) });
  const s = await b.snapshot();
  const brief = renderBrief(mergeConfig({}), s.entries, { maxChars: 800 });
  assert.ok(brief.length <= 800, `length ${brief.length}`);
  assert.match(brief, /truncated/);
});

test("upsertBlock inserts once and replaces in place", () => {
  const cfg = mergeConfig({ project: "p" });
  const block1 = renderClaudeBlock(cfg, []);
  const original = "# My project\n\nRun `make test`.\n";
  const once = upsertBlock(original, block1);
  assert.ok(once.startsWith(original));
  assert.ok(once.includes(BLOCK_END));
  const twice = upsertBlock(once, block1);
  assert.equal(twice, once, "idempotent");
  const withTail = once + "\n## Footer\nkeep me\n";
  const replaced = upsertBlock(withTail, block1.replace("Shared project brain", "Shared brain v2"));
  assert.match(replaced, /Shared brain v2/);
  assert.match(replaced, /## Footer\nkeep me/);
  assert.equal(replaced.split("hamyad:begin").length, 2);
  assert.match(upsertBlock("", block1), /^# CLAUDE\.md\n\n<!-- hamyad:begin/);
});
