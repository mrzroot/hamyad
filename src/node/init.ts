import { chmodSync, existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CaptureMode, DEFAULT_CONFIG } from "../core/config.js";
import { FOLDER, KINDS } from "../core/entry.js";
import { MemoryFileBackend } from "../backends/memfile.js";
import { git } from "./git.js";
import { BRAIN_DIR, POINTER, Project, expandHome, openProject, regenerate } from "./project.js";

export const ALL_TOOLS = ["claude", "codex", "gemini", "cursor", "copilot", "windsurf", "aider", "zed", "roo", "junie"] as const;
export type ToolName = (typeof ALL_TOOLS)[number];

export interface InitOptions {
  project?: string;
  hooks?: boolean;
  mcp?: boolean;
  claudeMd?: boolean;
  /** command used in MCP configs / hooks; default `hamyad` (global install) */
  command?: string;
  /** which tools to wire up; default: detected ones (always includes claude) */
  tools?: ToolName[] | "all";
  /** also write user-level configs (~/.codex, Windsurf, Claude Desktop) */
  global?: boolean;
  /** git post-commit hook (MEMORY.md refresh + aider import) */
  gitHook?: boolean;
  capture?: CaptureMode;
  /** keep the brain outside the repo: a folder or a single MEMORY.md (Dropbox, Drive, cowork folder…) */
  store?: string;
}

export const HOOK_MARK = "hamyad hook";
const isOurs = (c: unknown) => typeof c === "string" && c.includes(HOOK_MARK);

