#!/usr/bin/env python3
"""End-to-end: real agent CLIs (Claude Code, Codex, Gemini CLI, Copilot CLI, aider) against a
scripted mock model server, all sharing one hamyad brain.

    MOCK_DIR=/tmp/mock python3 mock.py &      # in this folder
    python3 run.py [claude codex gemini copilot aider]

Checks, per tool: hooks fire, the session + change set are captured and attributed, the
hamyad MCP tools are offered to the model, and after a decision is superseded from a
"ChatGPT" connector call, the next session's model input contains the
"DECISIONS CHANGED" block. No real accounts or network needed.
"""
import json, os, shutil, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CLI = os.path.join(REPO, "dist", "src", "cli.js")
MOCK = os.environ.get("MOCK_DIR", "/tmp/mock")
URL = "http://127.0.0.1:" + os.environ.get("MOCK_PORT", "18800")
W = os.environ.get("E2E_DIR", "/tmp/hamyad-e2e")
R = os.path.join(W, "repo")
BIN = os.path.join(W, "bin")
TOOLS = sys.argv[1:] or ["claude", "codex", "gemini", "copilot", "aider"]

ENV = dict(os.environ)
ENV["PATH"] = os.pathsep.join([BIN, os.path.expanduser("~/.local/bin"), ENV.get("PATH", "")])
for k in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"): ENV[k] = "dev"
for k in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"): ENV[k] = "dev@example.com"
for k in [k for k in ENV if k.startswith(("CURSOR_", "CLAUDE_CODE_", "CODEX_", "COPILOT_"))]: ENV.pop(k)
ENV.pop("CLAUDECODE", None)

RESULTS = []
def ok(cond, label):
    print(("PASS " if cond else "FAIL ") + label, flush=True)
    RESULTS.append((label, bool(cond)))

def sh(cmd, cwd=R, env=None, timeout=240, quiet=True):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), cwd=cwd, env=env or ENV, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    if not quiet or r.returncode:
        out = (r.stdout + r.stderr).strip()
        if out: print("   " + out[-1500:].replace("\n", "\n   "))
    return r

def script(steps): json.dump(steps, open(f"{MOCK}/script.json", "w"))
def clear_log(): open(f"{MOCK}/log.jsonl", "w").close()
def log(): return [json.loads(l) for l in open(f"{MOCK}/log.jsonl") if l.strip()]
def main_reqs(): return [e for e in log() if e.get("main")]
def blob(reqs): return "\n".join(json.dumps(e.get("body")) for e in reqs)

def hamyad(*args, env=None):
    return sh(["hamyad", *args], env=env)

def entries():
    return json.loads(hamyad("list", "-n", "500", "--json").stdout or "[]")

def wait_push(n_before, secs=15):
    for _ in range(secs * 4):
        c = int(sh(["git", "--git-dir", os.path.join(W, "remote.git"), "rev-list", "--count", "main"]).stdout.strip() or 0)
        if c > n_before: return c
        time.sleep(0.25)
    return n_before

# ------------------------------------------------------------------ setup
shutil.rmtree(W, ignore_errors=True)
os.makedirs(BIN)
with open(os.path.join(BIN, "hamyad"), "w") as f:
    f.write(f'#!/bin/sh\nexec "{sys.executable and shutil.which("node")}" "{CLI}" "$@"\n')
os.chmod(os.path.join(BIN, "hamyad"), 0o755)
sh(["git", "init", "-q", "--bare", "-b", "main", os.path.join(W, "remote.git")], cwd=W)
os.makedirs(R)
sh("git init -qb main && printf 'print(\"v1\")\\n' > app.py && git add . && git commit -qm 'initial app'")
sh(["git", "remote", "add", "origin", os.path.join(W, "remote.git")])
r = hamyad("init", "--all", "--project", "e2e-shop")
print(r.stdout)
ok(r.returncode == 0, "hamyad init --all")
hamyad("add", "decision", "Use Flask for the API", "-m", "simple to start", "-t", "api", "--source", "claude-chat")
sh("git add -A && git commit -qm 'add hamyad brain' && git push -qu origin main")

