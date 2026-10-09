import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cli, gitInit, rm, sh, tmp } from "./helpers.js";
import { approveTools, connectorLinks, mcpUrl, renderConnectors, setup, workerToml } from "../src/node/setup.js";
import { openProject } from "../src/node/project.js";

const posix = process.platform !== "win32";

test("connector links: ready-to-paste URLs and a pre-filled Claude.ai deep link", () => {
  const links = connectorLinks("https://x.trycloudflare.com/", "TOK");
  const claude = links.find((l) => l.id === "claude-ai")!;
  assert.equal(claude.url, "https://x.trycloudflare.com/mcp/TOK?source=claude-chat");
  assert.match(claude.open, /^https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&connectorName=hamyad&connectorUrl=https%3A%2F%2Fx\.trycloudflare\.com%2Fmcp%2FTOK%3Fsource%3Dclaude-chat$/);
  assert.equal(links.find((l) => l.id === "chatgpt")!.url, mcpUrl("https://x.trycloudflare.com", "TOK", "chatgpt"));
  for (const id of ["grok", "perplexity", "gemini-app", "any"]) assert.ok(links.find((l) => l.id === id));
  const txt = renderConnectors("https://x.trycloudflare.com", "TOK");
  assert.match(txt, /openapi\.json/);
  assert.match(txt, /chatgpt\.com\/#settings\/Connectors/);
});

test("approveTools pre-approves Claude Code, Codex and Gemini CLI, idempotently", async () => {
  const dir = tmp();
  const home = tmp("hamyad-home-");
  const saved = { ...process.env };
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, "claude");
    process.env.CODEX_HOME = path.join(home, "codex");
    process.env.GEMINI_CLI_HOME = home;
    mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"), JSON.stringify({ numStartups: 3, projects: {} }));
    mkdirSync(process.env.CODEX_HOME, { recursive: true });
    writeFileSync(path.join(process.env.CODEX_HOME, "config.toml"), 'model = "x"\n');
    const r1 = await approveTools(dir, { all: true });
    await approveTools(dir, { all: true });
    assert.ok(r1.find((r) => r.tool === "Claude Code" && r.ok));
    const local = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.local.json"), "utf8"));
    assert.deepEqual(local.enabledMcpjsonServers, ["hamyad"]);
    const cj = JSON.parse(readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8"));
    assert.equal(cj.numStartups, 3, "keeps the rest of ~/.claude.json");
    const pr = cj.projects[path.resolve(dir)];
    assert.equal(pr.hasTrustDialogAccepted, true);
    assert.deepEqual(pr.enabledMcpjsonServers, ["hamyad"]);
    const toml = readFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "utf8");
    assert.match(toml, /^model = "x"/);
    assert.equal(toml.split(`[projects.${JSON.stringify(path.resolve(dir))}]`).length, 2, "one trust entry after two runs");
    assert.match(toml, /trust_level = "trusted"/);
    const tf = JSON.parse(readFileSync(path.join(home, ".gemini", "trustedFolders.json"), "utf8"));
    assert.equal(tf[path.resolve(dir)], "TRUST_FOLDER");
  } finally {
    for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME"]) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    rm(dir);
    rm(home);
  }
});

test("setup wizard (interactive answers): init, skip approvals, skip chat apps", async () => {
  const dir = tmp();
  try {
    gitInit(dir);
    const asked: string[] = [];
    const answers = ["y", "n", "4"];
    const lines: string[] = [];
    let inited = "";
    const rc = await setup(
      {
        dir,
        ask: async (q, def) => (asked.push(q), answers.shift() ?? def),
        print: (s) => lines.push(s),
        runInit: async (root) => {
          inited = root;
          return cli(root, ["init", "--all"]).code ?? 1;
        },
      },
      async () => ({ close() {} }),
    );
    assert.equal(rc, 0);
    assert.equal(realpathSync.native(inited), realpathSync.native(dir));
    assert.ok(existsSync(path.join(dir, ".brain", "config.json")));
    assert.equal(asked.length, 3);
    assert.match(asked[0], /Set up hamyad/);
    assert.match(asked[1], /Pre-approve/);
    assert.match(asked[2], /Choose \[1-4\]/);
    assert.ok(!existsSync(path.join(dir, ".claude", "settings.local.json")), "approvals were declined");
    assert.match(lines.join("\n"), /Coding tools are wired/);
  } finally {
    rm(dir);
  }
});

