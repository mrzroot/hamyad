#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, promises as fsp } from "node:fs";
import { Brain, changesSince } from "./core/brain.js";
import { isKind, KINDS } from "./core/entry.js";
import { renderBrief, renderChanges, renderMemoryMd } from "./core/render.js";
import { renderTimeline, sortTimeline } from "./core/timeline.js";
import { toolLabel } from "./core/tools.js";
import { GitHubBackend } from "./backends/github.js";
import { McpServer, INSTRUCTIONS } from "./mcp/server.js";
import { runStdio } from "./mcp/stdio.js";
import { serveHttp } from "./node/serve.js";
import { ALL_TOOLS, init, ToolName } from "./node/init.js";
import { openProject, Project, readState, regenerate } from "./node/project.js";
import { commitBrain, git, pullFastForward, pushBrain, SyncReport } from "./node/git.js";
import { brainRel, readStdin, runHook } from "./node/hooks.js";
import { importAll, IMPORT_TOOLS } from "./node/importers.js";
import { projectTimeline } from "./node/timeline.js";
import { absorbAutoMemory } from "./node/absorb.js";
import { VERSION } from "./version.js";

type Flags = Record<string, string | boolean>;

export function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  const short: Record<string, string> = { y: "yes", m: "body", t: "tags", s: "status", n: "limit", k: "kind", p: "port", d: "dir", h: "help", v: "version" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    let key: string | undefined;
    let val: string | undefined;
    if (a.startsWith("--")) [key, val] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    else if (/^-[a-zA-Z]$/.test(a)) key = short[a[1]] || a[1];
    if (!key) {
      pos.push(a);
      continue;
    }
    if (key.startsWith("no-")) {
      flags[key.slice(3)] = false;
      continue;
    }
    if (val === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
      const boolish = ["help", "version", "json", "dry-run", "git", "all", "global", "quiet", "import", "once", "yes", "open", "approve", "tunnel", "worker", "init", "verify"];
      if (!boolish.includes(key)) val = argv[++i];
    }
    flags[key] = val === undefined ? true : val;
  }
  return { pos, flags };
}

