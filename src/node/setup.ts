/**
 * `hamyad setup`: the interactive wizard behind the one-line installers.
 *
 *   1. make sure the current project has a brain (`hamyad init --all`)
 *   2. optionally pre-approve hamyad in the AI tools installed on this machine
 *   3. give chat apps (ChatGPT, Claude.ai, Grok, Perplexity, Gemini) a public HTTPS URL:
 *        - a Cloudflare quick tunnel (free, no account, lives while the window is open), or
 *        - a Cloudflare Worker over the GitHub repo (permanent, free account), or
 *        - a URL you already have
 *   4. print ready-to-paste connector URLs plus direct links, optionally opening the browser
 */
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, promises as fs, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { findRoot, openProject, Project, resolveStore } from "./project.js";
import { git } from "./git.js";

export type Ask = (question: string, def: string) => Promise<string>;
export type Print = (s: string) => void;

export interface SetupOptions {
  dir?: string;
  mode?: "tunnel" | "worker" | "url" | "none";
  url?: string;
  token?: string;
  yes?: boolean;
  open?: boolean;
  approve?: boolean;
  init?: boolean;
  port?: number;
  /** print the connector block and return instead of keeping the tunnel/server in the foreground */
  once?: boolean;
  verify?: boolean;
  print?: Print;
  ask?: Ask;
  /** run `hamyad init --all` (injected by the CLI to avoid an import cycle) */
  runInit?: (root: string) => Promise<number>;
  color?: boolean;
}

export interface RemoteState {
  mode: "tunnel" | "worker" | "url";
  url: string;
  token: string;
  updated: string;
  worker?: string;
}

// ------------------------------------------------------------------ connector links

export interface ConnectorLink {
  id: string;
  name: string;
  url: string;
  open: string;
  steps: string;
}

export function mcpUrl(base: string, token: string, source: string): string {
  return `${base.replace(/\/+$/, "")}/mcp/${token}?source=${source}`;
}

/** Ready-to-paste connector URLs and the page to open for every chat app. */
export function connectorLinks(base: string, token: string): ConnectorLink[] {
  const u = (s: string) => mcpUrl(base, token, s);
  const b = base.replace(/\/+$/, "");
  return [
    {
      id: "claude-ai",
      name: "Claude.ai (web, Desktop, mobile)",
      url: u("claude-chat"),
      open: `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=hamyad&connectorUrl=${encodeURIComponent(u("claude-chat"))}`,
      steps: "The link opens “Add custom connector” with name and URL pre-filled → Add → in a chat, + → Connectors → enable hamyad.",
    },
    {
      id: "chatgpt",
      name: "ChatGPT (Plus/Pro/Business/Enterprise)",
      url: u("chatgpt"),
      open: "https://chatgpt.com/#settings/Connectors",
      steps: `Settings → Apps → Advanced settings → Developer mode ON → Create app → name hamyad, MCP server URL above, Authentication: No authentication → Create. Without developer mode: Custom GPT → Actions → Import from URL ${b}/openapi.json, API key (Bearer) ${token}.`,
    },
    { id: "grok", name: "Grok", url: u("grok"), open: "https://grok.com/connectors", steps: "New Connector → Custom → paste the URL." },
    { id: "perplexity", name: "Perplexity", url: u("perplexity"), open: "https://www.perplexity.ai/account/connectors", steps: "+ Custom connector → Remote → paste the URL, transport Streamable HTTP, auth None." },
    { id: "gemini-app", name: "Gemini app", url: u("gemini-app"), open: "https://gemini.google.com/app", steps: "Settings & help → Connected Apps → Add a custom app (where offered). Elsewhere: add .brain/MEMORY.md to a Gem." },
    { id: "any", name: "Anything else (REST / OpenAPI)", url: `${b}/openapi.json`, open: `${b}/openapi.json`, steps: `Bearer ${token} on ${b}/api/* ; MCP at ${b}/mcp with the same token.` },
  ];
}

export function renderConnectors(base: string, token: string, o: { color?: boolean } = {}): string {
  const C = o.color;
  const b = (s: string) => (C ? `\x1b[1m${s}\x1b[0m` : s);
  const d = (s: string) => (C ? `\x1b[2m${s}\x1b[0m` : s);
  const g = (s: string) => (C ? `\x1b[32m${s}\x1b[0m` : s);
  const out = [`${g("●")} ${b("Public hamyad endpoint:")} ${base}`, ""];
  for (const l of connectorLinks(base, token)) {
    out.push(b(l.name));
    out.push(`  URL   ${l.url}`);
    out.push(`  open  ${l.open}`);
    out.push(d(`  ${l.steps}`));
    out.push("");
  }
  out.push(d("The token in these URLs is the password to your brain: paste it only into your own chat apps."));
  return out.join("\n");
}

