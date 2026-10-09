# Changelog

## 0.2.0 (2026-10-09)

hamyad is now one shared brain for **every** AI tool, not just Claude.

**Connect any AI**
- `hamyad init --all` (or `--tools …`) wires MCP + hooks + instructions for Claude Code, Codex, Gemini CLI, Cursor, Copilot (VS Code, CLI, cloud agent), Windsurf/Devin Desktop, Zed, Roo Code, JetBrains Junie and aider; `--global` adds Claude Desktop, Codex user config and Windsurf's global MCP.
- `hamyad connect <tool>`: exact setup for ChatGPT (MCP connector **and** Custom GPT Action), claude.ai, Claude Desktop, Grok, Perplexity, Gemini app, Cline, JetBrains AI Assistant and "anything else".
- REST API + OpenAPI 3.1 (`/api/*`, `/openapi.json`) on `hamyad serve` and the Worker, for GPT Actions and tools without MCP; `GET /api/memory.md` for tools that read a URL.
- ChatGPT gets OpenAI's read-only `search`/`fetch` tools (deep research compatible). Writes are attributed per client (`?source=`, MCP `clientInfo`, User-Agent).

**Capture across tools**
- One hook entry point, `hamyad hook <tool> <event>`, for Claude Code, Codex, Gemini CLI, Cursor, Copilot and Windsurf (payloads verified against the real CLIs). Fail-open; errors go to a local log.
- Every agent session becomes a `sessions/` entry and its git diff a `changes/` entry (change journal; working-tree snapshots, generated files excluded, dibs attribution when present).
- `hamyad import`: transcript importers for Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor agent transcripts, Windsurf and aider.
- `hamyad timeline`: chats, change sets, decisions, supersessions, tasks, agent-attributed git commits and dibs edits.

**Decisions that change**
- `supersedes` on `brain_remember` / `--supersedes` / `hamyad supersede`; superseded entries are linked both ways and listed under "Superseded — do NOT follow".
- Conflict hints when a new decision overlaps one still in force.
- Per-tool "last seen": every agent gets "⚠ DECISIONS CHANGED since your last <tool> session" at session start, and a mid-session notice on the next prompt.

**No-GitHub mode**
- `hamyad init --store PATH` keeps the brain in any synced folder or a single `MEMORY.md` file (Dropbox, Google Drive, iCloud, a cowork folder); `.hamyad.json` points the repo at it.
- `.brain/MEMORY.md` export regenerated on every write (CLI, MCP, hooks, Worker), re-importable; `hamyad export`.

**Triggers and privacy**
- Documented triggers: session start, prompt, turn end, session end, MCP/REST write, git post-commit, `hamyad watch` timer, manual sync.
- Secret redaction on everything written; `capture.sessions` off | summary (default) | full (opt-in redacted transcripts); size limits; per-tool switches; excludes.

**Tests**: 54 unit/integration tests plus `scripts/e2e` (46 checks) running the real Claude Code, Codex, Gemini CLI, Copilot CLI and aider binaries against a mock model server.

Breaking: hook commands are now `hamyad hook claude SessionStart` etc. (`hamyad hook session-start|session-end` still work; re-run `hamyad init` to update). Session records moved from `.brain/.state.json` to `.git/hamyad/`.

## 0.1.0 (2026-10-09)

First release.

- `.brain/` git-tracked memory: decisions, tasks, notes, context, sessions as plain Markdown with frontmatter.
- Dependency-free MCP server core with 7 tools, a `brain://brief` resource and two prompts.
- Transports: stdio and stateless Streamable HTTP, on Node (`hamyad serve`) and Cloudflare Workers (`worker/`).
- GitHub backend: one GraphQL read per request, one commit per write, sha-guarded updates.
- Claude Code hooks, CLI, Persian-aware search, 36 tests.