HOMES = {t: os.path.join(W, f"{t}-home") for t in TOOLS}
def tool_env(t):
    h = HOMES[t]
    os.makedirs(h, exist_ok=True)
    if t == "claude":
        if not os.path.exists(f"{h}/.claude.json"):
            json.dump({"projects": {R: {"hasTrustDialogAccepted": True, "enabledMcpjsonServers": ["hamyad"], "hasCompletedProjectOnboarding": True}}}, open(f"{h}/.claude.json", "w"))
            json.dump({"enableAllProjectMcpServers": True}, open(f"{h}/settings.json", "w"))
        return dict(ENV, CLAUDE_CONFIG_DIR=h, ANTHROPIC_BASE_URL=URL, ANTHROPIC_API_KEY="sk-ant-dummy", DISABLE_AUTOUPDATER="1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")
    if t == "codex":
        open(f"{h}/config.toml", "w").write(f'model = "mock"\nmodel_provider = "mock"\n[model_providers.mock]\nname = "mock"\nbase_url = "{URL}/v1"\nenv_key = "MOCK_API_KEY"\nwire_api = "responses"\n\n[projects."{R}"]\ntrust_level = "trusted"\n')
        return dict(ENV, CODEX_HOME=h, MOCK_API_KEY="x")
    if t == "gemini":
        os.makedirs(f"{h}/.gemini", exist_ok=True)
        json.dump({"security": {"auth": {"selectedType": "gemini-api-key"}}}, open(f"{h}/.gemini/settings.json", "w"))
        json.dump({R: "TRUST_FOLDER"}, open(f"{h}/.gemini/trustedFolders.json", "w"))
        return dict(ENV, GEMINI_CLI_HOME=h, GOOGLE_GEMINI_BASE_URL=URL, GEMINI_API_KEY="x")
    if t == "copilot":
        return dict(ENV, COPILOT_HOME=h, COPILOT_PROVIDER_BASE_URL=f"{URL}/v1", COPILOT_PROVIDER_API_KEY="x", COPILOT_OFFLINE="true", COPILOT_MODEL="gpt-4.1", COPILOT_ALLOW_ALL="true", COPILOT_AUTO_UPDATE="false")
    if t == "aider":
        return dict(ENV, OPENAI_API_BASE=f"{URL}/v1", OPENAI_API_KEY="x", AIDER_CHECK_UPDATE="false", AIDER_ANALYTICS="false")
    return ENV

def run_tool(t, prompt, steps, edit_file=None):
    E = tool_env(t)
    script(steps)
    clear_log()
    if t == "claude":
        r = sh(["claude", "-p", prompt, "--permission-mode", "acceptEdits", "--model", "claude-sonnet-4-5"], env=E)
    elif t == "codex":
        r = sh(["codex", "exec", "--dangerously-bypass-hook-trust", "-s", "workspace-write", prompt], env=E)
    elif t == "gemini":
        r = sh(["gemini", "-p", prompt, "--yolo", "-m", "gemini-2.5-pro"], env=E)
    elif t == "copilot":
        r = sh(["copilot", "-p", prompt, "--allow-all-tools"], env=E)
    elif t == "aider":
        args = ["aider", "--model", "openai/mock", "--yes-always", "--no-stream", "--no-show-model-warnings", "--no-auto-commits", "--no-gitignore", "--message", prompt]
        if edit_file: args.append(edit_file)
        r = sh(args, env=E)
    time.sleep(1.0)  # Gemini/Codex end hooks run detached or after exit
    return r

EDIT = {
    "claude": lambda f, c: {"tool": "Write", "input": {"file_path": f"{R}/{f}", "content": c}},
    "codex": lambda f, c: {"tool": "exec_command", "input": {"cmd": f"printf '%s' '{c}' > {f}"}},
    "gemini": lambda f, c: {"tool": "write_file", "input": {"file_path": f"{R}/{f}", "content": c}},
    "copilot": lambda f, c: {"tool": "create", "input": {"path": f"{R}/{f}", "file_text": c}},
}
SRC = {"claude": "claude-code", "codex": "codex", "gemini": "gemini-cli", "copilot": "copilot", "aider": "aider"}
MCP_TOOLS = {}

# ------------------------------------------------------------------ round 1: each agent edits code
for t in [x for x in TOOLS if x != "aider"]:
    f = f"{t}_feature.py"
    print(f"\n== {t}: session 1 (edits {f})")
    r = run_tool(t, f"add {f} please", [EDIT[t](f, f"# by {t}\\n"), {"text": f"Added {f}."}])
    reqs = main_reqs()
    ok(os.path.exists(os.path.join(R, f)), f"{t}: agent wrote {f} through the mock model")
    first = blob(reqs[:1])
    ok("Use Flask for the API" in first, f"{t}: the shared brief (CLAUDE.md/AGENTS.md/hook context) reached the model")
    names = set(n for e in reqs for n in e.get("tools", []))
    MCP_TOOLS[t] = sorted(n for n in names if "brain" in n or "hamyad" in n)
    # Codex groups an MCP server's tools under one namespace tool ("mcp__hamyad")
    ok(any("brain_remember" in n or n == "mcp__hamyad" for n in names), f"{t}: hamyad MCP tools offered to the model ({', '.join(MCP_TOOLS[t][:3]) or 'none'})")
    es = entries()
    sess = [e for e in es if e["kind"] == "session" and e["source"] == SRC[t]]
    chg = [e for e in es if e["kind"] == "change" and e["source"] == SRC[t]]
    ok(sess and f"add {f}" in sess[0]["body"], f"{t}: session captured and attributed to {SRC[t]}")
    ok(chg and f in chg[0]["body"], f"{t}: change set captured ({chg[0]['title'] if chg else 'missing'})")

