<div align="center">

# hamyad · هم‌یاد

**One shared brain for every AI you use on a project.**
ChatGPT · Claude (Code, Desktop, claude.ai) · Codex · Gemini (CLI + app) · Grok · Perplexity · Cursor · Copilot · Windsurf · Zed · Cline/Roo · JetBrains · aider · anything with MCP, REST or a file upload.

[![CI](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml/badge.svg)](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/mrzroot/hamyad)](https://github.com/mrzroot/hamyad/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-blue)

[Website & live demo](https://mrzroot.github.io/hamyad/) · [فارسی](README.fa.md) · [Research](RESEARCH.md) · [Changelog](CHANGELOG.md)

</div>

```
        ChatGPT ─┐   claude.ai ─┐   Gemini app ─┐   Grok ─┐   Perplexity ─┐        (remote MCP · GPT Action/REST · MEMORY.md)
                 ▼              ▼               ▼         ▼               ▼
              ┌───────────────────────────────────────────────────────────────┐
              │   .brain/   decisions · tasks · notes · context ·             │ ◀── git / Dropbox / Drive / any shared folder
              │             sessions (every chat) · changes (every diff)      │     or ONE MEMORY.md file
              └───────────────────────────────────────────────────────────────┘
                 ▲          ▲          ▲          ▲          ▲         ▲        ▲
   Claude Code ──┘  Codex ──┘ Cursor ──┘ Copilot ─┘ Gemini CLI┘Windsurf┘ aider ─┘   (hooks + MCP + AGENTS.md/CLAUDE.md)
```

You decide *"use FastAPI, not Flask"* in a ChatGPT chat. Five minutes later Codex, Claude Code, Cursor and Gemini CLI open a
session and the first thing their model reads is:

```
⚠ DECISIONS CHANGED since your last Codex session (2026-10-09 15:57 UTC). Follow the new ones; do not act on the old ones:
- REPLACED: "Use Flask for the API" `d-20261009-7w8i` → "Use FastAPI for the API" `d-20261009-hd8h` (ChatGPT) — async + OpenAPI
Other tools' sessions since then:
- [Claude Code] add claude_feature.py please `s-20261009-dhja`
- [Gemini CLI] add gemini_feature.py please `s-20261009-juqx`
```

…and every chat app sees what the coding agents did: each agent session is summarised (prompts, files, outcome) and its
**git diff** is journaled, attributed to the tool. That exact flow runs in CI-style e2e tests against the *real* Claude Code,
Codex, Gemini CLI, Copilot CLI and aider binaries ([scripts/e2e](scripts/e2e)).

## Connect any AI

`hamyad init --all` wires every coding tool in the repo. `hamyad connect <tool>` prints the exact steps for the rest.

| Tool | How it connects | Setup | Sees at start | Writes back |
|---|---|---|---|---|
| **Claude Code** | hooks + MCP + `CLAUDE.md` | ✅ `hamyad init` | brief + “decisions changed” | session summary, git diff, MCP writes |
| **Codex** CLI / IDE (cloud: AGENTS.md) | hooks + MCP + `AGENTS.md` | ✅ `hamyad init` | brief + “decisions changed” | session summary, git diff, MCP writes |
| **Cursor** editor + `cursor-agent` | hooks + MCP + rule | ✅ `hamyad init` | brief + “decisions changed” | session summary, git diff, MCP writes |
| **GitHub Copilot** (VS Code agent, Copilot CLI, cloud agent) | hooks + MCP + `AGENTS.md` | ✅ `hamyad init` | brief + “decisions changed” | session summary, git diff, MCP writes |
| **Gemini CLI** / Code Assist agent | hooks + MCP + `AGENTS.md` | ✅ `hamyad init` | brief + “decisions changed” | session summary, git diff, MCP writes |
| **Windsurf** / Devin Desktop | hooks + rule (+ MCP with `--global`) | ✅ `hamyad init` | brief + changes on first prompt | Cascade transcript summary, git diff |
| **Zed** agent | MCP (`.zed/settings.json`) + `AGENTS.md` | ✅ `--tools zed` | brief | MCP writes |
| **Roo Code** / **Cline** | MCP (`.roo/mcp.json`; Cline: paste) | ✅ / 1 min | brief | MCP writes |
| **JetBrains** Junie / AI Assistant | MCP (`.junie/mcp/mcp.json`; AI Assistant: paste) | ✅ / 1 min | brief | MCP writes |
| **aider** | `read: AGENTS.md` + chat import on commit | ✅ `hamyad init` | brief | chat summary (post-commit hook) |
| **Claude Desktop** | local MCP | ✅ `--global` | `brain_context` | MCP writes |
| **ChatGPT** (web, desktop, mobile) | remote MCP connector (developer mode) **or** Custom GPT Action (OpenAPI) **or** MEMORY.md | 2 min | `brain_context` / search+fetch | decisions (with supersede), tasks, notes, chat summaries |
| **Claude.ai** (web, mobile, Projects) | remote MCP connector or MEMORY.md in Project knowledge | 2 min | `brain_context` | same |
| **Grok** (grok.com; Grok CLI reads `.mcp.json`) | remote MCP connector | 2 min | `brain_context` | same |
| **Perplexity** | remote MCP connector (Mac app: local MCP) | 2 min | `brain_context` | same |
| **Gemini app** | custom app (MCP, where available) or MEMORY.md in a Gem | 2 min | MEMORY.md / connector | via connector |
| **Anything else** | stdio MCP · Streamable-HTTP MCP · REST + OpenAPI 3.1 · `MEMORY.md` | — | whatever it can read | MCP or REST |

### Chat apps (they run in the cloud, so they need a public URL)

Pick one:

- **Cloudflare Worker over your GitHub repo** (free tier, every write is a commit): see [worker/README.md](worker/README.md).
- **No GitHub:** `hamyad serve --host 0.0.0.0 --token $HAMYAD_TOKEN` next to your shared folder or MEMORY.md, then `cloudflared tunnel --url http://localhost:8787` (or ngrok).

Then, with `URL=https://hamyad.<you>.workers.dev` and your token:

| App | Where | Value |
|---|---|---|
| ChatGPT · MCP | turn on **Developer mode** (Settings → Apps → Advanced; workspace admins enable it for Business/Enterprise), then [chatgpt.com/plugins](https://chatgpt.com/plugins) → **+ → Add custom MCP server** | `URL/mcp/<TOKEN>?source=chatgpt`, auth none. Also exposes read-only `search`/`fetch`, so deep research can use it. |
| ChatGPT · GPT Action | Create a GPT → Configure → **Actions → Import from URL** | `URL/openapi.json`, Authentication **API key → Bearer → `<TOKEN>`** |
| Claude.ai | Customize → Connectors → **Add custom connector** | `URL/mcp/<TOKEN>?source=claude-chat` |
| Grok | grok.com/connectors → **New Connector → Custom** | `URL/mcp/<TOKEN>?source=grok` |
| Perplexity | Account settings → Connectors → **+ Custom connector → Remote** (Streamable HTTP, auth none) | `URL/mcp/<TOKEN>?source=perplexity` |
| Gemini app | Settings & help → Connected Apps → **Add a custom app** (Gemini Spark; US personal accounts) | `URL/mcp/<TOKEN>?source=gemini-app` — elsewhere: add `MEMORY.md` to a Gem |
| Any upload-only tool | attach / knowledge file | `.brain/MEMORY.md` (always fresh) or `URL/api/memory.md?key=<TOKEN>` |

Paste `hamyad connect instructions` into the Project / GPT / Gem / Space instructions so the model calls `brain_context` first and
`brain_remember` when you decide something. Writes are attributed per app (`?source=`, the client's MCP `clientInfo`, or its User-Agent).

## Quick start

```bash
npm i -g https://github.com/mrzroot/hamyad/releases/download/v0.2.0/hamyad-0.2.0.tgz

cd my-project
hamyad init --all            # .brain/ + MCP configs + hooks for Claude Code, Codex, Gemini CLI, Cursor, Copilot,
                             # Windsurf, Zed, Roo, Junie, aider + CLAUDE.md/AGENTS.md brief + git post-commit trigger
git add -A && git commit -m "Add hamyad brain" && git push
hamyad import                # pull in past chats from tools you already used here (Claude Code, Codex, Gemini, Copilot, Cursor, Windsurf, aider)
hamyad connect chatgpt       # or claude-ai, grok, perplexity, gemini-app, cline, jetbrains, any …
hamyad status                # which tools are wired, last session of each
```

**No GitHub?** Put the brain in any synced folder, or in a single file:

```bash
hamyad init --all --store ~/Dropbox/brains/shop/MEMORY.md     # one Markdown file is the whole brain
hamyad init --all --store "~/Google Drive/brains/shop"         # or a folder (gets a MEMORY.md export too)
```

`.hamyad.json` points the repo at the store; every machine and tool that sees that folder shares the brain. The single-file store re-reads before each write and swaps atomically, so two writers do not clobber each other.

## Decisions that change: supersession

- `brain_remember { kind: "decision", title: "Use FastAPI", supersedes: ["d-…flask"] }` (or `hamyad add decision "…" --supersedes id`, or `hamyad supersede old new`) marks the old entry `status: superseded`, links both ways, and stamps a dated note.
- When a new decision *looks* like it conflicts with one still in force (shared topic words or tags), hamyad tells the model and asks it to confirm instead of guessing.
- The brief lists superseded items under **“Superseded — do NOT follow”**.
- Every tool keeps its own "last seen" time, so at session start each agent gets **“⚠ DECISIONS CHANGED since your last <tool> session”**. If another tool changes a decision *during* a session, the next prompt hook tells the agent.

## When memory updates (triggers)

| Trigger | What runs | Tools |
|---|---|---|
| **Session start** | commit leftovers → fast-forward pull → refresh CLAUDE.md / AGENTS.md / MEMORY.md → snapshot the working tree → inject the brief + “decisions changed” | Claude Code, Codex, Gemini CLI, Cursor, Copilot (Windsurf: first prompt) |
| **Each prompt** | record the prompt (redacted); warn if another tool changed a decision meanwhile | same |
| **Turn end** (`Stop`, `AfterAgent`, `agentStop`, `post_cascade_response_with_transcript`) | upsert this session's summary + change set (git diff since session start) | same + Windsurf |
| **Session end** | final capture → commit `.brain/` → push in the background (never blocks the agent) | same |
| **MCP / REST write** (`brain_remember`, `brain_update`, `brain_log_session`) | write the entry → regenerate MEMORY.md and instruction files (Worker: refresh `.brain/MEMORY.md` on GitHub) | every MCP/REST client, chat apps included |
| **git commit** (post-commit hook) | import aider's chat, refresh exports | everyone, aider especially |
| **Timer** (`hamyad watch --interval 300`, or cron `hamyad sync --import`) | pull → import local chat logs → regenerate → commit → push | tools without hooks, other machines |
| **Manual** | `hamyad sync`, `hamyad import`, `hamyad export --out FILE` | — |

## What gets captured, and privacy

| Setting (`.brain/config.json` → `capture`) | Default | Effect |
|---|---|---|
| `sessions` | `"summary"` | `off` = nothing; `summary` = prompts (clipped to 300 chars), files touched, last reply; `full` = also a redacted transcript in `.brain/transcripts/<tool>/` |
| `changes` / `patch` | `true` / `true` | change journal: diffstat + clipped patch per session |
| `redact` | `true` | API keys (OpenAI, Anthropic, GitHub, AWS, Google, Slack, Stripe, npm…), JWTs, bearer tokens, private keys, URL passwords, `password=`-style assignments → `[REDACTED:…]`. Applied to every entry. |
| `exclude` | `[".env", "secrets/"]` | never diffed |
| `maxPatchBytes` / `maxTranscriptBytes` / `maxPromptChars` | 12000 / 150000 / 300 | size limits |
| `tools` | all on | per-tool switch, e.g. `{ "cursor": false }` |

`hamyad init --capture off|summary|full` sets it. Transcripts are opt-in. Session records and the hook error log stay machine-local in `.git/hamyad/`.

The change journal snapshots the working tree when a session starts (a temporary git index, no commits) and diffs it at each turn end, so it
captures uncommitted edits too. If two agents work in the same checkout at the same time, both see the combined diff; with
[dibs](https://github.com/mrzroot/dibs) installed, hamyad adds dibs' per-file attribution to the change entry.

## Timeline

```
$ hamyad timeline
2026-10-09
  15:57  💬 [Codex]            what framework do we use?
  15:57  ✗ [ChatGPT]          superseded: Use Flask for the API → Use FastAPI for the API
  15:57  ◆ [ChatGPT]          decided: Use FastAPI for the API (active)
  15:57  ± [GitHub Copilot]   1 file(s) +1 −0 — add copilot_feature.py please
  15:57  💬 [Gemini CLI]       add gemini_feature.py please
  15:57  ● [you]              aider target (dev)
```

Chats, change sets, decisions, supersessions, tasks, git commits (agent-attributed from `Co-authored-by` trailers / aider author tags) and dibs edits, newest first. `--tool codex`, `--since`, `--json`. Chat apps get the same view through `brain_timeline` / `GET /api/timeline`.

## What lands in your repo

```
.brain/
├── config.json         project, capture/privacy settings, exports, instruction files
├── MEMORY.md           the whole brain in one file (upload it anywhere; re-importable)
├── BRAIN.md            human-readable brief
├── decisions/ tasks/ notes/ context/
├── sessions/           one summary per chat / agent session, attributed to the tool
├── changes/            change journal: what each agent session changed
└── transcripts/        only with capture.sessions = "full"
CLAUDE.md, AGENTS.md    your content + a generated <!-- hamyad:begin --> block
.mcp.json .codex/ .gemini/ .cursor/ .github/hooks/ .vscode/mcp.json .windsurf/ .devin/ .zed/ .roo/ .junie/ .aider.conf.yml
```

## Interfaces

**MCP tools** (stdio and Streamable HTTP): `brain_context` (optional `since`), `brain_remember` (with `supersedes`, returns conflict hints), `brain_search`, `brain_list`, `brain_get`, `brain_update` (with `superseded_by`), `brain_timeline`, `brain_log_session`; for ChatGPT also `search` and `fetch`. Resource `brain://brief`, prompts `brain_kickoff`, `brain_wrapup`.

**REST** (same auth: `Authorization: Bearer`, `X-Hamyad-Key` or `?key=`): `GET /api/context?since=`, `GET /api/search?q=`, `GET|POST /api/entries`, `GET|PATCH /api/entries/{id}`, `POST /api/sessions`, `GET /api/timeline`, `GET /api/memory.md`; schema at `GET /openapi.json`.

**CLI**

```
hamyad init [--all | --tools a,b] [--global] [--store PATH] [--capture MODE]   hamyad connect [tool] [--url URL]
hamyad add <decision|task|note|context> "title" [-m body] [-t tags] [--supersedes ids]   hamyad supersede <old> <new>
hamyad list | search | show | done | update | context [--since] [--tool]          hamyad timeline [--tool] [--since] [--json]
hamyad import [tool…] [--dry-run]   hamyad sync [--import]   hamyad watch [--interval 300]   hamyad export [--out FILE]
hamyad status   hamyad mcp   hamyad serve   hamyad hook <tool> <event>   hamyad absorb
```

## Verified vs. needs an account

| Verified on real binaries against a mock model server ([scripts/e2e](scripts/e2e), 46 checks) | Verified by config parsing / unit tests only | Needs a real account to try |
|---|---|---|
| Claude Code 2.1, Codex 0.162, Gemini CLI 0.63, Copilot CLI 1.0, aider: hooks fire, sessions + diffs captured and attributed, hamyad MCP tools offered to the model, “DECISIONS CHANGED” reaches the model after a ChatGPT-style supersede over HTTP | `claude/codex/gemini mcp list` read the generated configs; `cursor-agent mcp list` sees `hamyad`; Cursor/Windsurf hook payloads, Zed/Roo/Junie/VS Code configs, REST/OpenAPI, ChatGPT search/fetch, Worker on workerd (CI) | ChatGPT, claude.ai, Grok, Perplexity, Gemini app connectors; Cursor IDE & Windsurf sessions; JetBrains, Zed, Cline UIs |

## Limits (honest)

- Chat apps' own memories (ChatGPT memory, Claude project memory) have no API; hamyad sits beside them, and the model uses it because the connector and your instructions tell it to. Chats are only captured when the model calls `brain_log_session` (the instructions ask it to); hamyad cannot scrape cloud chat history.
- The remote endpoint uses a shared token (URL path, header or `?key=`), no OAuth yet. Use one deployment per person or team.
- Search is keyword-based (Persian-aware). Conflict detection is a heuristic that *suggests*; supersession happens only with explicit ids.
- Agent log formats are internal to each tool; importers are tolerant and covered by real fixtures, but may need updates when tools change.

## Develop

```bash
npm ci && npm test            # unit + git round trip + MCP SDK interop + hooks/importers/REST (54 tests)
python3 scripts/e2e/mock.py & python3 scripts/e2e/run.py    # real agent CLIs against the mock model
npm run bundle:worker
```

Prior art and links: [RESEARCH.md](RESEARCH.md). MIT © [Mohammadreza Zare (M-R-Z)](https://github.com/mrzroot)