const C = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number, s: string) => (C ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c(1, s);
const dim = (s: string) => c(2, s);
const green = (s: string) => c(32, s);
const yellow = (s: string) => c(33, s);

const HELP = `${bold("hamyad")} ${VERSION} · one shared project brain for every AI coding & chat tool
  Claude (Code/Desktop/.ai) · ChatGPT · Codex · Gemini · Grok · Perplexity · Cursor · Copilot · Windsurf
  Zed · Cline/Roo · JetBrains · aider · anything else via MCP, REST/OpenAPI or one MEMORY.md

${bold("Setup")}
  hamyad setup [--tunnel | --worker | --url URL | --no-chat] [-y] [--open] [--no-approve] [-p 8787]
                                        wizard: init --all, pre-approve tools, public URL for chat apps
                                        (free Cloudflare quick tunnel or Worker) + ready-to-paste connector links
  hamyad tunnel                         = setup --tunnel -y: share this brain with chat apps right now
  hamyad init [--all | --tools claude,codex,gemini,cursor,copilot,windsurf,aider,zed,roo,junie] [--global]
              [--store PATH|FILE.md] [--capture off|summary|full] [--no-git-hook] [--project NAME]
                                        wire MCP + hooks + instruction files for each tool
                                        (default: tools detected in the repo; --store = no-GitHub mode)
  hamyad connect [tool] [--url URL]     exact setup for any AI: chatgpt, claude-ai, gemini-app, grok, perplexity,
                                        codex, cursor, windsurf, copilot, zed, cline, jetbrains, aider, any…
  hamyad status                         brain, per-tool integration, last session per tool

${bold("Memory")}
  hamyad add <decision|task|note|context> "title" [-m body] [-t a,b] [-s status] [--supersedes id1,id2]
  hamyad supersede <old-id> <new-id>    mark an older decision/fact as replaced
  hamyad list [kind] [-s status] [--tag T] [--tool T] [-n 30] [--json]
  hamyad search "query" [-k kind]       hamyad show <id>
  hamyad done <id> [-m note]            hamyad update <id> [-s status] [--append text] [--title T]
  hamyad context [--since ISO] [--tool T] [--chars 6000]   the brief every tool sees

${bold("Across tools")}
  hamyad timeline [-n 40] [--tool T] [--since ISO] [--no-git] [--json]
                                        chats, sessions, code changes, decisions, commits
  hamyad import [tool…] [--since ISO] [--dry-run]
                                        import local chat logs (${IMPORT_TOOLS.join(", ")})
  hamyad sync [--no-pull] [--no-push] [--import] [--quiet]
                                        pull, regenerate CLAUDE.md/AGENTS.md/MEMORY.md, commit, push
  hamyad watch [--interval 300] [--once]   timer trigger: import + sync on a schedule
  hamyad export [--out FILE]            write the one-file MEMORY.md (stdout with --out -)
  hamyad absorb [--from DIR]            import Claude Code auto memory

${bold("Servers & hooks")}
  hamyad mcp [--source NAME]            MCP over stdio (source defaults to the client's name)
  hamyad serve [-p 8787] [--host H] [--token T] [--github owner/repo] [--git]
                                        remote MCP (/mcp) + REST/OpenAPI (/api, /openapi.json) for chat apps
  hamyad hook <tool> <event>            hook entry point (tool: ${["claude", "codex", "gemini", "cursor", "copilot", "windsurf", "git"].join(", ")})

${bold("Global")}  -d, --dir PATH   project root (default: nearest folder with .brain/ or .hamyad.json, or git root)

Docs: https://github.com/mrzroot/hamyad · https://mrzroot.github.io/hamyad/`;

function out(s: string) {
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}

function reportSync(rep: SyncReport) {
  if (rep.pulled) out(`  ${green("pull")}    ${rep.pulled}`);
  if (rep.committed) out(`  ${green("commit")}  ${rep.committed}`);
  if (rep.pushed) out(`  ${green("push")}    ${rep.pushed}`);
  for (const s of rep.skipped) out(`  ${yellow("skip")}    ${s}`);
}

interface SyncResult extends SyncReport {
  files: string[];
  imported: number;
}

/** pull → (import local chat logs) → regenerate → commit → push. Shared by sync, watch and the timer trigger. */
export async function syncOnce(p: Project, o: { pull?: boolean; push?: boolean; commit?: boolean; imports?: boolean }): Promise<SyncResult> {
  const s = await p.brain.snapshot();
  const rep: SyncResult = { skipped: [], files: [], imported: 0 };
  if (p.brainInGit && o.pull !== false && s.config.git.pull) pullFastForward(p.root, rep);
  if (o.imports) rep.imported = (await importAll(p)).reduce((n, r) => n + r.imported.length, 0);
  rep.files = (await regenerate(p)).files;
  if (p.brainInGit && o.commit !== false && s.config.git.commit) {
    commitBrain(p.root, brainRel(p), "brain: sync [cli]", rep, s.config.instructionFiles);
    if (o.push !== false && s.config.git.push) pushBrain(p.root, rep);
  }
  return rep;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  const dir = typeof flags.dir === "string" ? flags.dir : undefined;
  if (flags.version || cmd === "version") return out(VERSION), 0;
  if (!cmd || flags.help || cmd === "help") return out(HELP), 0;

  switch (cmd) {
    case "init": {
      const root = path.resolve(dir || process.cwd());
      let tools: ToolName[] | "all" | undefined = flags.all ? "all" : undefined;
      if (typeof flags.tools === "string") {
        const want = flags.tools.split(",").map((t) => t.trim().toLowerCase().replace(/-(code|cli)$/, "")).filter(Boolean);
        const bad = want.filter((t) => !(ALL_TOOLS as readonly string[]).includes(t));
        if (bad.length) {
          process.stderr.write(`unknown tool(s): ${bad.join(", ")} (use ${ALL_TOOLS.join(", ")})\n`);
          return 2;
        }
        tools = want as ToolName[];
      }
      const capture = typeof flags.capture === "string" ? flags.capture : undefined;
      if (capture && !["off", "summary", "full"].includes(capture)) {
        process.stderr.write("--capture must be off, summary or full\n");
        return 2;
      }
      const r = await init(root, {
        project: typeof flags.project === "string" ? flags.project : undefined,
        hooks: flags.hooks !== false,
        mcp: flags.mcp !== false,
        claudeMd: flags["claude-md"] !== false,
        command: typeof flags.command === "string" ? flags.command : undefined,
        tools,
        global: !!flags.global,
        gitHook: flags["git-hook"] !== false,
        capture: capture as any,
        store: typeof flags.store === "string" ? flags.store : undefined,
      });
      out(`${green("✓")} hamyad brain ready: ${r.project.brainDir}`);
      out(`  tools: ${r.tools.map((t) => bold(t)).join(", ")}`);
      for (const c of r.created) out(`  + ${c}`);
      if (!r.created.length) out(dim("  (everything was already set up)"));
      for (const n of r.notes) out(`  ${yellow("!")} ${n}`);
      const commit = r.project.brainInGit ? "commit the files above (git add -A && git commit -m \"Add hamyad brain\")" : "share the store folder/file (Dropbox, Drive, a cowork folder) with your other machines";
      out(`\nNext:\n  1. ${commit}\n  2. ${bold("hamyad connect")} for claude.ai, ChatGPT and Claude Desktop\n  3. ${bold("hamyad import")} to pull in past chats from tools already used here`);
      return 0;
    }
    case "mcp": {
      // explicit --source / HAMYAD_SOURCE wins; otherwise the MCP client's own name (initialize.clientInfo)
      const source = typeof flags.source === "string" ? flags.source : process.env.HAMYAD_SOURCE || undefined;
      const p = openProject(dir, source || "mcp", { autoRegenerate: true });
      await runStdio(new McpServer(p.brain, { source, fallbackSource: "mcp" }));
      return 0;
    }
    case "serve": {
      const port = Number(flags.port || process.env.PORT || 8787);
      const host = typeof flags.host === "string" ? flags.host : process.env.HOST || "127.0.0.1";
      const token = typeof flags.token === "string" ? flags.token : process.env.HAMYAD_TOKEN;
      const explicit = typeof flags.source === "string" ? flags.source : undefined;
      const source = explicit || "claude-chat";
      let brain: Brain;
      let label: string;
      if (typeof flags.github === "string" || process.env.GITHUB_REPO) {
        const repo = (typeof flags.github === "string" ? flags.github : process.env.GITHUB_REPO)!;
        const backend = new GitHubBackend({
          repo,
          token: process.env.GITHUB_TOKEN || "",
          branch: typeof flags.branch === "string" ? flags.branch : process.env.GITHUB_BRANCH,
        });
        const { refreshMemoryExport } = await import("./worker.js");
        brain = new Brain(backend, { source, afterWrite: () => refreshMemoryExport(backend).catch(() => undefined) });
        label = backend.label;
      } else {
        const p = openProject(dir, source, { autoRegenerate: true });
        brain = p.brain;
        label = `fs:${p.brainDir}`;
        if (flags.git) {
          const { FsBackend } = await import("./backends/fs.js");
          brain = new Brain(
            new FsBackend(p.brainDir, (_abs, message) => {
              const rep: SyncReport = { skipped: [] };
              commitBrain(p.root, brainRel(p), message, rep);
              pushBrain(p.root, rep);
            }),
            { source, afterWrite: () => regenerate(p).then(() => undefined) },
          );
        }
      }
      if (!token && host !== "127.0.0.1" && host !== "localhost") {
        process.stderr.write("refusing to listen on a public interface without --token / HAMYAD_TOKEN\n");
        return 2;
      }
      await serveHttp((ctx) => new McpServer(brain, { source: explicit || ctx.source, fallbackSource: source }), { port, host, token, label });
      process.stderr.write(`hamyad MCP (Streamable HTTP) on http://${host}:${port}/mcp  store=${label}  auth=${token ? "token" : "none"}\n`);
      return await new Promise<number>(() => {});
    }
    case "setup":
    case "tunnel": {
      const { setup } = await import("./node/setup.js");
      const mode = cmd === "tunnel" || flags.tunnel ? "tunnel" : flags.worker ? "worker" : typeof flags.url === "string" ? "url" : flags.chat === false ? "none" : undefined;
      return await setup(
        {
          dir,
          mode,
          url: typeof flags.url === "string" ? flags.url : undefined,
          token: typeof flags.token === "string" ? flags.token : process.env.HAMYAD_TOKEN || undefined,
          yes: !!flags.yes || cmd === "tunnel",
          open: typeof flags.open === "boolean" ? flags.open : undefined,
          approve: typeof flags.approve === "boolean" ? flags.approve : undefined,
          init: typeof flags.init === "boolean" ? flags.init : undefined,
          port: flags.port ? Number(flags.port) : undefined,
          once: !!flags.once,
          verify: flags.verify !== false,
          color: C,
          runInit: (root) => main(["init", "--all", "--dir", root]),
        },
        async (p, port, token) => {
          const brain = p.brainInGit
            ? new Brain(
                new (await import("./backends/fs.js")).FsBackend(p.brainDir, (_abs, message) => {
                  const rep: SyncReport = { skipped: [] };
                  commitBrain(p.root, brainRel(p), message, rep);
                  pushBrain(p.root, rep);
                }),
                { source: "claude-chat", afterWrite: () => regenerate(p).then(() => undefined) },
              )
            : p.brain;
          const srv = await serveHttp((ctx) => new McpServer(brain, { source: ctx.source, fallbackSource: "claude-chat" }), { port, host: "127.0.0.1", token, label: `fs:${p.brainDir}` });
          return { close: () => srv.close() };
        },
      );
    }
    case "hook": {
      // hamyad hook <tool> <event>   (0.1: hamyad hook session-start|session-end  = claude)
      let [tool, event] = pos;
      const legacy: Record<string, string> = { "session-start": "SessionStart", "session-end": "SessionEnd", stop: "Stop" };
      if (tool && legacy[tool] && !event) [tool, event] = ["claude", legacy[tool]];
      if (!tool || !event) {
        process.stderr.write("usage: hamyad hook <claude|codex|gemini|cursor|copilot|windsurf|git> <event>\n");
        return 0; // never fail an agent session
      }
      const payload = tool === "git" ? {} : await readStdin();
      const o = await runHook(tool, event, payload, dir, (l) => process.stderr.write(l + "\n"));
      if (o) out(o);
      return 0;
    }
  }

  const p = openProject(dir, typeof flags.source === "string" ? flags.source : "cli");
  switch (cmd) {
    case "add":
    case "remember": {
      const kind = pos.shift();
      if (!isKind(kind)) {
        process.stderr.write(`kind must be one of: ${KINDS.join(", ")}\n`);
        return 2;
      }
      const supersedes = typeof flags.supersedes === "string" ? flags.supersedes.split(/[\s,]+/).filter(Boolean) : [];
      const e = await p.brain.add({
        kind,
        title: pos.join(" "),
        body: typeof flags.body === "string" ? flags.body : undefined,
        tags: typeof flags.tags === "string" ? flags.tags.split(",") : undefined,
        status: typeof flags.status === "string" ? flags.status : undefined,
        supersedes,
      });
      await regenerate(p);
      out(`${green("✓")} ${e.kind} ${bold(e.id)} ${e.title}  ${dim(e.path)}`);
      for (const id of e.supersedes || []) out(`  ${yellow("✗")} ${id} is now superseded by ${e.id}`);
      if (!supersedes.length) {
        const maybe = await p.brain.conflicts({ kind: e.kind, title: e.title, tags: e.tags }, e.id);
        if (maybe.length) {
          out(yellow(`  possibly conflicting earlier ${e.kind}s:`));
          for (const m of maybe) out(`    ${bold(m.id)} ${m.title} ${dim(toolLabel(m.source))}`);
          out(dim(`  if this replaces one: hamyad supersede <old-id> ${e.id}`));
        }
      }
      return 0;
    }
    case "supersede": {
      if (pos.length < 2) {
        process.stderr.write("usage: hamyad supersede <old-id> <new-id>\n");
        return 2;
      }
      const { old, by } = await p.brain.supersede(pos[0], pos[1]);
      await regenerate(p);
      out(`${green("✓")} ${old.id} "${old.title}" → superseded by ${by.id} "${by.title}"`);
      return 0;
    }
    case "list":
    case "ls": {
      const kind = pos[0] && isKind(pos[0]) ? pos[0] : undefined;
      let list = await p.brain.list({
        kind,
        status: typeof flags.status === "string" ? flags.status : undefined,
        tag: typeof flags.tag === "string" ? flags.tag : undefined,
        limit: typeof flags.tool === "string" ? 100000 : Number(flags.limit || 30),
      });
      if (typeof flags.tool === "string") list = list.filter((e) => e.source === flags.tool || e.source.startsWith(String(flags.tool))).slice(0, Number(flags.limit || 30));
      if (flags.json) return out(JSON.stringify(list, null, 2)), 0;
      if (!list.length) out(dim("(empty)"));
      for (const e of list)
        out(`${dim((e.updated || e.created).slice(0, 10))} ${e.kind.padEnd(8)} ${bold(e.id)} ${e.status ? `[${e.status}] ` : ""}${e.title} ${dim(toolLabel(e.source))}`);
      return 0;
    }
    case "search":
    case "find": {
      const hits = await p.brain.search(pos.join(" "), { kind: isKind(flags.kind) ? flags.kind : undefined, limit: Number(flags.limit || 10) });
      if (!hits.length) out(dim("no matches"));
      for (const e of hits) out(`${e.kind.padEnd(8)} ${bold(e.id)} ${e.title} ${dim(e.source)}`);
      return 0;
    }
    case "show":
    case "get": {
      const e = await p.brain.get(pos[0] || "");
      if (!e) {
        process.stderr.write(`no entry matches "${pos[0]}"\n`);
        return 1;
      }
      const rel = [e.supersededBy ? `superseded by ${e.supersededBy}` : "", e.supersedes?.length ? `supersedes ${e.supersedes.join(", ")}` : ""].filter(Boolean).join(" · ");
      out(`${bold(e.title)}\n${dim(`${e.id} · ${e.kind}${e.status ? ` · ${e.status}` : ""} · ${toolLabel(e.source)} · ${e.updated}`)}${rel ? `\n${yellow(rel)}` : ""}\n\n${e.body}`);
      return 0;
    }
    case "done":
    case "update": {
      const e = await p.brain.update(pos[0] || "", {
        status: cmd === "done" ? "done" : typeof flags.status === "string" ? flags.status : undefined,
        append: typeof flags.append === "string" ? flags.append : typeof flags.body === "string" ? flags.body : undefined,
        title: typeof flags.title === "string" ? flags.title : undefined,
        tags: typeof flags.tags === "string" ? flags.tags.split(",") : undefined,
      });
      await regenerate(p);
      out(`${green("✓")} ${e.id} ${e.status ? `[${e.status}] ` : ""}${e.title}`);
      return 0;
    }
    case "context":
    case "brief": {
      const s = await p.brain.snapshot();
      const tool = typeof flags.tool === "string" ? flags.tool : undefined;
      const since = typeof flags.since === "string" ? flags.since : tool ? readState(p).lastSeen?.[tool] : undefined;
      const changed = since ? renderChanges(changesSince(s.entries, since, tool), { since, tool }) : "";
      if (changed) out(changed + "\n");
      out(renderBrief(s.config, s.entries, { maxChars: Number(flags.chars || s.config.briefChars) }));
      return 0;
    }
    case "timeline":
    case "log": {
      const items = sortTimeline(await projectTimeline(p, { git: flags.git !== false, dibs: flags.dibs !== false }), {
        tool: typeof flags.tool === "string" ? flags.tool : undefined,
        since: typeof flags.since === "string" ? flags.since : undefined,
        limit: Number(flags.limit || 40),
      });
      if (flags.json) return out(JSON.stringify(items, null, 2)), 0;
      out(items.length ? renderTimeline(items, { color: C }) : dim("nothing recorded yet"));
      return 0;
    }
    case "import": {
      const tools = pos.length ? pos : [...IMPORT_TOOLS];
      const bad = tools.filter((t) => !(IMPORT_TOOLS as readonly string[]).includes(t));
      if (bad.length) {
        process.stderr.write(`unknown tool(s): ${bad.join(", ")} (use ${IMPORT_TOOLS.join(", ")})\n`);
        return 2;
      }
      const res = await importAll(p, tools, { since: typeof flags.since === "string" ? flags.since : undefined, dryRun: !!flags["dry-run"] });
      let n = 0;
      for (const r of res) {
        if (!r.files && !r.imported.length) continue;
        out(`${bold(toolLabel(r.tool).padEnd(12))} ${r.files} log file(s), ${green(String(r.imported.length))} ${flags["dry-run"] ? "would be imported" : "imported"}${r.unchanged ? dim(`, ${r.unchanged} already captured`) : ""}`);
        for (const e of r.imported.slice(0, 8)) out(`  + ${e.title}`);
        n += r.imported.length;
      }
      if (!res.some((r) => r.files)) out(dim("no local chat logs for this project found"));
      if (n && !flags["dry-run"] && flags.commit !== false && p.brainInGit) {
        const rep: SyncReport = { skipped: [] };
        commitBrain(p.root, brainRel(p), "brain: import chat logs [cli]", rep, (await p.brain.snapshot()).config.instructionFiles);
        reportSync(rep);
      }
      return 0;
    }
    case "export": {
      const s = await p.brain.snapshot();
      const files = (await p.brain.backend.readAll()).filter((f) => f.path === "config.json" || (f.path.includes("/") && f.path.endsWith(".md")));
      const mem = renderMemoryMd(s.config, s.entries, files);
      const dest = typeof flags.out === "string" ? flags.out : undefined;
      if (dest === "-") return process.stdout.write(mem), 0;
      if (dest) {
        await fsp.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
        await fsp.writeFile(dest, mem);
        out(`${green("✓")} wrote ${dest} (${mem.length} bytes)`);
      } else {
        const r = await regenerate(p);
        out(`${green("✓")} exports refreshed: ${s.config.exports.join(", ") || "(none configured)"}${r.files.length ? "" : dim(" (unchanged)")}`);
      }
      return 0;
    }
    case "watch": {
      const interval = Math.max(15, Number(flags.interval || 300));
      const tick = async () => {
        const rep = await syncOnce(p, { pull: true, push: true, imports: true });
        const line = [rep.imported ? `${rep.imported} imported` : "", rep.committed, rep.pushed, rep.pulled].filter(Boolean).join(" · ");
        if (line || !flags.quiet) out(`${dim(new Date().toISOString().slice(11, 19))} ${line || "up to date"}`);
      };
      await tick();
      if (flags.once) return 0;
      out(dim(`watching every ${interval}s (Ctrl+C to stop)`));
      return await new Promise<number>(() => {
        setInterval(() => void tick().catch((e) => process.stderr.write(`watch: ${e?.message || e}\n`)), interval * 1000);
      });
    }
    case "sync": {
      const rep = await syncOnce(p, { pull: flags.pull !== false, push: flags.push !== false, commit: flags.commit !== false, imports: !!flags.import });
      if (flags.quiet) return 0;
      out(`${green("✓")} synced ${p.brainDir}${rep.files.length ? dim(` (${rep.files.map((f) => path.relative(p.root, f) || f).join(", ")} updated)`) : ""}`);
      if (rep.imported) out(`  ${green("import")}  ${rep.imported} session(s)`);
      reportSync(rep);
      return 0;
    }
    case "status":
    case "doctor": {
      const s = await p.brain.snapshot();
      const count = (k: string) => s.entries.filter((e) => e.kind === k).length;
      const ok = (b: boolean, t: string) => out(`  ${b ? green("✓") : yellow("·")} ${t}`);
      const has = (rel: string, needle: string) => {
        const f = path.join(p.root, rel);
        return existsSync(f) && readFileSync(f, "utf8").includes(needle);
      };
      out(`${bold("hamyad")} ${VERSION} · ${bold(s.config.project)} · ${p.root}`);
      ok(existsSync(p.brainDir), `store: ${p.store.kind === "file" ? "single file" : "folder"} ${p.brainDir}${p.store.external ? " (outside the repo: no-GitHub mode)" : ""}${existsSync(p.brainDir) ? "" : " missing (run hamyad init)"}`);
      out(`    ${count("decision")} decisions (${s.entries.filter((e) => e.kind === "decision" && e.status === "superseded").length} superseded) · ${count("task")} tasks (${s.entries.filter((e) => e.kind === "task" && e.status !== "done" && e.status !== "dropped").length} open) · ${count("note")} notes · ${count("context")} context · ${count("session")} sessions · ${count("change")} change sets`);
      out(`    capture: sessions=${s.config.capture.sessions} redact=${s.config.capture.redact} · exports: ${s.config.exports.join(", ") || "none"} · instruction files: ${s.config.instructionFiles.join(", ")}`);
      out(bold("\n  Tools") + dim("            MCP  hooks  context  last session"));
      const last = (src: string) => s.entries.find((e) => e.kind === "session" && e.source === src);
      const row = (label: string, src: string, mcp: boolean | null, hooks: boolean | null, ctx: boolean | null) => {
        const m = (b: boolean | null) => (b === null ? dim(" – ") : b ? green(" ✓ ") : yellow(" · "));
        const l = last(src);
        out(`    ${label.padEnd(14)} ${m(mcp)}  ${m(hooks)}   ${m(ctx)}    ${l ? `${(l.updated || l.created).slice(0, 16).replace("T", " ")} ${dim(l.title.slice(0, 50))}` : dim("never")}`);
      };
      const agents = has("AGENTS.md", "hamyad:begin");
      row("Claude Code", "claude-code", has(".mcp.json", '"hamyad"'), has(".claude/settings.json", "hamyad hook"), has("CLAUDE.md", "hamyad:begin"));
      row("Codex", "codex", has(".codex/config.toml", "mcp_servers.hamyad"), has(".codex/hooks.json", "hamyad hook"), agents);
      row("Gemini CLI", "gemini-cli", has(".gemini/settings.json", '"hamyad"'), has(".gemini/settings.json", "hamyad hook"), agents && has(".gemini/settings.json", "AGENTS.md"));
      row("Cursor", "cursor", has(".cursor/mcp.json", '"hamyad"'), has(".cursor/hooks.json", "hamyad hook"), has(".cursor/rules/hamyad.mdc", "hamyad") || agents);
      row("Copilot", "copilot", has(".vscode/mcp.json", "hamyad") || has(".mcp.json", '"hamyad"'), has(".github/hooks/hamyad.json", "hamyad hook"), agents);
      row("Windsurf", "windsurf", null, has(".devin/hooks.json", "hamyad hook") || has(".windsurf/hooks.json", "hamyad hook"), has(".windsurf/rules/hamyad.md", "hamyad") || agents);
      row("aider", "aider", null, null, has(".aider.conf.yml", "AGENTS.md"));
      row("Zed", "zed", has(".zed/settings.json", '"hamyad"'), null, agents);
      row("Roo / Cline", "roo", has(".roo/mcp.json", '"hamyad"'), null, agents);
      row("JetBrains", "junie", has(".junie/mcp/mcp.json", '"hamyad"'), null, agents);
      const chat = (src: string, label: string) => {
        const l = last(src) || s.entries.find((e) => e.source === src);
        out(`    ${label.padEnd(14)} ${dim("connector")}         ${l ? `${(l.updated || l.created).slice(0, 16).replace("T", " ")} ${dim(l.title.slice(0, 50))}` : dim("never")}`);
      };
      chat("claude-chat", "Claude.ai");
      chat("chatgpt", "ChatGPT");
      chat("gemini-app", "Gemini app");
      chat("grok", "Grok");
      chat("perplexity", "Perplexity");
      out(dim("    chat apps: hamyad connect <chatgpt|claude-ai|gemini-app|grok|perplexity>"));
      out("");
      if (p.isGit) {
        ok(has(path.relative(p.root, path.join(git(p.root, ["rev-parse", "--git-path", "hooks"], { allowFail: true }).out || ".git/hooks", "post-commit")), "hamyad hook git"), "git post-commit trigger");
        const remote = git(p.root, ["remote", "get-url", "origin"], { allowFail: true });
        ok(remote.ok, `git remote: ${remote.ok ? remote.out : "none (sync is local only)"}`);
        if (p.brainInGit) {
          const dirty = git(p.root, ["status", "--porcelain", "-uall", "--", ...brainRel(p)], { allowFail: true }).out;
          ok(!dirty, dirty ? `uncommitted brain changes (${dirty.split("\n").length} files); run hamyad sync` : "brain committed");
        }
        const ahead = git(p.root, ["rev-list", "--count", "@{u}..HEAD"], { allowFail: true });
        if (ahead.ok) ok(ahead.out === "0", ahead.out === "0" ? "in sync with upstream" : `${ahead.out} unpushed commit(s)`);
      } else ok(!p.store.external ? false : true, p.store.external ? "no git: the shared folder/file is the sync medium" : "not a git repository (sync is local only)");
      const errs = path.join(p.stateDir, "hook-errors.log");
      if (existsSync(errs)) ok(false, `hook errors logged in ${errs}`);
      return 0;
    }
    case "absorb": {
      const r = await absorbAutoMemory(p, typeof flags.from === "string" ? flags.from : undefined);
      if (!r.added.length && !r.skipped) out(dim(`no Claude Code auto memory found at ${r.dir}`));
      for (const t of r.added) out(`${green("+")} ${t}`);
      if (r.skipped) out(dim(`${r.skipped} already absorbed`));
      if (r.added.length) await regenerate(p);
      return 0;
    }
    case "connect": {
      const { GUIDES, findGuide, instructionsBlock } = await import("./node/connect.js");
      const remote = p.isGit ? git(p.root, ["remote", "get-url", "origin"], { allowFail: true }).out : "";
      const m = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote);
      const s = await p.brain.snapshot();
      const ctx = {
        root: p.root,
        project: s.config.project,
        repo: m ? m[1] : "OWNER/REPO",
        url: typeof flags.url === "string" ? flags.url.replace(/\/+$/, "") : process.env.HAMYAD_URL || "https://hamyad.<you>.workers.dev",
        memoryFile: p.store.kind === "file" ? p.brainDir : s.config.exports[0] || ".brain/MEMORY.md",
      };
      const which = pos[0];
      if (which === "instructions") return out(instructionsBlock(ctx.project)), 0;
      if (which && which !== "all") {
        const g = findGuide(which);
        if (!g) {
          process.stderr.write(`unknown tool "${which}". Known: ${GUIDES.map((x) => x.id).join(", ")}, instructions\n`);
          return 2;
        }
        out(`${bold(g.name)}  ${dim(g.via.join(" · "))}\n   ${g.steps(ctx)}\n\n${dim("sees: " + g.sees + "\nwrites: " + g.writes)}`);
        return 0;
      }
      out(`${bold("Connect any AI to")} ${bold(ctx.project)}  ${dim("(hamyad connect <tool> for one; --url https://… for your endpoint)")}\n`);
      for (const g of GUIDES) out(`${g.auto ? green("●") : yellow("○")} ${bold(g.name)}  ${dim(g.via.join(" · "))}\n   ${g.steps(ctx)}\n`);
      out(`${bold("Paste into chat-app Project / GPT / Gem instructions:")}\n---\n${instructionsBlock(ctx.project)}\n---`);
      return 0;
    }
    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${HELP}\n`);
      return 2;
  }
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().then(
    (code) => {
      if (code) process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`hamyad: ${err?.message || err}\n`);
      process.exitCode = 1;
    },
  );
}
