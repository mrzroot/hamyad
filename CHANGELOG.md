# Changelog

## 0.1.0 (2026-10-09)

First release.

- `.brain/` git-tracked memory: decisions, tasks, notes, context, sessions as plain Markdown with frontmatter.
- Dependency-free MCP server core with 7 tools (`brain_context`, `brain_remember`, `brain_search`, `brain_list`, `brain_get`, `brain_update`, `brain_log_session`), a `brain://brief` resource and two prompts.
- Transports: stdio (Claude Code, Claude Desktop) and stateless Streamable HTTP (claude.ai custom connector), the latter on Node (`hamyad serve`) and Cloudflare Workers (`worker/`).
- GitHub backend: one GraphQL read per request, one commit per write, sha-guarded updates.
- Claude Code hooks: SessionStart (fast-forward pull, regenerate CLAUDE.md block, inject what changed on the chat side) and SessionEnd (LLM-free session summary from the transcript, commit, safe push).
- CLI: `init`, `status`, `sync`, `add`, `list`, `search`, `show`, `done`, `update`, `context`, `absorb`, `connect`, `mcp`, `serve`, `hook`.
- Persian-aware search (Arabic/Persian letters, ZWNJ, digits).
- 36 tests, including interop with the official MCP TypeScript SDK client over stdio and Streamable HTTP.