// ------------------------------------------------------------------ small helpers

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function which(cmd: string): string | undefined {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const f = path.join(dir, cmd + e);
      if (existsSync(f)) return f;
    }
  }
  return undefined;
}

export function hamyadHome(): string {
  return process.env.HAMYAD_HOME || path.join(os.homedir(), ".hamyad");
}

export function openBrowser(url: string): boolean {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  try {
    const c = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    c.on("error", () => undefined);
    c.unref();
    return true;
  } catch {
    return false;
  }
}

export function ttyAsk(): Ask {
  return (q, def) =>
    new Promise((resolve) => {
      if (!process.stdin.isTTY) return resolve(def);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`${q} `, (a) => {
        rl.close();
        resolve(a.trim() || def);
      });
    });
}

const yes = (a: string) => /^(y|yes|1|true|بله|آره)$/i.test(a.trim());

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.hamyad-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmp, file);
}

export function remoteFile(p: Project): string {
  return path.join(p.stateDir, "remote.json");
}

export function readRemote(p: Project): RemoteState | undefined {
  try {
    return JSON.parse(readFileSync(remoteFile(p), "utf8"));
  } catch {
    return undefined;
  }
}

async function saveRemote(p: Project, r: RemoteState): Promise<void> {
  await fs.mkdir(p.stateDir, { recursive: true });
  await fs.writeFile(remoteFile(p), JSON.stringify(r, null, 2) + "\n", { mode: 0o600 });
}

// ------------------------------------------------------------------ approvals

export interface ApproveResult {
  tool: string;
  ok: boolean;
  detail: string;
}

/**
 * Pre-approve the project's hamyad MCP server / folder trust in the AI tools on this machine,
 * so the first session does not stop at a trust prompt. Only touches tools that are installed.
 */