async function readJson(file: string): Promise<any> {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // JSONC (comments / trailing commas) is common in .vscode and Gemini settings
    try {
      return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      throw new Error(`${file} is not valid JSON; fix it and run hamyad init again`);
    }
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

/** Merge into a JSON file; returns true when the file changed. */
async function patchJson(file: string, fn: (j: any) => any): Promise<boolean> {
  const before = await readJson(file);
  const after = fn(JSON.parse(JSON.stringify(before)));
  if (JSON.stringify(before) === JSON.stringify(after) && existsSync(file)) return false;
  await writeJson(file, after);
  return true;
}

/** Claude/Codex/Gemini style `{hooks: {Event: [{matcher?, hooks: [{type, command}]}]}}`; replaces our entries in place. */
export function mergeNested(settings: any, want: Record<string, Record<string, any>>, matcher?: Record<string, string>): any {
  const s = settings && typeof settings === "object" ? { ...settings } : {};
  s.hooks = { ...(s.hooks || {}) };
  for (const [event, handler] of Object.entries(want)) {
    const groups: any[] = Array.isArray(s.hooks[event]) ? s.hooks[event].map((g: any) => ({ ...g, hooks: [...(g.hooks || [])] })) : [];
    let found = false;
    for (const g of groups) {
      g.hooks = g.hooks.map((h: any) => {
        if (isOurs(h?.command)) {
          found = true;
          return { ...h, ...handler };
        }
        return h;
      });
    }
    if (!found) groups.push({ ...(matcher?.[event] ? { matcher: matcher[event] } : {}), hooks: [handler] });
    s.hooks[event] = groups;
  }
  return s;
}

/** 0.1 API: Claude Code hooks only. */
export function mergeHooks(settings: any, cmd: string): any {
  return mergeNested(settings, claudeHooks(cmd));
}

const h = (command: string, extra: Record<string, any> = {}) => ({ type: "command", command, ...extra });
const claudeHooks = (cmd: string) => ({
  SessionStart: h(`${cmd} hook claude SessionStart`, { timeout: 30 }),
  UserPromptSubmit: h(`${cmd} hook claude UserPromptSubmit`, { timeout: 10 }),
  Stop: h(`${cmd} hook claude Stop`, { timeout: 30 }),
  SessionEnd: h(`${cmd} hook claude SessionEnd`, { timeout: 30 }),
});

/** Flat Cursor style `{version: 1, hooks: {event: [{command}]}}`. */
function mergeFlat(j: any, want: Record<string, Record<string, any>>, field = "command"): any {
  const s = j && typeof j === "object" ? { ...j } : {};
  s.version = s.version || 1;
  s.hooks = { ...(s.hooks || {}) };
  for (const [event, handler] of Object.entries(want)) {
    const list: any[] = Array.isArray(s.hooks[event]) ? [...s.hooks[event]] : [];
    const i = list.findIndex((x) => isOurs(x?.[field]) || isOurs(x?.command) || isOurs(x?.bash));
    if (i >= 0) list[i] = { ...list[i], ...handler };
    else list.push(handler);
    s.hooks[event] = list;
  }
  return s;
}

function tomlBlock(name: string, command: string, args: string[]): string {
  const q = (s: string) => JSON.stringify(s);
  return `[mcp_servers.${name}]\ncommand = ${q(command)}\nargs = [${args.map(q).join(", ")}]\n`;
}

async function upsertToml(file: string, name: string, command: string, args: string[]): Promise<boolean> {
  const old = existsSync(file) ? readFileSync(file, "utf8") : "";
  const block = tomlBlock(name, command, args);
  // the table runs until the next line that starts a new table
  const re = new RegExp(`^\\[mcp_servers\\.${name}\\][^\\n]*\\n(?:(?!\\[)[^\\n]*(?:\\n|$))*`, "m");
  const m = re.exec(old);
  const next = m ? old.slice(0, m.index) + block + (/\n\s*\n$/.test(m[0]) ? "\n" : "") + old.slice(m.index + m[0].length) : (old.trim() ? old.replace(/\s*$/, "\n\n") : "") + block;
  if (next === old) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
  return true;
}

export function detectTools(root: string): ToolName[] {
  const has = (...f: string[]) => f.some((x) => existsSync(path.join(root, x)));
  const onPath = (bin: string) =>
    (process.env.PATH || "").split(path.delimiter).some((d) => d && ["", ".cmd", ".exe"].some((ext) => existsSync(path.join(d, bin + ext))));
  const home = (...f: string[]) => existsSync(path.join(os.homedir(), ...f));
  const out = new Set<ToolName>(["claude"]);
  if (has(".codex", "AGENTS.md") || onPath("codex") || home(".codex")) out.add("codex");
  if (has(".gemini", "GEMINI.md") || onPath("gemini") || home(".gemini")) out.add("gemini");
  if (has(".cursor", ".cursorrules") || onPath("cursor-agent") || onPath("cursor") || home(".cursor")) out.add("cursor");
  if (has(".github/copilot-instructions.md", ".github/hooks", ".vscode") || onPath("copilot") || home(".copilot")) out.add("copilot");
  if (has(".windsurf", ".devin", ".windsurfrules") || home(".codeium", "windsurf") || home(".windsurf")) out.add("windsurf");
  if (has(".aider.conf.yml", ".aider.chat.history.md") || onPath("aider")) out.add("aider");
  if (has(".zed") || onPath("zed") || onPath("zeditor")) out.add("zed");
  if (has(".roo", ".roomodes", ".clinerules")) out.add("roo");
  if (has(".junie") || onPath("junie")) out.add("junie");
  return ALL_TOOLS.filter((t) => out.has(t));
}

const RULE = `This project has ONE shared memory ("brain") managed by hamyad, used by every AI tool on it (Claude, Codex/ChatGPT, Gemini, Cursor, Copilot, Windsurf, aider).

- At the start of a task, read the brief (AGENTS.md / CLAUDE.md block, or call the \`brain_context\` MCP tool). Decisions listed there are binding; anything marked superseded is no longer true.
- When the user makes or confirms a decision, call \`brain_remember\` (kind "decision"). If it replaces an older decision, pass \`supersedes: [old id]\`.
- New work items -> \`brain_remember\` kind "task"; findings -> kind "note". Update task status with \`brain_update\`.
- Without MCP, use the CLI: \`hamyad add decision "..." -m "why" --supersedes <id>\`, \`hamyad search "..."\`.
`;

export interface InitResult {
  project: Project;
  created: string[];
  tools: ToolName[];
  notes: string[];
}

export function claudeDesktopConfigPath(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Claude", "claude_desktop_config.json");
}

async function createStore(root: string, o: InitOptions, created: string[]): Promise<{ external: boolean; storePath: string }> {
  if (!o.store) return { external: false, storePath: path.join(root, BRAIN_DIR) };
  const abs = path.resolve(root, expandHome(o.store));
  const ptr = path.join(root, POINTER);
  const want = { store: o.store };
  const cur = await readJson(ptr);
  if (cur.store !== want.store) {
    await writeJson(ptr, { ...cur, ...want });
    created.push(`${POINTER} (brain stored at ${abs})`);
  }
  if (/\.md$/i.test(abs) && !existsSync(abs)) {
    const be = new MemoryFileBackend(abs);
    await be.write("config.json", JSON.stringify({ ...DEFAULT_CONFIG, project: o.project || path.basename(root) }, null, 2) + "\n");
    created.push(`${abs} (single-file brain)`);
  }
  return { external: true, storePath: abs };
}

export async function init(dir: string, o: InitOptions = {}): Promise<InitResult> {
  const root = path.resolve(dir);
  const created: string[] = [];
  const notes: string[] = [];
  const cmd = o.command || "hamyad";
  const [bin, ...pre] = cmd.split(/\s+/);
  const tools: ToolName[] = o.tools === "all" ? [...ALL_TOOLS] : o.tools?.length ? [...new Set(o.tools)] : detectTools(root);

  const { external, storePath } = await createStore(root, o, created);
  const isFileStore = external && /\.md$/i.test(storePath);
  if (!isFileStore) {
    const brainDir = storePath;
    for (const k of KINDS) {
      const d = path.join(brainDir, FOLDER[k]);
      if (!existsSync(d)) {
        await fs.mkdir(d, { recursive: true });
        await fs.writeFile(path.join(d, ".gitkeep"), "");
        created.push(`${external ? brainDir : BRAIN_DIR}/${FOLDER[k]}/`);
      }
    }
    const cfgFile = path.join(brainDir, "config.json");
    if (!existsSync(cfgFile)) {
      const cfg: any = { ...DEFAULT_CONFIG, project: o.project || path.basename(root), capture: { ...DEFAULT_CONFIG.capture, sessions: o.capture || "summary" } };
      if (o.claudeMd === false) cfg.instructionFiles = cfg.instructionFiles.filter((f: string) => f !== "CLAUDE.md");
      if (!tools.some((t) => t !== "claude")) cfg.instructionFiles = cfg.instructionFiles.filter((f: string) => f !== "AGENTS.md");
      await writeJson(cfgFile, cfg);
      created.push(`${external ? brainDir : BRAIN_DIR}/config.json`);
    } else if (o.capture) {
      const cfg = await readJson(cfgFile);
      if (cfg.capture?.sessions !== o.capture) {
        cfg.capture = { ...(cfg.capture || {}), sessions: o.capture };
        await writeJson(cfgFile, cfg);
        created.push(`${BRAIN_DIR}/config.json (capture.sessions = ${o.capture})`);
      }
    }
    const gi = path.join(brainDir, ".gitignore");
    if (!existsSync(gi)) {
      await fs.writeFile(gi, ".state.json\n*.tmp-*\n");
      created.push(`${external ? brainDir : BRAIN_DIR}/.gitignore`);
    }
    const readme = path.join(brainDir, "README.md");
    if (!existsSync(readme)) {
      await fs.writeFile(
        readme,
        `# .brain/: shared project memory\n\nManaged by [hamyad](https://github.com/mrzroot/hamyad). One Markdown file per decision, task, note, context fact, session summary or change set.\nEvery AI tool on this project reads and writes here: Claude Code, Claude.ai, Codex, ChatGPT, Gemini CLI, Cursor, Copilot, Windsurf, aider.\n\n- \`decisions/\` choices made and why (superseded ones keep a link to what replaced them)\n- \`tasks/\` work items with a status\n- \`notes/\` research, findings, links\n- \`context/\` stable facts about the project\n- \`sessions/\` one summary per agent session or chat, attributed to the tool\n- \`changes/\` change journal: what each agent session changed in the code\n- \`transcripts/\` full, redacted transcripts (only with capture.sessions = "full")\n- \`MEMORY.md\` one-file export (upload it to any chat tool), \`BRAIN.md\` brief\n\nYou can edit these files by hand. Run \`hamyad sync\` afterwards.\n`,
      );
      created.push(`${external ? brainDir : BRAIN_DIR}/README.md`);
    }
  }

  const mcpArgs = [...pre, "mcp"];
  const mark = async (file: string, label: string, changed: boolean) => {
    if (changed) created.push(`${path.relative(root, file) || file} (${label})`);
  };

  for (const t of tools) {
    if (t === "claude") {
      if (o.mcp !== false)
        await mark(path.join(root, ".mcp.json"), "MCP for Claude Code + Copilot CLI", await patchJson(path.join(root, ".mcp.json"), (j) => {
          j.mcpServers = j.mcpServers || {};
          j.mcpServers.hamyad = { command: bin, args: mcpArgs };
          return j;
        }));
      if (o.hooks !== false) {
        const f = path.join(root, ".claude", "settings.json");
        await mark(f, "Claude Code hooks", await patchJson(f, (j) => mergeNested(j, claudeHooks(cmd))));
      }
    }
    if (t === "codex") {
      if (o.hooks !== false) {
        const f = path.join(root, ".codex", "hooks.json");
        await mark(f, "Codex hooks", await patchJson(f, (j) =>
          mergeNested(j, {
            SessionStart: h(`${cmd} hook codex SessionStart`, { timeout: 30, statusMessage: "hamyad: loading shared brain", additionalContextLimit: 6000 }),
            UserPromptSubmit: h(`${cmd} hook codex UserPromptSubmit`, { timeout: 10 }),
            Stop: h(`${cmd} hook codex Stop`, { timeout: 60, async: true }),
            SessionEnd: h(`${cmd} hook codex SessionEnd`, { timeout: 3 }),
          }),
        ));
        notes.push("Codex runs project hooks only after you trust them: start `codex` here once and approve them in /hooks.");
      }
      if (o.mcp !== false) await mark(path.join(root, ".codex", "config.toml"), "Codex MCP", await upsertToml(path.join(root, ".codex", "config.toml"), "hamyad", bin, mcpArgs));
    }
    if (t === "gemini") {
      const f = path.join(root, ".gemini", "settings.json");
      await mark(f, "Gemini CLI hooks + MCP + AGENTS.md context", await patchJson(f, (j) => {
        if (o.hooks !== false)
          j = mergeNested(j, {
            SessionStart: h(`${cmd} hook gemini SessionStart`, { name: "hamyad-SessionStart", timeout: 30000 }),
            BeforeAgent: h(`${cmd} hook gemini BeforeAgent`, { name: "hamyad-BeforeAgent", timeout: 10000 }),
            AfterAgent: h(`${cmd} hook gemini AfterAgent`, { name: "hamyad-AfterAgent", timeout: 60000 }),
            SessionEnd: h(`${cmd} hook gemini SessionEnd`, { name: "hamyad-SessionEnd", timeout: 10000 }),
          });
        if (o.mcp !== false) {
          j.mcpServers = j.mcpServers || {};
          j.mcpServers.hamyad = { command: bin, args: mcpArgs };
        }
        j.context = j.context || {};
        const fn = j.context.fileName;
        const list: string[] = Array.isArray(fn) ? fn : typeof fn === "string" ? [fn] : ["GEMINI.md"];
        if (!list.includes("AGENTS.md")) j.context.fileName = [...list, "AGENTS.md"];
        return j;
      }));
      notes.push("Gemini CLI runs project hooks only in a trusted folder (/permissions or the trust prompt).");
    }
    if (t === "cursor") {
      if (o.hooks !== false) {
        const f = path.join(root, ".cursor", "hooks.json");
        const c = (e: string, timeout: number) => ({ command: `${cmd} hook cursor ${e}`, timeout });
        await mark(f, "Cursor hooks", await patchJson(f, (j) =>
          mergeFlat(j, {
            sessionStart: c("sessionStart", 30),
            beforeSubmitPrompt: c("beforeSubmitPrompt", 10),
            afterAgentResponse: c("afterAgentResponse", 10),
            stop: c("stop", 60),
            sessionEnd: c("sessionEnd", 30),
          }),
        ));
      }
      if (o.mcp !== false)
        await mark(path.join(root, ".cursor", "mcp.json"), "Cursor MCP", await patchJson(path.join(root, ".cursor", "mcp.json"), (j) => {
          j.mcpServers = j.mcpServers || {};
          j.mcpServers.hamyad = { command: bin, args: mcpArgs };
          return j;
        }));
      const rule = path.join(root, ".cursor", "rules", "hamyad.mdc");
      const body = `---\ndescription: Shared project brain (hamyad)\nalwaysApply: true\n---\n\n${RULE}`;
      if (!existsSync(rule) || readFileSync(rule, "utf8") !== body) {
        await fs.mkdir(path.dirname(rule), { recursive: true });
        await fs.writeFile(rule, body);
        created.push(".cursor/rules/hamyad.mdc (Cursor rule)");
      }
    }
    if (t === "copilot") {
      if (o.hooks !== false) {
        const f = path.join(root, ".github", "hooks", "hamyad.json");
        const c = (e: string, timeoutSec: number) => ({ type: "command", bash: `${cmd} hook copilot ${e}`, powershell: `${cmd} hook copilot ${e}`, timeoutSec });
        await mark(f, "Copilot CLI / cloud agent hooks", await patchJson(f, (j) =>
          mergeFlat(
            j,
            { sessionStart: c("sessionStart", 30), userPromptSubmitted: c("userPromptSubmitted", 10), agentStop: c("agentStop", 60), sessionEnd: c("sessionEnd", 30) },
            "bash",
          ),
        ));
      }
      if (o.mcp !== false)
        await mark(path.join(root, ".vscode", "mcp.json"), "VS Code Copilot MCP", await patchJson(path.join(root, ".vscode", "mcp.json"), (j) => {
          j.servers = j.servers || {};
          j.servers.hamyad = { type: "stdio", command: bin, args: mcpArgs };
          return j;
        }));
    }
    if (t === "windsurf") {
      if (o.hooks !== false) {
        const c = (e: string) => ({ command: `${cmd} hook windsurf ${e}`, powershell: `${cmd} hook windsurf ${e}`, show_output: false });
        for (const rel of [path.join(".windsurf", "hooks.json"), path.join(".devin", "hooks.json")]) {
          const f = path.join(root, rel);
          await mark(f, "Windsurf / Devin Desktop Cascade hooks", await patchJson(f, (j) => {
            const s = mergeFlat(j, { pre_user_prompt: c("pre_user_prompt"), post_cascade_response_with_transcript: c("post_cascade_response_with_transcript") });
            if (!j.version) delete s.version;
            return s;
          }));
        }
      }
      const rule = path.join(root, ".windsurf", "rules", "hamyad.md");
      const body = `---\ntrigger: always_on\ndescription: Shared project brain (hamyad)\n---\n\n${RULE}`;
      if (!existsSync(rule) || readFileSync(rule, "utf8") !== body) {
        await fs.mkdir(path.dirname(rule), { recursive: true });
        await fs.writeFile(rule, body);
        created.push(".windsurf/rules/hamyad.md (Windsurf rule)");
      }
      if (!o.global) notes.push("Windsurf only reads MCP servers from ~/.codeium/windsurf/mcp_config.json: run `hamyad init --tools windsurf --global` to add it there.");
    }
    if (t === "zed" && o.mcp !== false) {
      const f = path.join(root, ".zed", "settings.json");
      await mark(f, "Zed agent MCP (context_servers)", await patchJson(f, (j) => {
        j.context_servers = j.context_servers || {};
        j.context_servers.hamyad = { command: bin, args: mcpArgs, env: {} };
        return j;
      }));
    }
    if (t === "roo" && o.mcp !== false) {
      const f = path.join(root, ".roo", "mcp.json");
      await mark(f, "Roo Code MCP", await patchJson(f, (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers.hamyad = { command: bin, args: mcpArgs };
        return j;
      }));
      notes.push("Cline keeps MCP servers in its own global settings: Cline → MCP Servers → Configure, paste the snippet from `hamyad connect cline`.");
    }
    if (t === "junie" && o.mcp !== false) {
      const f = path.join(root, ".junie", "mcp", "mcp.json");
      await mark(f, "JetBrains Junie MCP", await patchJson(f, (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers.hamyad = { command: bin, args: mcpArgs };
        return j;
      }));
      notes.push("JetBrains AI Assistant chat: Settings → Tools → AI Assistant → Model Context Protocol → Add → paste the JSON from `hamyad connect jetbrains` (project level).");
    }
    if (t === "aider") {
      const f = path.join(root, ".aider.conf.yml");
      const old = existsSync(f) ? readFileSync(f, "utf8") : "";
      if (!/^read\s*:/m.test(old)) {
        await fs.writeFile(f, (old.trim() ? old.replace(/\s*$/, "\n") : "") + "# hamyad: give aider the shared brain brief\nread:\n  - AGENTS.md\n");
        created.push(".aider.conf.yml (read: AGENTS.md)");
      } else if (!/AGENTS\.md/.test(old)) notes.push("aider: add AGENTS.md to the `read:` list in .aider.conf.yml so it sees the shared brief.");
      notes.push("aider has no hooks/MCP: its chats are imported from .aider.chat.history.md on every commit (git hook) and by `hamyad import` / `hamyad watch`.");
    }
  }

  // instruction files: AGENTS.md is read by Codex, Cursor, Copilot, Windsurf, Gemini (via context.fileName) and aider (read:)
  if (!isFileStore) {
    const cfgFile = path.join(storePath, "config.json");
    const cfg = await readJson(cfgFile);
    if (Array.isArray(cfg.instructionFiles) && tools.some((t) => t !== "claude") && !cfg.instructionFiles.includes("AGENTS.md")) {
      cfg.instructionFiles.push("AGENTS.md");
      await writeJson(cfgFile, cfg);
      created.push(`${BRAIN_DIR}/config.json (+ AGENTS.md brief)`);
    }
  }

  // git post-commit: refresh exports, import aider chats
  if (o.gitHook !== false && git(root, ["rev-parse", "--git-dir"], { allowFail: true }).ok) {
    const hp = git(root, ["rev-parse", "--git-path", "hooks"], { allowFail: true });
    if (hp.ok) {
      const f = path.resolve(root, hp.out, "post-commit");
      const line = `command -v ${bin} >/dev/null 2>&1 && ${cmd} hook git post-commit >/dev/null 2>&1 || true  # hamyad\n`;
      const old = existsSync(f) ? readFileSync(f, "utf8") : "#!/bin/sh\n";
      if (!old.includes("# hamyad")) {
        const lines = old.split(/(?<=\n)/);
        const next = lines[0]?.startsWith("#!") ? lines[0] + line + lines.slice(1).join("") : "#!/bin/sh\n" + line + old;
        await fs.mkdir(path.dirname(f), { recursive: true });
        await fs.writeFile(f, next);
        try {
          chmodSync(f, 0o755);
        } catch {
          /* windows */
        }
        created.push("git post-commit hook (refresh MEMORY.md, import aider chats)");
      }
    }
  }

  if (o.global) {
    const name = `hamyad-${path.basename(root).replace(/[^\w-]+/g, "-")}`;
    const dirArgs = [...mcpArgs, "--dir", root];
    if (tools.includes("codex"))
      await mark(path.join(os.homedir(), ".codex", "config.toml"), "Codex user MCP", await upsertToml(path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml"), name.replace(/-/g, "_"), bin, dirArgs));
    if (tools.includes("windsurf")) {
      const f = path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
      await mark(f, "Windsurf MCP", await patchJson(f, (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers[name] = { command: bin, args: dirArgs };
        return j;
      }));
    }
    const cd = claudeDesktopConfigPath();
    if (existsSync(path.dirname(cd)) || tools.includes("claude"))
      await mark(cd, "Claude Desktop MCP", await patchJson(cd, (j) => {
        j.mcpServers = j.mcpServers || {};
        j.mcpServers[name] = { command: bin, args: dirArgs };
        return j;
      }));
  }

  const project = openProject(root);
  await regenerate(project);
  return { project, created, tools, notes };
}
