import { test } from "node:test";
import assert from "node:assert/strict";
import { Entry, newId, normalizeText, parseEntry, serializeEntry, slugify, entryPath } from "../src/core/entry.js";

const base: Entry = {
  id: "d-20261009-abcd",
  kind: "decision",
  title: 'Use "SQLite": not Postgres, #fast',
  body: "Because: it's a CLI.\n\n- a\n- b",
  status: "active",
  tags: ["db", "with,comma", "پایگاه‌داده"],
  source: "claude-chat",
  created: "2026-10-09T10:00:00.000Z",
  updated: "2026-10-09T11:00:00.000Z",
  path: "decisions/d-20261009-abcd-use-sqlite.md",
};

test("serialize/parse round-trip keeps every field", () => {
  const txt = serializeEntry(base);
  const back = parseEntry(base.path, txt)!;
  assert.deepEqual({ ...back, sha: undefined }, { ...base, sha: undefined });
});

test("Persian title and body survive round-trip", () => {
  const e = { ...base, title: "ثبت‌نام با پیامک: کاوه‌نگار", body: "دلیل: «ارزان‌تر»" };
  const back = parseEntry(e.path, serializeEntry(e))!;
  assert.equal(back.title, e.title);
  assert.equal(back.body, e.body);
});

test("hand-written file without frontmatter is accepted", () => {
  const e = parseEntry("notes/my-idea.md", "# Cache invalidation idea\n\nUse etags.")!;
  assert.equal(e.kind, "note");
  assert.equal(e.title, "Cache invalidation idea");
  assert.equal(e.id, "my-idea");
  assert.equal(e.source, "file");
});

test("files outside known folders are ignored", () => {
  assert.equal(parseEntry("random/x.md", "# hi"), undefined);
});

test("task without status defaults to open", () => {
  const e = parseEntry("tasks/t-1.md", "---\nid: t-1\ntitle: x\n---\n")!;
  assert.equal(e.status, "open");
});

test("normalizeText unifies Arabic/Persian letters, digits and ZWNJ", () => {
  assert.equal(normalizeText("كيك ۱۲۳ می‌خواهم"), normalizeText("کیک 123 میخواهم"));
});

test("slugify keeps Persian letters and is filesystem safe", () => {
  assert.equal(slugify("Hello, World!  2026"), "hello-world-2026");
  assert.match(slugify("ثبت‌نام / کاربر"), /^[\p{L}\p{N}-]+$/u);
  assert.equal(slugify("!!!"), "entry");
});

test("ids are kind-prefixed and dated", () => {
  const id = newId("task", new Date("2026-10-09T00:00:00Z"));
  assert.match(id, /^t-20261009-[a-z0-9]{4}$/);
  assert.match(entryPath("task", id, "Write tests"), /^tasks\/t-20261009-[a-z0-9]{4}-write-tests\.md$/);
});
