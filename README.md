<div align="center">

# hamyad · هم‌یاد

**One shared project brain for Claude Code, Claude.ai chat, Claude Desktop and GitHub.**

[![CI](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml/badge.svg)](https://github.com/mrzroot/hamyad/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/mrzroot/hamyad)](https://github.com/mrzroot/hamyad/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-blue)

[Website & live demo](https://mrzroot.github.io/hamyad/) · [فارسی](README.fa.md) · [Research: what exists today](RESEARCH.md)

</div>

*hamyad* (هم‌یاد, "remembering together") gives a project **one memory** that every Claude surface reads and writes:
a `.brain/` folder of plain Markdown in your repo, exposed as an MCP server over **stdio** (Claude Code, Claude Desktop)
and **remote HTTP** (a claude.ai custom connector you can host free on Cloudflare Workers). GitHub is the source of truth.

## The problem

Today the same project lives on three islands that do not talk to each other:

| Surface | What it remembers | Where | Shared with the others? |
|---|---|---|---|
| **Claude Code** (CLI) | `CLAUDE.md` + auto memory (`~/.claude/projects/<repo>/memory/`) | your disk, per machine | no |
| **Claude.ai Projects** (chat) | project knowledge, custom instructions, project-scoped chat memory | Anthropic's cloud | no; the GitHub integration is **read-only** and syncs only when you press *Sync now* |
| **Claude Desktop** | its own chats + local MCP servers | your disk / cloud | no |

A decision you make in a claude.ai chat never reaches Claude Code, and what Claude Code learned in a session never reaches the chat.
Details and links: [RESEARCH.md](RESEARCH.md).

## How hamyad fixes it

```
 Claude.ai chat / mobile ──remote MCP──▶ Cloudflare Worker ──GitHub API (1 commit per write)──┐
 Claude Desktop ───────────stdio MCP───▶ hamyad mcp ──────────────┐                           ▼
 Claude Code ──────stdio MCP + hooks───▶ hamyad mcp ──▶ .brain/*.md  ◀── git pull / push ──▶ GitHub repo
                     SessionStart: pull ▸ refresh CLAUDE.md ▸ "new since last session"     (source of truth)
                     SessionEnd:   summarise transcript ▸ commit ▸ safe push
```

- **Same tools everywhere**: `brain_context`, `brain_remember`, `brain_search`, `brain_list`, `brain_get`, `brain_update`, `brain_log_session`.
- **Plain files**: one Markdown file per decision / task / note / context fact / session. Readable on github.com, reviewable in PRs, editable by hand, mergeable (unique file names, so two writers do not conflict).
- **Claude Code hooks** pull what the chat side wrote, refresh a generated block in `CLAUDE.md`, and inject *"New since your last Claude Code session"* into context. When the session ends, they write an LLM-free session summary (prompts, files changed, commits, outcome) and push it so the chat side sees it.
- **Safe git**: fast-forward only; pushes only when every unpushed commit is a `brain:` commit; never commits your own edits to `CLAUDE.md`.
- **Zero runtime dependencies**, Node ≥ 18. The MCP core is hand-written and tested against the official MCP SDK client.
- **Persian-aware search**: ي/ی, ك/ک, ZWNJ and ۱۲۳/123 all match.

## Quick start

```bash
# 1. install (npm package coming; until then from the release tarball)
npm i -g https://github.com/mrzroot/hamyad/releases/download/v0.1.0/hamyad-0.1.0.tgz

# 2. in your repo
cd my-project
hamyad init                      # .brain/, .mcp.json, .claude/settings.json hooks, CLAUDE.md block
git add .brain .mcp.json .claude/settings.json CLAUDE.md && git commit -m "Add hamyad brain" && git push

# 3. print the exact setup for claude.ai, Claude Desktop and your Project instructions
hamyad connect
```

Then in Claude Code: approve the `hamyad` MCP server once. That is it for the CLI side.

### Claude.ai chat (web, desktop chat, mobile) via a remote connector

claude.ai reaches custom connectors **from Anthropic's cloud**, so the server must be public. The free Cloudflare Workers plan is enough
(and because the call comes from Anthropic, not from your device, local filtering of `workers.dev` does not matter).

```bash
git clone https://github.com/mrzroot/hamyad && cd hamyad && npm ci && npm run build
cd worker
# edit wrangler.toml: GITHUB_REPO = "you/my-project"
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN    # fine-grained PAT: only my-project, Contents: Read and write
npx wrangler secret put HAMYAD_TOKEN    # a long random string, e.g. `openssl rand -hex 24`
```

In claude.ai: **Customize → Connectors → Add custom connector**

- URL: `https://hamyad.<you>.workers.dev/mcp/<HAMYAD_TOKEN>` with *No sign in*, **or**
- URL: `https://hamyad.<you>.workers.dev/mcp` with request header `Authorization: Bearer <HAMYAD_TOKEN>`.

Paste the text printed by `hamyad connect` into your Project's **custom instructions** so Claude calls `brain_context` at the start of each chat and `brain_remember` when you decide something.
Optional read-only fallback: add `.brain/BRAIN.md` to the Project's knowledge through the GitHub integration.

Prefer self-hosting? `hamyad serve --host 0.0.0.0 --port 8787 --token $HAMYAD_TOKEN --github you/my-project` (GitHub-backed) or, inside a clone,
`hamyad serve --token … --git` (writes files and commits + pushes each write). Put it behind HTTPS.

### Claude Desktop (local)

```json
{
  "mcpServers": {
    "hamyad": { "command": "hamyad", "args": ["mcp", "--dir", "/path/to/my-project", "--source", "claude-desktop"] }
  }
}
```

## What lands in your repo

```
.brain/
├── config.json        project name, brief size, git behaviour
├── BRAIN.md           generated brief (good for Claude.ai Project knowledge)
├── decisions/d-20261009-k3x9-use-postgres.md
├── tasks/t-20261009-7hqa-sms-login.md
├── notes/  context/  sessions/
CLAUDE.md              your content + a generated <!-- hamyad:begin --> … <!-- hamyad:end --> block
.mcp.json              { "mcpServers": { "hamyad": { "command": "hamyad", "args": ["mcp"] } } }
.claude/settings.json  SessionStart / SessionEnd hooks (merged with yours)
```

An entry:

```markdown
---
id: d-20261009-k3x9
kind: decision
title: Use PostgreSQL, not MySQL
status: active
tags: [db]
source: claude-chat
created: 2026-10-09T14:02:11.000Z
updated: 2026-10-09T14:02:11.000Z
---
JSONB for the product catalogue; team already runs Postgres. MySQL rejected.
```

## MCP tools

| Tool | What it does |
|---|---|
| `brain_context` | Compact brief: context, active decisions, open tasks, recent notes and sessions |
| `brain_remember` | Save a `decision`, `task`, `note` or `context` entry (one commit on GitHub) |
| `brain_search` | Keyword search, English + Persian aware |
| `brain_list` | Filter by kind / status / tag |
| `brain_get` | Full entry by id (or unique id suffix) |
| `brain_update` | Change status, append a dated follow-up, retitle, retag |
| `brain_log_session` | Save a chat summary so the next Claude Code session sees it |

Also a `brain://brief` resource and the prompts `brain_kickoff` and `brain_wrapup` ("save everything we decided in this chat").

## CLI

```
hamyad init | status | sync | connect
hamyad add <decision|task|note|context> "title" [-m body] [-t tags] [-s status]
hamyad list [kind] · search "q" · show <id> · done <id> · update <id> --status … --append …
hamyad context            print what Claude sees
hamyad absorb             copy Claude Code's machine-local auto memory into the shared brain
hamyad mcp | serve | hook session-start|session-end
```

## How it compares

| | Claude Projects + GitHub | basic-memory | mcp-memory-service | Mem0 MCP | **hamyad** |
|---|---|---|---|---|---|
| Writes back from chat | no (read-only, manual sync) | via its cloud tier | yes (self-host server) | yes (hosted) | **yes, as git commits** |
| Lives in *your repo* / reviewable in PRs | n/a | no (separate notes dir) | no (DB) | no | **yes** |
| Claude Code hooks + CLAUDE.md sync | no | no | own hooks (DB-backed) | no | **yes** |
| Free hosting for claude.ai | n/a | paid cloud | self-host | hosted | **Workers free tier** |
| Semantic / vector search | n/a | yes | yes | yes | no (keyword; v0.2 maybe) |
| License | n/a | AGPL-3.0 | Apache-2.0 | Apache-2.0 | **MIT** |

## Limits (honest)

- Claude.ai's own *project memory* and *custom instructions* have no public API, so hamyad cannot read or write them. It sits beside them as the shared, durable layer, and Claude uses it because the instructions you paste tell it to.
- No OAuth yet: the connector uses a shared secret (URL path or header). Fine for one person; for a team prefer per-person deployments.
- Search is keyword-based. Brains stay small (hundreds of files), and the brief is what matters most.
- Concurrent edits of the *same* entry from two places: the GitHub backend detects it (sha check) and asks to retry; locally git handles it.

## Develop

```bash
npm ci && npm test          # 36 tests: unit, git round trip with a bare remote, MCP SDK interop (stdio + HTTP), Worker
npm run bundle:worker       # proves the Worker bundle has no Node built-ins
```

MIT © [Mohammadreza Zare (M-R-Z)](https://github.com/mrzroot)
