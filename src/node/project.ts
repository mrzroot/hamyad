import { createHash } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Brain } from "../core/brain.js";
import type { Backend } from "../core/backend.js";
import { FsBackend } from "../backends/fs.js";
import { MemoryFileBackend } from "../backends/memfile.js";
import { renderBrief, renderInstructionBlock, renderMemoryMd, upsertBlock } from "../core/render.js";
import { git, gitRoot } from "./git.js";

export const BRAIN_DIR = ".brain";
/** Pointer file for projects whose brain lives outside the repo (Dropbox, Drive, a cowork folder, one MEMORY.md…) */
export const POINTER = ".hamyad.json";

export interface Project {
  root: string;
  /** brain folder (dir store) or the MEMORY.md file (file store) */
  brainDir: string;
  store: { kind: "dir" | "file"; path: string; external: boolean };
  brain: Brain;
  /** the project root is a git work tree (change journal, commits) */
  isGit: boolean;
  /** the brain lives inside that git repo (commit/push the brain) */
  brainInGit: boolean;
  /** machine-local state (never synced): <git dir>/hamyad or ~/.hamyad/state/<hash> */
  stateDir: string;
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Find the project root: nearest ancestor with `.brain/` or `.hamyad.json`, else the git root, else cwd. */
export function findRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, BRAIN_DIR)) || existsSync(path.join(dir, POINTER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitRoot(start) || path.resolve(start);
}

export function readPointer(root: string): { store?: string } {
  try {
    return JSON.parse(readFileSync(path.join(root, POINTER), "utf8"));
  } catch {
    return {};
  }
}

export function resolveStore(root: string): Project["store"] {
  const raw = process.env.HAMYAD_STORE || readPointer(root).store;
  if (!raw) return { kind: "dir", path: path.join(root, BRAIN_DIR), external: false };
  const abs = path.resolve(root, expandHome(raw));
  return { kind: /\.md$/i.test(abs) ? "file" : "dir", path: abs, external: true };
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function stateDirFor(root: string, isGit: boolean): string {
  if (isGit) {
    const r = git(root, ["rev-parse", "--git-common-dir"], { allowFail: true });
    if (r.ok && r.out) return path.join(path.resolve(root, r.out), "hamyad");
  }
  const h = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
  return path.join(process.env.HAMYAD_HOME || path.join(os.homedir(), ".hamyad"), "state", h);
}

export interface OpenOptions {
  /** regenerate MEMORY.md / instruction files after every write (local MCP server, CLI) */
  autoRegenerate?: boolean;
}

export function openProject(dir: string | undefined, source?: string, o: OpenOptions = {}): Project {
  const root = findRoot(dir || process.cwd());
  const store = resolveStore(root);
  const isGit = !!gitRoot(root);
  const backend: Backend = store.kind === "file" ? new MemoryFileBackend(store.path) : new FsBackend(store.path);
  const p: Project = {
    root,
    brainDir: store.path,
    store,
    brain: undefined as any,
    isGit,
    brainInGit: isGit && (!store.external || isInside(store.path, root)),
    stateDir: stateDirFor(root, isGit),
  };
  p.brain = new Brain(backend, {
    source,
    afterWrite: o.autoRegenerate ? () => regenerate(p).then(() => undefined) : undefined,
  });
  return p;
}

async function writeIfChanged(file: string, content: string): Promise<boolean> {
  const old = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (old === content) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
  return true;
}

/** Where an `exports` entry points to for this project (undefined = skip). */
export function exportPath(p: Project, e: string): string | undefined {
  const x = expandHome(e);
  if (path.isAbsolute(x)) return path.resolve(x) === path.resolve(p.brainDir) ? undefined : x;
  if (p.store.external && (x === BRAIN_DIR || x.startsWith(BRAIN_DIR + "/") || x.startsWith(BRAIN_DIR + "\\"))) {
    // no .brain/ in the repo: put brain-relative exports next to a folder store; a file store *is* the MEMORY.md
    if (p.store.kind === "file") return undefined;
    return path.join(p.brainDir, x.slice(BRAIN_DIR.length + 1));
  }
  return path.join(p.root, x);
}

export interface RegenerateResult {
  brainMd: boolean;
  claudeMd: boolean;
  files: string[];
}

/**
 * Refresh every generated artefact: BRAIN.md (dir store), MEMORY.md exports
 * and the brief block in CLAUDE.md / AGENTS.md (instruction files).
 */
export async function regenerate(p: Project): Promise<RegenerateResult> {
  const { config, entries } = await p.brain.snapshot();
  const changed: string[] = [];
  let brainMd = false;
  if (p.store.kind === "dir" && existsSync(p.brainDir)) {
    const brief = renderBrief(config, entries, { maxChars: 100_000 });
    brainMd = await writeIfChanged(
      path.join(p.brainDir, "BRAIN.md"),
      `<!-- Generated by hamyad. Add this folder (or just this file / MEMORY.md) to a chat Project via its GitHub integration or as an upload. -->\n${brief}`,
    );
    if (brainMd) changed.push(path.join(p.brainDir, "BRAIN.md"));
  }
  if (config.exports.length) {
    const files = (await p.brain.backend.readAll()).filter((f) => f.path === "config.json" || (f.path.includes("/") && f.path.endsWith(".md")));
    const mem = renderMemoryMd(config, entries, files);
    for (const e of config.exports) {
      const out = exportPath(p, e);
      if (!out) continue;
      if (p.store.kind === "dir" && !p.store.external && !existsSync(p.brainDir) && out.startsWith(p.brainDir)) continue;
      try {
        if (await writeIfChanged(out, mem)) changed.push(out);
      } catch {
        /* an unreachable export (unmounted drive) must not break a hook */
      }
    }
  }
  let claudeMd = false;
  const block = renderInstructionBlock(config, entries);
  for (const rel of config.instructionFiles) {
    const file = path.join(p.root, rel);
    const old = existsSync(file) ? readFileSync(file, "utf8") : "";
    const heading = `# ${path.basename(rel)}`;
    if (await writeIfChanged(file, upsertBlock(old, block, heading))) {
      changed.push(file);
      if (path.basename(rel) === "CLAUDE.md") claudeMd = true;
    }
  }
  return { brainMd, claudeMd, files: changed };
}

// ------------------------------------------------------------------ local state

export interface LocalState {
  /** per tool: when its last session started (drives "changed since your last session") */
  lastSeen?: Record<string, string>;
  lastSessionStart?: string;
  sessionStarts?: Record<string, string>;
  lastImport?: Record<string, string>;
}

export function readState(p: Project): LocalState {
  for (const f of [path.join(p.stateDir, "state.json"), path.join(p.brainDir, ".state.json")]) {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      /* next */
    }
  }
  return {};
}

export async function writeState(p: Project, s: LocalState) {
  if (s.sessionStarts) {
    const keys = Object.keys(s.sessionStarts);
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete s.sessionStarts[k];
  }
  await fs.mkdir(p.stateDir, { recursive: true });
  await fs.writeFile(path.join(p.stateDir, "state.json"), JSON.stringify(s, null, 2) + "\n");
}
