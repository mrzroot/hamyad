import { promises as fs } from "node:fs";
import path from "node:path";
import type { Backend, RawFile } from "../core/backend.js";

/** Reads and writes `<repo>/.brain/` on the local disk. */
export class FsBackend implements Backend {
  readonly label: string;
  constructor(
    readonly dir: string,
    readonly onWrite?: (absPath: string, message: string) => Promise<void> | void,
  ) {
    this.label = `fs:${dir}`;
  }

  async readAll(): Promise<RawFile[]> {
    const out: RawFile[] = [];
    const walk = async (rel: string) => {
      let items: import("node:fs").Dirent[];
      try {
        items = await fs.readdir(path.join(this.dir, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        if (it.name.startsWith(".")) continue;
        // full transcripts can be large and are not entries
        if (!rel && it.name === "transcripts") continue;
        const r = rel ? `${rel}/${it.name}` : it.name;
        if (it.isDirectory()) await walk(r);
        else if (/\.(md|json)$/.test(it.name)) out.push({ path: r, content: await fs.readFile(path.join(this.dir, r), "utf8") });
      }
    };
    await walk("");
    return out;
  }

  async write(rel: string, content: string, message: string) {
    if (rel.includes("..")) throw new Error("invalid path");
    const abs = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = abs + ".tmp-" + process.pid;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, abs);
    if (this.onWrite) await this.onWrite(abs, message);
    return {};
  }
}
