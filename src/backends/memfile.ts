import { existsSync, promises as fs, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Backend, RawFile } from "../core/backend.js";
import { mergeConfig } from "../core/config.js";
import { Entry, parseEntry } from "../core/entry.js";
import { parseMemoryMd, renderMemoryMd } from "../core/render.js";

/**
 * The whole brain in ONE Markdown file (MEMORY.md). Meant for a folder synced
 * by Dropbox / Google Drive / OneDrive / iCloud / a Claude cowork folder, when
 * there is no GitHub repo. Every write re-reads the file first (another
 * machine may have changed it), replaces one block, regenerates the brief on
 * top and swaps the file in atomically.
 */
export class MemoryFileBackend implements Backend {
  readonly label: string;
  constructor(readonly file: string) {
    this.label = `memory-file:${file}`;
  }

  private read(): RawFile[] {
    if (!existsSync(this.file)) return [];
    return parseMemoryMd(readFileSync(this.file, "utf8"));
  }

  async readAll(): Promise<RawFile[]> {
    return this.read();
  }

  async write(rel: string, content: string): Promise<{ sha?: string }> {
    if (rel.includes("..")) throw new Error("invalid path");
    const files = this.read().filter((f) => f.path !== rel);
    files.push({ path: rel, content });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await fs.writeFile(tmp, render(files), "utf8");
    await fs.rename(tmp, this.file);
    return {};
  }

  /** Conflict copies made by sync clients next to the file ("MEMORY (conflicted copy).md", "MEMORY (1).md"…). */
  conflictCopies(): string[] {
    const dir = path.dirname(this.file);
    const base = path.basename(this.file, ".md");
    try {
      return readdirSync(dir).filter((n) => n !== path.basename(this.file) && n.startsWith(base) && /conflict|\(\d+\)|copy/i.test(n) && n.endsWith(".md"));
    } catch {
      return [];
    }
  }
}


export function render(files: RawFile[]): string {
  let config = mergeConfig({});
  const entries: Entry[] = [];
  for (const f of files) {
    if (f.path === "config.json") {
      try {
        config = mergeConfig(JSON.parse(f.content));
      } catch {
        /* defaults */
      }
    } else if (f.path.endsWith(".md") && f.path.includes("/")) {
      const e = parseEntry(f.path, f.content);
      if (e) entries.push(e);
    }
  }
  entries.sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
  return renderMemoryMd(config, entries, files);
}