test("setup --url: saves the endpoint privately and prints every connector", () => {
  const dir = tmp();
  try {
    gitInit(dir);
    const r = cli(dir, ["setup", "--url", "https://brain.example.com/", "-y", "--init", "--no-approve", "--token", "T0K3N"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /https:\/\/brain\.example\.com\/mcp\/T0K3N\?source=chatgpt/);
    assert.match(r.out, /claude\.ai\/customize\/connectors/);
    assert.match(r.out, /grok\.com\/connectors/);
    assert.match(r.out, /hamyad serve --host 0\.0\.0\.0 --token T0K3N/);
    const p = openProject(dir);
    const saved = JSON.parse(readFileSync(path.join(p.stateDir, "remote.json"), "utf8"));
    assert.equal(saved.url, "https://brain.example.com");
    assert.equal(saved.mode, "url");
    assert.ok(!sh(dir, "git", ["status", "--porcelain"]).includes("remote.json"), "token never lands in the repo");
  } finally {
    rm(dir);
  }
});

test("setup --tunnel: starts the token-protected server, runs cloudflared, prints the public URLs", { skip: !posix }, () => {
  const dir = tmp();
  const bin = tmp("hamyad-bin-");
  try {
    gitInit(dir);
    const probe = path.join(bin, "probe.json");
    const fake = path.join(bin, "cloudflared");
    // a stand-in for cloudflared: checks the local server through the same --url it was given, then reports the tunnel
    writeFileSync(
      fake,
      `#!/bin/sh
url=""; while [ $# -gt 0 ]; do [ "$1" = "--url" ] && url="$2"; shift; done
echo "INF Requesting new quick Tunnel on trycloudflare.com..." >&2
curl -s "$url/openapi.json" > "${probe}"
curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{}' "$url/mcp" > "${probe}.noauth"
echo "INF |  https://fake-words-here.trycloudflare.com  |" >&2
echo "INF Registered tunnel connection connIndex=0 protocol=http2" >&2
exec sleep 30
`,
    );
    chmodSync(fake, 0o755);
    const r = require_cli(dir, ["setup", "--tunnel", "--init", "--no-approve", "--once", "--no-verify", "-p", String(18600 + Math.floor(Math.random() * 300))], { HAMYAD_CLOUDFLARED: fake });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(readFileSync(probe, "utf8"), /"openapi"/, "local server answered before the tunnel came up");
    assert.equal(readFileSync(probe + ".noauth", "utf8"), "401", "server requires the token");
    assert.match(r.out, /Public hamyad endpoint: https:\/\/fake-words-here\.trycloudflare\.com/);
    assert.match(r.out, /https:\/\/fake-words-here\.trycloudflare\.com\/mcp\/[\w-]{20,}\?source=claude-chat/);
    const saved = JSON.parse(readFileSync(path.join(openProject(dir).stateDir, "remote.json"), "utf8"));
    assert.equal(saved.mode, "tunnel");
    // a second run keeps the same token, so only the host part of connector URLs changes
    const r2 = require_cli(dir, ["setup", "--tunnel", "--no-approve", "--once", "--no-verify", "-p", String(18900 + Math.floor(Math.random() * 90))], { HAMYAD_CLOUDFLARED: fake });
    assert.equal(r2.code, 0);
    assert.ok(r2.out.includes(`/mcp/${saved.token}?source=chatgpt`));
  } finally {
    rm(dir);
    rm(bin);
  }
});

test("setup --worker: generates wrangler config, deploys, stores both secrets (fake wrangler)", { skip: !posix }, () => {
  const dir = tmp();
  const bin = tmp("hamyad-bin-");
  try {
    gitInit(dir);
    sh(dir, "git", ["remote", "add", "origin", "https://github.com/acme/Shop.git"]);
    const log = path.join(bin, "calls.log");
    const fake = path.join(bin, "wrangler");
    writeFileSync(
      fake,
      `#!/bin/sh
echo "ARGS $*" >> "${log}"
case "$1" in
  whoami) echo "You are logged in with an OAuth Token";;
  deploy) echo "Uploaded hamyad-shop"; echo "  https://hamyad-shop.acme.workers.dev";;
  secret) read v; echo "SECRET $3=$v" >> "${log}"; echo "Success";;
esac
`,
    );
    chmodSync(fake, 0o755);
    const r = require_cli(dir, ["setup", "--worker", "-y", "--init", "--no-approve", "--no-verify", "--token", "WTOKEN"], { HAMYAD_WRANGLER: fake, GITHUB_TOKEN: "ghp_fake" });
    assert.equal(r.code, 0, r.out + r.err);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /ARGS whoami/);
    assert.match(calls, /ARGS deploy --config .*wrangler\.toml/);
    assert.match(calls, /SECRET HAMYAD_TOKEN=WTOKEN/);
    assert.match(calls, /SECRET GITHUB_TOKEN=ghp_fake/);
    assert.match(r.out, /https:\/\/hamyad-shop\.acme\.workers\.dev\/mcp\/WTOKEN\?source=chatgpt/);
    const cfg = readFileSync(path.join(openProject(dir).stateDir, "worker", "wrangler.toml"), "utf8");
    assert.match(cfg, /name = "hamyad-shop"/);
    assert.match(cfg, /GITHUB_REPO = "acme\/Shop"/);
    assert.match(cfg, /main = ".*dist\/src\/worker\.js"/);
    assert.ok(existsSync(cfg.match(/main = "(.*)"/)![1]), "main points at the installed worker bundle");
  } finally {
    rm(dir);
    rm(bin);
  }
});

test("workerToml escapes values", () => {
  const t = workerToml({ name: "hamyad-x", main: "C:\\a\\b\\worker.js", repo: "o/r", branch: "main", brainDir: ".brain" });
  assert.match(t, /main = "C:\/a\/b\/worker\.js"/);
});

function require_cli(cwd: string, args: string[], env: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return cli(cwd, args);
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
