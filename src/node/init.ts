import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../core/config.js";
import { FOLDER, KINDS } from "../core/entry.js";
import { BRAIN_DIR, Project, openProject, regenerate } from "./project.js";

export interface InitOptions {
  project?: string;
  hooks?: boolean;
  mcp?: boolean;
  claudeMd?: boolean;
  /** command used in .mcp.json / hooks; default `hamyad` (global install) */
  command?: string;
}

export const HOOK_MARK = "hamyad hook";

async function readJson(file: string): Promise<any> {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON; fix it and run hamyad init again`);
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

/** Add our hooks to .claude/settings.json without touching anyone else's. */
export function mergeHooks(settings: any, cmd: string): any {
  const s = settings && typeof settings === "object" ? { ...settings } : {};
  s.hooks = { ...(s.hooks || {}) };
  const want: Record<string, string> = {
    SessionStart: `${cmd} hook session-start`,
    SessionEnd: `${cmd} hook session-end`,
  };
  for (const [event, command] of Object.entries(want)) {
    const groups: any[] = Array.isArray(s.hooks[event]) ? s.hooks[event].map((g: any) => ({ ...g, hooks: [...(g.hooks || [])] })) : [];
    let found = false;
    for (const g of groups) {
      g.hooks = g.hooks.map((h: any) => {
        if (typeof h?.command === "string" && h.command.includes(HOOK_MARK)) {
          found = true;
          return { ...h, type: "command", command, timeout: h.timeout ?? 30 };
        }
        return h;
      });
    }
    if (!found) groups.push({ hooks: [{ type: "command", command, timeout: 30 }] });
    s.hooks[event] = groups;
  }
  return s;
}

export async function init(dir: string, o: InitOptions = {}): Promise<{ project: Project; created: string[] }> {
  const root = path.resolve(dir);
  const brainDir = path.join(root, BRAIN_DIR);
  const created: string[] = [];
  const cmd = o.command || "hamyad";

  for (const k of KINDS) {
    const d = path.join(brainDir, FOLDER[k]);
    if (!existsSync(d)) {
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(path.join(d, ".gitkeep"), "");
      created.push(`${BRAIN_DIR}/${FOLDER[k]}/`);
    }
  }
  const cfgFile = path.join(brainDir, "config.json");
  if (!existsSync(cfgFile)) {
    await writeJson(cfgFile, { ...DEFAULT_CONFIG, project: o.project || path.basename(root), claudeMd: o.claudeMd !== false });
    created.push(`${BRAIN_DIR}/config.json`);
  }
  const gi = path.join(brainDir, ".gitignore");
  if (!existsSync(gi)) {
    await fs.writeFile(gi, ".state.json\n*.tmp-*\n");
    created.push(`${BRAIN_DIR}/.gitignore`);
  }
  const readme = path.join(brainDir, "README.md");
  if (!existsSync(readme)) {
    await fs.writeFile(
      readme,
      `# .brain/: shared project memory\n\nManaged by [hamyad](https://github.com/mrzroot/hamyad). One Markdown file per decision, task, note, context fact or session summary.\nClaude Code (stdio MCP + hooks), Claude.ai chat (remote MCP connector) and Claude Desktop all read and write here; GitHub is the source of truth.\n\n- \`decisions/\` choices made and why\n- \`tasks/\` work items with a status\n- \`notes/\` research, findings, links\n- \`context/\` stable facts about the project\n- \`sessions/\` summaries of Claude Code sessions and chats\n- \`BRAIN.md\` generated brief (add it to a Claude.ai Project through the GitHub integration)\n\nYou can edit these files by hand. Run \`hamyad sync\` afterwards.\n`,
    );
    created.push(`${BRAIN_DIR}/README.md`);
  }

  if (o.mcp !== false) {
    const f = path.join(root, ".mcp.json");
    const j = await readJson(f);
    j.mcpServers = j.mcpServers || {};
    if (!j.mcpServers.hamyad) {
      const [command, ...pre] = cmd.split(/\s+/);
      j.mcpServers.hamyad = { command, args: [...pre, "mcp"] };
      await writeJson(f, j);
      created.push(".mcp.json (hamyad server)");
    }
  }
  if (o.hooks !== false) {
    const f = path.join(root, ".claude", "settings.json");
    const before = await readJson(f);
    const after = mergeHooks(before, cmd);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await writeJson(f, after);
      created.push(".claude/settings.json (SessionStart + SessionEnd hooks)");
    }
  }
  const project = openProject(root);
  await regenerate(project);
  return { project, created };
}
