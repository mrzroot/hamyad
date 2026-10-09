import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeText } from "../core/entry.js";
import type { Project } from "./project.js";

/** Where Claude Code keeps auto memory for a repo: ~/.claude/projects/<encoded-root>/memory */
export function autoMemoryDir(root: string, home = os.homedir()): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  return path.join(base, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
}

/**
 * Copy Claude Code's machine-local auto memory topics into the shared brain as
 * notes (tag `auto-memory`), so Claude chat and other machines can see them.
 */
export async function absorbAutoMemory(p: Project, from?: string): Promise<{ dir: string; added: string[]; skipped: number }> {
  const dir = from || autoMemoryDir(p.root);
  if (!existsSync(dir)) return { dir, added: [], skipped: 0 };
  const { entries } = await p.brain.snapshot();
  const known = new Set(entries.filter((e) => e.tags.includes("auto-memory")).map((e) => normalizeText(e.title)));
  const added: string[] = [];
  let skipped = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "MEMORY.md").sort()) {
    const raw = readFileSync(path.join(dir, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    const meta = fm ? fm[1] : "";
    const body = (fm ? fm[2] : raw).trim();
    const name = /^name:\s*(.+)$/m.exec(meta)?.[1]?.trim() || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || f.replace(/\.md$/, "").replace(/[_-]+/g, " ");
    const type = /^type:\s*(.+)$/m.exec(meta)?.[1]?.trim();
    const title = `Claude Code memory: ${name}`;
    if (known.has(normalizeText(title)) || !body) {
      skipped++;
      continue;
    }
    await p.brain.add({ kind: "note", title, body, tags: ["auto-memory", ...(type ? [type] : [])], source: "claude-code" });
    added.push(title);
  }
  return { dir, added, skipped };
}
