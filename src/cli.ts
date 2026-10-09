#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Brain } from "./core/brain.js";
import { isKind, KINDS } from "./core/entry.js";
import { renderBrief } from "./core/render.js";
import { GitHubBackend } from "./backends/github.js";
import { McpServer, INSTRUCTIONS } from "./mcp/server.js";
import { runStdio } from "./mcp/stdio.js";
import { serveHttp } from "./node/serve.js";
import { init } from "./node/init.js";
import { openProject, regenerate } from "./node/project.js";
import { commitBrain, git, pullFastForward, pushBrain, SyncReport } from "./node/git.js";
import { hookSessionEnd, hookSessionStart, readStdin } from "./node/hooks.js";
import { absorbAutoMemory } from "./node/absorb.js";
import { VERSION } from "./version.js";

type Flags = Record<string, string | boolean>;

export function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  const short: Record<string, string> = { m: "body", t: "tags", s: "status", n: "limit", k: "kind", p: "port", d: "dir", h: "help", v: "version" };
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
      const boolish = ["help", "version", "json", "dry-run", "git", "all"];
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

const HELP = `${bold("hamyad")} ${VERSION} · one shared project brain for Claude Code, Claude.ai chat, Claude Desktop and GitHub

${bold("Usage")}
  hamyad init [--project NAME] [--no-hooks] [--no-mcp] [--no-claude-md]
  hamyad status                         brain + git + integration health
  hamyad sync [--no-pull] [--no-push]   pull, regenerate CLAUDE.md/BRAIN.md, commit .brain/, push
  hamyad add <decision|task|note|context> "title" [-m body] [-t tag1,tag2] [-s status]
  hamyad list [kind] [-s status] [--tag T] [-n 20]
  hamyad search "query" [-k kind]
  hamyad show <id>
  hamyad done <id> [-m note]            mark a task done
  hamyad update <id> [-s status] [--append text] [--title T]
  hamyad context [--chars 6000]         print the brief Claude sees
  hamyad absorb [--from DIR]            import Claude Code auto memory into the shared brain
  hamyad connect                        print setup for claude.ai, Claude Desktop and Project instructions
  hamyad mcp [--source NAME]            MCP server over stdio (Claude Code / Claude Desktop)
  hamyad serve [-p 8787] [--host 127.0.0.1] [--token T] [--github owner/repo [--branch main]] [--git]
                                        MCP Streamable HTTP server (claude.ai custom connector)
  hamyad hook session-start|session-end Claude Code hooks (reads hook JSON on stdin)

${bold("Global")}  -d, --dir PATH   project root (default: nearest folder with .brain/ or git root)

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

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  const dir = typeof flags.dir === "string" ? flags.dir : undefined;
  if (flags.version || cmd === "version") return out(VERSION), 0;
  if (!cmd || flags.help || cmd === "help") return out(HELP), 0;

  switch (cmd) {
    case "init": {
      const root = path.resolve(dir || process.cwd());
      const { project, created } = await init(root, {
        project: typeof flags.project === "string" ? flags.project : undefined,
        hooks: flags.hooks !== false,
        mcp: flags.mcp !== false,
        claudeMd: flags["claude-md"] !== false,
        command: typeof flags.command === "string" ? flags.command : undefined,
      });
      out(`${green("✓")} hamyad brain ready in ${project.brainDir}`);
      for (const c of created) out(`  + ${c}`);
      out(`\nNext:\n  1. git add .brain .mcp.json .claude/settings.json CLAUDE.md && git commit -m "Add hamyad brain"\n  2. ${bold("hamyad connect")} to wire up Claude.ai chat and Claude Desktop`);
      return 0;
    }
    case "mcp": {
      const source = typeof flags.source === "string" ? flags.source : process.env.HAMYAD_SOURCE || "claude-code";
      const p = openProject(dir, source);
      await runStdio(new McpServer(p.brain, { source }));
      return 0;
    }
    case "serve": {
      const port = Number(flags.port || process.env.PORT || 8787);
      const host = typeof flags.host === "string" ? flags.host : process.env.HOST || "127.0.0.1";
      const token = typeof flags.token === "string" ? flags.token : process.env.HAMYAD_TOKEN;
      const source = typeof flags.source === "string" ? flags.source : "claude-chat";
      let brain: Brain;
      let label: string;
      if (typeof flags.github === "string" || process.env.GITHUB_REPO) {
        const repo = (typeof flags.github === "string" ? flags.github : process.env.GITHUB_REPO)!;
        const backend = new GitHubBackend({
          repo,
          token: process.env.GITHUB_TOKEN || "",
          branch: typeof flags.branch === "string" ? flags.branch : process.env.GITHUB_BRANCH,
        });
        brain = new Brain(backend, { source });
        label = backend.label;
      } else {
        const p = openProject(dir, source);
        brain = p.brain;
        label = `fs:${p.brainDir}`;
        if (flags.git) {
          const { FsBackend } = await import("./backends/fs.js");
          brain = new Brain(
            new FsBackend(p.brainDir, (_abs, message) => {
              const rep: SyncReport = { skipped: [] };
              commitBrain(p.root, path.relative(p.root, p.brainDir), message, rep);
              pushBrain(p.root, rep);
            }),
            { source },
          );
        }
      }
      if (!token && host !== "127.0.0.1" && host !== "localhost") {
        process.stderr.write("refusing to listen on a public interface without --token / HAMYAD_TOKEN\n");
        return 2;
      }
      await serveHttp(() => new McpServer(brain, { source }), { port, host, token, label });
      process.stderr.write(`hamyad MCP (Streamable HTTP) on http://${host}:${port}/mcp  store=${label}  auth=${token ? "token" : "none"}\n`);
      return await new Promise<number>(() => {});
    }
    case "hook": {
      const which = pos[0];
      const input = await readStdin();
      try {
        const p = openProject(input.cwd || dir);
        const { existsSync } = await import("node:fs");
        if (!existsSync(p.brainDir)) return 0; // not a hamyad project: do nothing
        if (which === "session-start") {
          const { output } = await hookSessionStart(p, input);
          out(JSON.stringify(output));
        } else if (which === "session-end" || which === "stop") {
          const { entry, report } = await hookSessionEnd(p, input);
          process.stderr.write(`[hamyad] ${entry ? `logged session ${entry.id}` : "no session logged"}; ${[report.committed, report.pushed, ...report.skipped].filter(Boolean).join("; ")}\n`);
        } else {
          process.stderr.write(`unknown hook "${which}" (use session-start or session-end)\n`);
        }
      } catch (err: any) {
        // Hooks must never break a Claude Code session.
        process.stderr.write(`[hamyad] hook error: ${err?.message || err}\n`);
      }
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
      const e = await p.brain.add({
        kind,
        title: pos.join(" "),
        body: typeof flags.body === "string" ? flags.body : undefined,
        tags: typeof flags.tags === "string" ? flags.tags.split(",") : undefined,
        status: typeof flags.status === "string" ? flags.status : undefined,
      });
      await regenerate(p);
      out(`${green("✓")} ${e.kind} ${bold(e.id)} ${e.title}  ${dim(".brain/" + e.path)}`);
      return 0;
    }
    case "list":
    case "ls": {
      const kind = pos[0] && isKind(pos[0]) ? pos[0] : undefined;
      const list = await p.brain.list({
        kind,
        status: typeof flags.status === "string" ? flags.status : undefined,
        tag: typeof flags.tag === "string" ? flags.tag : undefined,
        limit: Number(flags.limit || 30),
      });
      if (flags.json) return out(JSON.stringify(list, null, 2)), 0;
      if (!list.length) out(dim("(empty)"));
      for (const e of list)
        out(`${dim((e.updated || e.created).slice(0, 10))} ${e.kind.padEnd(8)} ${bold(e.id)} ${e.status ? `[${e.status}] ` : ""}${e.title} ${dim(e.source)}`);
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
      out(`${bold(e.title)}\n${dim(`${e.id} · ${e.kind}${e.status ? ` · ${e.status}` : ""} · ${e.source} · ${e.updated}`)}\n\n${e.body}`);
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
      out(renderBrief(s.config, s.entries, { maxChars: Number(flags.chars || s.config.briefChars) }));
      return 0;
    }
    case "sync": {
      const s = await p.brain.snapshot();
      const rep: SyncReport = { skipped: [] };
      if (p.isGit && flags.pull !== false && s.config.git.pull) pullFastForward(p.root, rep);
      const changed = await regenerate(p);
      if (p.isGit && flags.commit !== false) {
        commitBrain(p.root, path.relative(p.root, p.brainDir), "brain: sync [cli]", rep);
        if (flags.push !== false && s.config.git.push) pushBrain(p.root, rep);
      }
      out(`${green("✓")} synced ${p.brainDir}${changed.claudeMd ? " (CLAUDE.md updated)" : ""}`);
      reportSync(rep);
      return 0;
    }
    case "status":
    case "doctor": {
      const { existsSync, readFileSync } = await import("node:fs");
      const s = await p.brain.snapshot();
      const count = (k: string) => s.entries.filter((e) => e.kind === k).length;
      const ok = (b: boolean, t: string) => out(`  ${b ? green("✓") : yellow("·")} ${t}`);
      out(`${bold("hamyad")} ${VERSION} · ${bold(s.config.project)} · ${p.root}`);
      ok(existsSync(p.brainDir), `.brain/ ${existsSync(p.brainDir) ? "" : "missing (run hamyad init)"}`);
      out(`    ${count("decision")} decisions · ${count("task")} tasks (${s.entries.filter((e) => e.kind === "task" && e.status !== "done" && e.status !== "dropped").length} open) · ${count("note")} notes · ${count("context")} context · ${count("session")} sessions`);
      const mcp = path.join(p.root, ".mcp.json");
      ok(existsSync(mcp) && readFileSync(mcp, "utf8").includes('"hamyad"'), "Claude Code MCP server in .mcp.json");
      const st = path.join(p.root, ".claude", "settings.json");
      ok(existsSync(st) && readFileSync(st, "utf8").includes("hook session-start"), "Claude Code hooks in .claude/settings.json");
      const cm = path.join(p.root, "CLAUDE.md");
      ok(existsSync(cm) && readFileSync(cm, "utf8").includes("hamyad:begin"), "CLAUDE.md brain block");
      if (p.isGit) {
        const remote = git(p.root, ["remote", "get-url", "origin"], { allowFail: true });
        ok(remote.ok, `git remote: ${remote.ok ? remote.out : "none (GitHub sync disabled)"}`);
        const dirty = git(p.root, ["status", "--porcelain", "-uall", "--", ".brain"], { allowFail: true }).out;
        ok(!dirty, dirty ? `uncommitted brain changes (${dirty.split("\n").length} files); run hamyad sync` : "brain committed");
        const ahead = git(p.root, ["rev-list", "--count", "@{u}..HEAD"], { allowFail: true });
        if (ahead.ok) ok(ahead.out === "0", ahead.out === "0" ? "in sync with upstream" : `${ahead.out} unpushed commit(s)`);
      } else ok(false, "not a git repository (GitHub sync disabled)");
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
      const remote = p.isGit ? git(p.root, ["remote", "get-url", "origin"], { allowFail: true }).out : "";
      const m = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote);
      const repo = m ? m[1] : "OWNER/REPO";
      const s = await p.brain.snapshot();
      out(`${bold("1. Claude Code")}  already wired by ${bold("hamyad init")} (.mcp.json + hooks). Approve the "hamyad" server on first run.

${bold("2. Claude Desktop")} (local, same files): Settings → Developer → Edit Config, add:
${JSON.stringify({ mcpServers: { hamyad: { command: "hamyad", args: ["mcp", "--dir", p.root, "--source", "claude-desktop"] } } }, null, 2)}

${bold("3. Claude.ai chat")} (web, mobile, Desktop chat) via a remote MCP connector backed by GitHub:
   a. Deploy the Worker (free tier):  cd node_modules/hamyad/worker  (or the repo's worker/ folder)
        npx wrangler deploy
        npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: Contents read/write on ${repo} only
        npx wrangler secret put HAMYAD_TOKEN   # any long random string
        set GITHUB_REPO = "${repo}" in wrangler.toml
   b. claude.ai → Customize → Connectors → Add custom connector
        URL: https://hamyad.<your-subdomain>.workers.dev/mcp/<HAMYAD_TOKEN>
        (or URL .../mcp with request header  Authorization: Bearer <HAMYAD_TOKEN>)
   c. Enable the connector in your Project's chats.

${bold("4. Claude.ai Project")} → Custom instructions, paste:
---
This project ("${s.config.project}") has a shared brain exposed by the hamyad connector.
${INSTRUCTIONS}
---
   Optional read-only path: Project knowledge → + → GitHub → ${repo} → select .brain/BRAIN.md (press Sync now to refresh).`);
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