export async function approveTools(root: string, o: { all?: boolean } = {}): Promise<ApproveResult[]> {
  const res: ApproveResult[] = [];
  const home = os.homedir();
  const abs = path.resolve(root);

  // Claude Code: project-local approval of .mcp.json servers + folder trust in ~/.claude.json
  const claudeDir = process.env.CLAUDE_CONFIG_DIR;
  const claudeJson = claudeDir ? path.join(claudeDir, ".claude.json") : path.join(home, ".claude.json");
  if (o.all || which("claude") || existsSync(claudeJson)) {
    const local = path.join(abs, ".claude", "settings.local.json");
    const s = (await readJson(local)) || {};
    const list: string[] = Array.isArray(s.enabledMcpjsonServers) ? s.enabledMcpjsonServers : [];
    if (!list.includes("hamyad")) s.enabledMcpjsonServers = [...list, "hamyad"];
    await writeJsonAtomic(local, s);
    let trust = "";
    if (existsSync(claudeJson)) {
      const cj = await readJson(claudeJson);
      if (cj && typeof cj === "object") {
        cj.projects = cj.projects || {};
        const pr = (cj.projects[abs] = cj.projects[abs] || {});
        pr.hasTrustDialogAccepted = true;
        const en: string[] = Array.isArray(pr.enabledMcpjsonServers) ? pr.enabledMcpjsonServers : [];
        if (!en.includes("hamyad")) pr.enabledMcpjsonServers = [...en, "hamyad"];
        await writeJsonAtomic(claudeJson, cj);
        trust = " + folder trusted";
      }
    }
    res.push({ tool: "Claude Code", ok: true, detail: `.claude/settings.local.json enables the hamyad MCP server${trust}` });
  }

  // Codex: trust the project (hooks still need one review in /hooks: Codex pins them by hash)
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  if (o.all || which("codex") || existsSync(codexHome)) {
    const f = path.join(codexHome, "config.toml");
    const cur = existsSync(f) ? await fs.readFile(f, "utf8") : "";
    const head = `[projects.${JSON.stringify(abs)}]`;
    if (!cur.includes(head)) {
      await fs.mkdir(codexHome, { recursive: true });
      await fs.writeFile(f, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\n${head}\ntrust_level = "trusted"\n`);
    }
    res.push({ tool: "Codex", ok: true, detail: "project trusted in ~/.codex/config.toml; approve hamyad's hooks once with /hooks" });
  }

  // Gemini CLI: trusted folder
  const gemDir = path.join(process.env.GEMINI_CLI_HOME || home, ".gemini");
  if (o.all || which("gemini") || existsSync(gemDir)) {
    const f = path.join(gemDir, "trustedFolders.json");
    const t = (await readJson(f)) || {};
    t[abs] = "TRUST_FOLDER";
    await writeJsonAtomic(f, t);
    res.push({ tool: "Gemini CLI", ok: true, detail: "folder trusted in ~/.gemini/trustedFolders.json" });
  }

  // Cursor CLI: local MCP approval list
  const agent = which("cursor-agent") || which("agent");
  if (agent) {
    const r = spawnSync(agent, ["mcp", "enable", "hamyad"], { cwd: abs, encoding: "utf8", timeout: 30000, shell: process.platform === "win32" });
    res.push({ tool: "Cursor CLI", ok: r.status === 0, detail: r.status === 0 ? "`cursor-agent mcp enable hamyad` done" : `cursor-agent mcp enable failed: ${(r.stderr || r.stdout || "").trim().slice(0, 160)}` });
  }
  res.push({ tool: "Cursor / Windsurf / VS Code editors", ok: true, detail: "toggle hamyad on once in the editor's MCP settings (they do not accept pre-approval from files)" });
  return res;
}

// ------------------------------------------------------------------ cloudflared quick tunnel

function cloudflaredAsset(): { name: string; tgz: boolean } | undefined {
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch === "arm" ? "arm" : process.arch === "ia32" ? "386" : undefined;
  if (!arch) return undefined;
  if (process.platform === "linux") return { name: `cloudflared-linux-${arch}`, tgz: false };
  if (process.platform === "darwin") return { name: `cloudflared-darwin-${arch === "arm64" ? "arm64" : "amd64"}.tgz`, tgz: true };
  if (process.platform === "win32") return { name: `cloudflared-windows-${arch === "386" ? "386" : "amd64"}.exe`, tgz: false };
  return undefined;
}

async function download(url: string, dest: string): Promise<void> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`download failed (${r.status}) ${url}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const ws = createWriteStream(tmp);
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!ws.write(value)) await new Promise<void>((res) => ws.once("drain", () => res()));
  }
  await new Promise<void>((res, rej) => ws.end((e?: Error) => (e ? rej(e) : res())));
  await fs.rename(tmp, dest);
}

/** Find cloudflared on PATH or in ~/.hamyad/bin, downloading the official binary if allowed. */
export async function ensureCloudflared(o: { allowDownload: () => Promise<boolean>; print: Print }): Promise<string | undefined> {
  if (process.env.HAMYAD_CLOUDFLARED) return process.env.HAMYAD_CLOUDFLARED;
  const onPath = which("cloudflared");
  if (onPath) return onPath;
  const exe = path.join(hamyadHome(), "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (existsSync(exe)) return exe;
  const a = cloudflaredAsset();
  if (!a || !(await o.allowDownload())) return undefined;
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${a.name}`;
  o.print(`  downloading cloudflared (official Cloudflare release) → ${exe}`);
  if (a.tgz) {
    const tgz = exe + ".tgz";
    await download(url, tgz);
    const r = spawnSync("tar", ["-xzf", tgz, "-C", path.dirname(exe)], { encoding: "utf8" });
    await fs.rm(tgz, { force: true });
    if (r.status !== 0) throw new Error(`could not unpack cloudflared: ${r.stderr}`);
  } else await download(url, exe);
  if (process.platform !== "win32") await fs.chmod(exe, 0o755);
  return exe;
}

export interface Tunnel {
  url: string;
  child: ChildProcess;
  connected: boolean;
  log: string[];
}

/** Start `cloudflared tunnel --url` and resolve once the public trycloudflare.com URL is known. */
export function startQuickTunnel(bin: string, port: number, o: { timeoutMs?: number } = {}): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    // http2 instead of QUIC: works where UDP is blocked or throttled (common on corporate and Iranian networks)
    const child = spawn(bin, ["tunnel", "--no-autoupdate", "--protocol", process.env.HAMYAD_TUNNEL_PROTOCOL || "http2", "--url", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const t: Tunnel = { url: "", child, connected: false, log: [] };
    let done = false;
    const timer = setTimeout(
      () => finish(new Error(t.url ? `got ${t.url} but cloudflared could not connect to Cloudflare's edge (outbound TCP 7844 blocked?)` : "cloudflared did not report a public URL in time")),
      o.timeoutMs ?? Number(process.env.HAMYAD_TUNNEL_TIMEOUT || 60000),
    );
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        child.kill();
        reject(Object.assign(err, { log: t.log }));
      } else resolve(t);
    };
    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        t.log.push(line);
        if (t.log.length > 200) t.log.shift();
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line);
        if (m && !t.url) t.url = m[0];
        if (/Registered tunnel connection/i.test(line)) t.connected = true;
        if (t.url && t.connected) finish();
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("error", (e) => finish(e));
    child.on("exit", (code) => finish(new Error(`cloudflared exited (${code})`)));
  });
}