if "aider" in TOOLS:
    print("\n== aider: session 1")
    open(os.path.join(R, "aider_feature.py"), "w").write("x = 1\n")
    sh("git add aider_feature.py && git commit -qm 'aider target'")
    r = run_tool("aider", "rename x to y in aider_feature.py", [{"text": "aider_feature.py\n```python\ny = 1\n```\n"}, {"text": "aider_feature.py\n```python\ny = 1\n```\n"}], "aider_feature.py")
    ok("y = 1" in open(os.path.join(R, "aider_feature.py")).read(), "aider: edited through the mock model")
    ok("Use Flask for the API" in blob(log()), "aider: AGENTS.md (read: in .aider.conf.yml) reached the model")
    sh("git add aider_feature.py && git commit -qm 'aider: rename x to y'")  # post-commit hook imports the chat
    es = entries()
    ok(any(e["kind"] == "session" and e["source"] == "aider" for e in es), "aider: chat imported by the git post-commit trigger")

# ------------------------------------------------------------------ a decision changes in a chat app (ChatGPT connector -> hamyad serve)
print("\n== ChatGPT connector supersedes a decision over MCP HTTP")
srv = subprocess.Popen(["hamyad", "serve", "-p", "18901", "--token", "t0k"], cwd=R, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
flask = [e for e in entries() if e["title"] == "Use Flask for the API"][0]["id"]
def rpc(body):
    req = urllib.request.Request("http://127.0.0.1:18901/mcp?source=chatgpt", data=json.dumps(body).encode(), headers={"content-type": "application/json", "accept": "application/json, text/event-stream", "authorization": "Bearer t0k", "user-agent": "openai-mcp/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())
rpc({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "openai-mcp", "version": "1"}}})
res = rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "brain_remember", "arguments": {"kind": "decision", "title": "Use FastAPI for the API", "body": "async + OpenAPI; decided with the team in ChatGPT", "tags": ["api"], "supersedes": [flask]}}})
srv.terminate()
txt = res["result"]["content"][0]["text"]
ok("Marked superseded" in txt, "chatgpt: brain_remember with supersedes marks the Flask decision superseded")
es = {e["id"]: e for e in entries()}
ok(es[flask]["status"] == "superseded", "brain: old decision status = superseded")
ok(any(e["title"] == "Use FastAPI for the API" and e["source"] == "chatgpt" for e in es.values()), "brain: new decision attributed to chatgpt")
ok("Use FastAPI for the API" in open(os.path.join(R, ".brain", "MEMORY.md")).read(), "MEMORY.md export refreshed after the connector write")
hamyad("sync", "--quiet")

# ------------------------------------------------------------------ round 2: every agent is told at session start
for t in [x for x in TOOLS if x != "aider"]:
    print(f"\n== {t}: session 2 (must see the changed decision)")
    run_tool(t, "what framework do we use?", [{"text": "FastAPI."}])
    b = blob(log())
    ok("DECISIONS CHANGED" in b and "Use FastAPI for the API" in b, f"{t}: 'DECISIONS CHANGED … Use FastAPI' reached the model at session start")
    ok("REPLACED" in b and "Use Flask for the API" in b, f"{t}: the superseded Flask decision is flagged as replaced")

# ------------------------------------------------------------------ cross-tool views
print("\n== timeline / status / push")
tl = hamyad("timeline", "-n", "80").stdout
print(tl)
for t in TOOLS:
    label = {"claude": "Claude Code", "codex": "Codex", "gemini": "Gemini CLI", "copilot": "Copilot", "aider": "aider"}[t]
    ok(label in tl, f"timeline shows {label}")
ok("ChatGPT" in tl and "→ Use FastAPI" in tl, "timeline shows the ChatGPT supersession")
st = hamyad("status").stdout
print(st)
remote_log = sh(["git", "--git-dir", os.path.join(W, "remote.git"), "log", "--format=%s", "main"]).stdout
ok("brain: session summary" in remote_log, "brain commits reached the remote (background push from end hooks)")

# ------------------------------------------------------------------ the CLIs parse the generated MCP configs
print("\n== MCP config parsing by each CLI")
if "claude" in TOOLS:
    o = sh(["claude", "mcp", "list"], env=tool_env("claude")); ok("hamyad" in o.stdout, "claude mcp list shows hamyad (.mcp.json)")
if "codex" in TOOLS:
    o = sh(["codex", "mcp", "list"], env=tool_env("codex")); ok("hamyad" in o.stdout, "codex mcp list shows hamyad (.codex/config.toml)")
if "gemini" in TOOLS:
    o = sh(["gemini", "mcp", "list"], env=tool_env("gemini")); ok("hamyad" in o.stdout + o.stderr, "gemini mcp list shows hamyad (.gemini/settings.json)")
if shutil.which("cursor-agent"):
    o = sh(["cursor-agent", "mcp", "list"], env=dict(ENV, HOME=os.path.join(W, "cursor-home")), timeout=60)
    print("   cursor-agent mcp list ->", (o.stdout + o.stderr).strip()[:300])

fails = [l for l, c in RESULTS if not c]
print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} checks passed")
for l in fails: print("  FAIL", l)
json.dump({"tools": TOOLS, "results": RESULTS, "mcp_tools": MCP_TOOLS}, open(os.path.join(W, "results.json"), "w"), indent=1)
sys.exit(1 if fails else 0)
