# Sharing project memory across AI tools: what exists (October 2026)

Research done while designing hamyad. Every claim links to its source; re-check them, these products change monthly.

## 1. Anthropic's own pieces

### Claude.ai Projects + GitHub integration (chat side)
- Add files or folders of a GitHub repo to a Project's knowledge; available on every plan. Claude sees **file names and contents only**, not commits, PRs or issues. You refresh with **Sync now**. [claude.com/docs/connectors/github](https://claude.com/docs/connectors/github) · [Help Center: Use the GitHub integration](https://support.claude.com/en/articles/10167454-use-the-github-integration)
- Sync is **manual and one-way (read-only)**. A request for push-webhook auto-sync was acknowledged ("syncs on demand… noting the feedback"): [anthropics/claude-ai-mcp#180](https://github.com/anthropics/claude-ai-mcp/issues/180). Users also report sync hanging: [anthropics/claude-code#32244](https://github.com/anthropics/claude-code/issues/32244).
- Requests for a bridge between Claude Code and Project knowledge (`claude project sync`) were closed as stale: [anthropics/claude-code#25983](https://github.com/anthropics/claude-code/issues/25983), see also #28307 "Shared Persistent Storage Between Claude.ai and Claude Code".

### Claude.ai memory, project knowledge, instructions
- Project knowledge + custom instructions apply to all chats in a project; context is not shared across chats unless it is in project knowledge. [Help Center: projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)
- Chat memory is on by default; **each project has its own separate memory space and summary**. [Help Center: chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- Memory import/export exists only as copy/paste text (experimental); no API. [Help Center: import and export memory](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude)

### Remote MCP custom connectors (the only programmable write path into chat)
- Available on Free (1 connector), Pro, Max, Team, Enterprise in claude.ai, Claude Desktop and Cowork. Add under **Customize → Connectors → Add custom connector** with a URL; auth = OAuth, *No sign in*, or fixed **request headers** (API key / bearer). [Help Center: custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [claude.com/docs: remote MCP](https://claude.com/docs/connectors/custom/remote-mcp) · [add an unlisted connector](https://claude.com/docs/connectors/custom/add-unlisted)
- Connectors are called **from Anthropic's cloud**, so the server must be reachable on the public internet (localhost/VPN does not work without allowlisting). Same sources.

### Claude Code memory and hooks (CLI side)
- Two systems: `CLAUDE.md` (you write; project/user/org scope) and **auto memory** (Claude writes) at `~/.claude/projects/<repo>/memory/MEMORY.md` + topic files, **machine-local**, first 200 lines / 25 KB loaded per session; `autoMemoryDirectory` can relocate it. [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Hooks: `SessionStart` (stdout or `hookSpecificOutput.additionalContext` is injected into context), `SessionEnd`, `Stop`, etc. [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) · [hooks guide](https://code.claude.com/docs/en/hooks-guide)
- Project-scoped MCP servers live in `.mcp.json`; hooks in `.claude/settings.json`.

### New: Claude Code "Projects" (cloud, beta, Pro/Max)
- A coordinating conversation that spawns cloud threads, with **project memory** (`MEMORY.md` files), project instructions and repos. It is **separate** from local auto memory and from the older claude.ai chat Projects ("those projects keep working as they do today"); not available in the terminal CLI. [code.claude.com/docs/en/claude-projects](https://code.claude.com/docs/en/claude-projects)
- Cloud threads get MCP tools from your **claude.ai connectors**, so a remote MCP connector is also how to reach them.

## 2. Open-source memory servers

| Project | Model | claude.ai (remote) | Notes |
|---|---|---|---|
| [basic-memory](https://github.com/basicmachines-co/basic-memory) | Markdown files + SQLite index (semantic graph) | via paid cloud tier | Strong local option; AGPL-3.0; separate notes dir, not your repo |
| [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | DB + embeddings, knowledge graph, REST | yes (Remote MCP, OAuth) | Apache-2.0; self-host; memories live in a DB |
| [Mem0 MCP](https://github.com/mem0ai/mem0) | hosted (`mcp.mem0.ai`), OAuth | yes (hosted) | Local OpenMemory was removed in July 2026 per [this comparison](https://mnemoverse.com/docs/library/memory-mcp-servers-compared) |
| [mcp_shared_memory_server](https://github.com/shirisha456/mcp_shared_memory_server) | PostgreSQL, versioned memories | self-host | Shared across Claude Desktop/Code/Cursor |
| [Official MCP "memory" server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | local JSON knowledge graph | no (stdio) | Reference implementation |
| [Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank) | convention: `memory-bank/*.md` in repo | n/a | Prompt pattern, no server, no chat bridge |

Survey: [13 Memory MCP Servers Compared (2026)](https://mnemoverse.com/docs/library/memory-mcp-servers-compared).

Hosting: Cloudflare Workers serve Streamable HTTP MCP endpoints; free plan = 100k requests/day. [createMcpHandler](https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/) · [limits](https://developers.cloudflare.com/workers/platform/limits/)

## 3. Gaps hamyad targets

1. **No write-back from chat to the repo.** Projects' GitHub integration is read-only and manual. Remote MCP is the only programmable path, and existing memory servers store into their own DB or cloud, not into the repo.
2. **Claude Code memory is machine-local** (auto memory) or hand-written (`CLAUDE.md`); nothing refreshes it with what the chat side decided.
3. **No reviewable history.** DB-backed memories are invisible in PRs; git-backed Markdown is diffable, blame-able and survives vendor changes.
4. **No session hand-off.** Nothing summarises a Claude Code session for the chat side, or tells Claude Code "here is what changed in chat since last time".

What hamyad still cannot do: read or write claude.ai's built-in project memory or custom instructions (no API). It works *beside* them; the custom instructions you paste make Claude use the shared brain.

## 4. Beyond Claude: every tool's hooks, logs and connector story (added for 0.2)

hamyad 0.2 verified the hook payloads and transcript formats below by running the real CLIs against a mock model server (`scripts/e2e/`).

| Tool | Hooks (docs) | Context injection | Local transcript | MCP config |
|---|---|---|---|---|
| Claude Code 2.1 | [hooks](https://code.claude.com/docs/en/hooks): SessionStart, UserPromptSubmit, Stop, SessionEnd | `hookSpecificOutput.additionalContext` | `~/.claude/projects/<slug>/<session>.jsonl` | `.mcp.json` |
| Codex CLI 0.162 | [hooks](https://developers.openai.com/codex/hooks): `.codex/hooks.json`, same nested shape as Claude; project hooks must be trusted (`/hooks`) | `additionalContext` | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` | `.codex/config.toml` `[mcp_servers.x]` (trusted project), tools appear to the model as one `mcp__x` namespace |
| Gemini CLI 0.63 | [hooks](https://geminicli.com/docs/hooks/reference/): SessionStart, BeforeAgent, AfterAgent, SessionEnd (not awaited) in `.gemini/settings.json` | `hookSpecificOutput.additionalContext` (wrapped in `<hook_context>` in the user turn) | `~/.gemini/tmp/<project>/chats/session-*.jsonl` | `.gemini/settings.json` `mcpServers`; trusted folders only |
| Copilot CLI 1.0 | [hooks](https://docs.github.com/en/copilot/reference/hooks-configuration): `.github/hooks/*.json` (`sessionStart`, `userPromptSubmitted`, `agentStop`, `sessionEnd`); also runs `.claude/settings.json` hooks (env `COPILOT_CLI=1`) | `additionalContext` (verified to reach the model in 1.0.94) | `$COPILOT_HOME/session-state/<id>/events.jsonl` | `.mcp.json`, `~/.copilot/mcp-config.json`; VS Code: `.vscode/mcp.json` |
| Cursor | [hooks](https://cursor.com/docs/hooks): `.cursor/hooks.json` (`sessionStart`, `beforeSubmitPrompt`, `afterAgentResponse`, `stop`, `sessionEnd`); also [third-party (Claude) hooks](https://cursor.com/docs/agent/third-party-hooks) | `additional_context` | agent transcripts under `~/.cursor/projects/<slug>/agent-transcripts/` | `.cursor/mcp.json` (`cursor-agent mcp list` reads it) |
| Windsurf / Devin Desktop | [Cascade hooks](https://docs.devin.ai/desktop/cascade/hooks): `pre_user_prompt`, `post_cascade_response_with_transcript` | none (rules + AGENTS.md instead) | `~/.windsurf/transcripts/<trajectory>.jsonl` | global only: `~/.codeium/windsurf/mcp_config.json` |
| aider | none | `read:` files in `.aider.conf.yml` | `.aider.chat.history.md` | none |
| Zed | none | AGENTS.md rules | — | [`context_servers`](https://zed.dev/docs/ai/mcp) in settings |
| JetBrains | none | AGENTS.md (Junie) | — | [Junie `.junie/mcp/mcp.json`](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html), [AI Assistant MCP settings](https://www.jetbrains.com/help/ai-assistant/mcp.html) |

### Chat apps that accept a remote MCP server (so they can write back)

- **ChatGPT**: developer mode + "Add custom MCP server" ([connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt), [developer mode](https://help.openai.com/en/articles/12584461)); deep research / company knowledge expect read-only `search` + `fetch` tools ([MCP guide](https://developers.openai.com/api/docs/mcp.md)). Custom GPT **Actions** take an OpenAPI schema with API-key (Bearer) auth, which hamyad serves at `/openapi.json`.
- **Grok**: grok.com/connectors → New Connector → Custom, public HTTPS only ([connectors](https://docs.x.ai/grok/connectors), [tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)). Grok CLI also loads `.mcp.json` and `.cursor/mcp.json` ([MCP servers](https://docs.x.ai/build/features/mcp-servers)).
- **Perplexity**: Account settings → Connectors → Custom connector → Remote, Streamable HTTP or SSE ([help](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors)).
- **Gemini app**: custom Connected Apps for Gemini Spark, US personal accounts only ([help](https://support.google.com/gemini/answer/17209137)); elsewhere a Gem with an uploaded file is the fallback.
- **Claude.ai**: see section 1.

### Prior art for cross-tool capture

- [git-ai](https://github.com/git-ai-project/git-ai) attributes AI-written lines in git via agent hooks; hamyad journals per-session diffs into the shared brain instead and can read [dibs](https://github.com/mrzroot/dibs)' per-file attribution journal.
- [Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank) and `AGENTS.md` are per-repo conventions; hamyad generates the AGENTS.md block from the shared brain so every agent that reads AGENTS.md gets it.