export function stopTunnel(t: Tunnel): void {
  t.child.stdout?.destroy();
  t.child.stderr?.destroy();
  t.child.kill();
}

/** Poll `<base>/openapi.json` until the public URL answers (DNS for new tunnels takes a few seconds). */
export async function waitReachable(base: string, timeoutMs = 45000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/openapi.json`, { signal: AbortSignal.timeout(8000) });
      if (r.ok && /openapi/i.test(await r.text())) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ------------------------------------------------------------------ Cloudflare Worker via wrangler

function wranglerCmd(): { cmd: string; pre: string[] } {
  if (process.env.HAMYAD_WRANGLER) return { cmd: process.env.HAMYAD_WRANGLER, pre: [] };
  const w = which("wrangler");
  if (w) return { cmd: w, pre: [] };
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", pre: ["--yes", "wrangler@4"] };
}

function wrangler(args: string[], o: { cwd: string; input?: string; inherit?: boolean }) {
  const w = wranglerCmd();
  return spawnSync(w.cmd, [...w.pre, ...args], {
    cwd: o.cwd,
    input: o.input,
    encoding: "utf8",
    stdio: o.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

export function githubRepoOf(root: string): string | undefined {
  const remote = git(root, ["remote", "get-url", "origin"], { allowFail: true }).out;
  const m = /github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?\/?$/.exec(remote || "");
  return m ? m[1] : undefined;
}

export function workerToml(o: { name: string; main: string; repo: string; branch: string; brainDir: string }): string {
  return [
    "# generated by `hamyad setup` (safe to delete; re-run setup to recreate)",
    `name = ${JSON.stringify(o.name)}`,
    `main = ${JSON.stringify(o.main.replace(/\\/g, "/"))}`,
    `compatibility_date = "2026-09-01"`,
    "workers_dev = true",
    "",
    "[vars]",
    `GITHUB_REPO = ${JSON.stringify(o.repo)}`,
    `GITHUB_BRANCH = ${JSON.stringify(o.branch)}`,
    `BRAIN_DIR = ${JSON.stringify(o.brainDir)}`,
    `HAMYAD_SOURCE = "claude-chat"`,
    "",
  ].join("\n");
}

export async function deployWorker(p: Project, token: string, o: { ask: Ask; print: Print; yes: boolean }): Promise<string> {
  const repo = githubRepoOf(p.root);
  if (!repo) throw new Error("the Worker reads and writes the brain through GitHub, but this project has no github.com `origin` remote. Push it to GitHub first, or use the quick tunnel.");
  if (!p.brainInGit) throw new Error("the Worker needs the brain inside the GitHub repo (this project uses an external store); use the quick tunnel instead.");
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22 && !process.env.HAMYAD_WRANGLER) o.print(`  ! wrangler needs Node 22+ (you have ${process.versions.node}); if it fails, re-run the installer to get a newer Node.`);
  const dir = path.join(p.stateDir, "worker");
  await fs.mkdir(dir, { recursive: true });
  const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "worker.js");
  const branch = git(p.root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out || "main";
  const name = `hamyad-${repo.split("/")[1].toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40)}`.replace(/-+$/, "");
  const cfg = path.join(dir, "wrangler.toml");
  await fs.writeFile(cfg, workerToml({ name, main, repo, branch: branch === "HEAD" ? "main" : branch, brainDir: path.relative(p.root, p.brainDir).replace(/\\/g, "/") || ".brain" }));

  o.print("  checking Cloudflare login (wrangler whoami)…");
  const who = wrangler(["whoami"], { cwd: dir });
  if (who.status !== 0 || /not authenticated|You are not logged in/i.test(`${who.stdout}${who.stderr}`)) {
    o.print("  opening the Cloudflare login page in your browser (free account is enough)…");
    const l = wrangler(["login"], { cwd: dir, inherit: true });
    if (l.status !== 0) throw new Error("wrangler login failed or was cancelled");
  }
  o.print(`  deploying Worker ${name} for ${repo}…`);
  const d = wrangler(["deploy", "--config", cfg], { cwd: dir });
  const text = `${d.stdout || ""}\n${d.stderr || ""}`;
  if (d.status !== 0) throw new Error(`wrangler deploy failed:\n${text.trim().slice(-800)}`);
  const m = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(text);
  if (!m) throw new Error(`deployed, but could not find the workers.dev URL in wrangler's output:\n${text.trim().slice(-400)}`);

  const put = (k: string, v: string) => {
    const r = wrangler(["secret", "put", k, "--config", cfg], { cwd: dir, input: v + "\n" });
    if (r.status !== 0) throw new Error(`wrangler secret put ${k} failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  };
  put("HAMYAD_TOKEN", token);

  let gh = process.env.GITHUB_TOKEN || "";
  if (!gh) {
    o.print("  The Worker needs a GitHub token that can write this one repo.");
    o.print(`  Create one (fine-grained → only ${repo} → Contents: Read and write):`);
    o.print("    https://github.com/settings/personal-access-tokens/new");
    const ghCli = which("gh");
    if (ghCli && !o.yes) {
      const a = await o.ask("  …or use your GitHub CLI login token instead? It can access ALL your repos. [y/N]", "n");
      if (yes(a)) gh = spawnSync(ghCli, ["auth", "token"], { encoding: "utf8" }).stdout.trim();
    }
    if (!gh) gh = (await o.ask("  Paste the GitHub token (input is visible; leave empty to set it later):", "")).trim();
  }
  if (gh) put("GITHUB_TOKEN", gh);
  else o.print(`  ! no GitHub token yet: run  npx wrangler secret put GITHUB_TOKEN --config ${cfg}`);
  return m[0];
}

// ------------------------------------------------------------------ the wizard

export async function setup(o: SetupOptions, start: (p: Project, port: number, token: string) => Promise<{ close: () => void }>): Promise<number> {
  const print = o.print || ((s: string) => process.stdout.write(s + "\n"));
  const ask = o.ask || ttyAsk();
  const interactive = !o.yes && (!!o.ask || !!process.stdin.isTTY);
  const q = async (question: string, def: string) => (interactive ? ask(question, def) : def);

  const root = findRoot(path.resolve(o.dir || process.cwd()));
  print(`hamyad setup · project: ${root}`);

  // 1. brain
  const store = resolveStore(root);
  if (!existsSync(store.path)) {
    const go = o.init ?? yes(await q(`No hamyad brain here yet. Set up hamyad for every AI tool in ${root}? [Y/n]`, "y"));
    if (!go) {
      print("Nothing to do. cd into your project and run  hamyad setup  again.");
      return 1;
    }
    if (!o.runInit) throw new Error("runInit missing");
    const rc = await o.runInit(root);
    if (rc !== 0) return rc;
  } else print("✓ brain found: " + store.path);
  const p = openProject(root, "cli", { autoRegenerate: true });

  // 2. approvals
  const approve = o.approve ?? yes(await q("Pre-approve hamyad in the AI tools installed here (Claude Code, Codex, Gemini CLI, Cursor CLI) so the first session doesn't stop at a trust prompt? [Y/n]", "y"));
  if (approve) {
    for (const r of await approveTools(root)) print(`  ${r.ok ? "✓" : "!"} ${r.tool}: ${r.detail}`);
  }

  // 3. public URL for chat apps
  const prev = readRemote(p);
  let mode = o.mode;
  if (!mode && !interactive) {
    // unattended runs never start a long-running tunnel or a deploy on their own
    print("\n  chat apps: skipped (pass --tunnel, --worker or --url <https://...> to connect them without questions)");
    mode = "none";
  }
  if (!mode) {
    print("");
    print("Chat apps (ChatGPT, Claude.ai, Grok, Perplexity, Gemini) run in the cloud and need a public HTTPS URL:");
    print("  1) Quick tunnel   free, no account, works while this window stays open (URL changes each run)");
    print("  2) Cloudflare Worker   permanent free URL; needs a free Cloudflare account and this repo on GitHub");
    print("  3) I already have a URL");
    print("  4) Skip: coding tools only");
    const a = (await q(`Choose [1-4] (default ${prev?.mode === "worker" ? "2" : "1"}):`, prev?.mode === "worker" ? "2" : "1")).trim();
    mode = (({ "1": "tunnel", "2": "worker", "3": "url", "4": "none" } as const)[a as "1"] || "tunnel") as SetupOptions["mode"];
  }
  if (mode === "none") {
    print("\n✓ Done. Coding tools are wired; run  hamyad setup  again any time to connect chat apps.");
    return 0;
  }
  const token = o.token || prev?.token || newToken();
  const openIt = async (base: string) => {
    print("");
    print(renderConnectors(base, token, { color: o.color }));
    const want = o.open ?? (interactive ? yes(await ask("\nOpen the Claude.ai and ChatGPT connector pages in your browser now? [y/N]", "n")) : false);
    if (want) for (const l of connectorLinks(base, token).slice(0, 2)) openBrowser(l.open);
  };

  if (mode === "url") {
    const url = (o.url || (await q("Public base URL (e.g. https://hamyad.example.com):", prev?.url || ""))).trim().replace(/\/+$/, "");
    if (!/^https:\/\//.test(url)) {
      print("A public https:// URL is required.");
      return 2;
    }
    await saveRemote(p, { mode: "url", url, token, updated: new Date().toISOString() });
    print(`\nRun the server behind it with:  hamyad serve --host 0.0.0.0 --token ${token}`);
    await openIt(url);
    return 0;
  }

  if (mode === "worker") {
    try {
      const url = await deployWorker(p, token, { ask, print, yes: !!o.yes });
      await saveRemote(p, { mode: "worker", url, token, updated: new Date().toISOString(), worker: url });
      if (o.verify !== false) print((await waitReachable(url, 30000)) ? `  ✓ ${url} answers` : `  ! ${url} is not answering yet; give Cloudflare a minute`);
      await openIt(url);
      return 0;
    } catch (e: any) {
      print(`\n! Worker setup stopped: ${e.message}`);
      if (o.yes || !yes(await q("Use a quick tunnel instead? [Y/n]", "y"))) return 1;
      mode = "tunnel";
    }
  }

  // tunnel
  const bin = await ensureCloudflared({ allowDownload: async () => !!o.yes || yes(await q("cloudflared (Cloudflare's free tunnel client, ~40 MB) is needed. Download the official binary now? [Y/n]", "y")), print });
  if (!bin) {
    print("cloudflared is not available. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and re-run  hamyad setup.");
    return 1;
  }
  const port = o.port || Number(process.env.HAMYAD_PORT || 8787);
  const server = await start(p, port, token);
  print(`  local server: http://127.0.0.1:${port}/mcp (token required)`);
  print("  starting Cloudflare quick tunnel…");
  let t: Tunnel;
  try {
    t = await startQuickTunnel(bin, port);
  } catch (e: any) {
    server.close();
    print(`! tunnel failed: ${e.message}`);
    for (const l of (e.log || []).slice(-6)) print(`    ${l}`);
    print("  Outbound port 7844 to Cloudflare may be blocked here. Use the Worker option (hamyad setup → 2) instead.");
    return 1;
  }
  await saveRemote(p, { mode: "tunnel", url: t.url, token, updated: new Date().toISOString() });
  if (o.verify !== false) print((await waitReachable(t.url)) ? `  ✓ ${t.url} answers through the tunnel` : `  ! ${t.url} does not answer yet (DNS can take a minute)`);
  await openIt(t.url);
  if (o.once) {
    stopTunnel(t);
    server.close();
    return 0;
  }
  print("\nKeep this window open while you use chat apps. Ctrl+C stops the tunnel.");
  print("Next time the URL will be different: re-run  hamyad setup --tunnel  and update the connector, or choose the Worker for a permanent URL.");
  return await new Promise<number>((resolve) => {
    const stop = () => {
      stopTunnel(t);
      server.close();
      resolve(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    t.child.once("exit", (code) => {
      print(`cloudflared exited (${code}).`);
      server.close();
      resolve(1);
    });
  });
}
