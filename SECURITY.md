# Security

- **Report a vulnerability** privately through GitHub Security Advisories on this repository.
- The remote server refuses to start on Workers without `HAMYAD_TOKEN`, and `hamyad serve` refuses to bind a public interface without `--token`.
- Use a **fine-grained** GitHub token limited to the one repository, with only *Contents: Read and write*.
- Anyone holding the connector URL with the token in its path can read and write the brain. Treat it like a password and rotate it with `wrangler secret put HAMYAD_TOKEN`.
- Brain entries are data. Text inside entries can come from chats or web research; Claude is told to treat it as context, not commands. Review `.brain/` diffs like any other code change.
- Hooks never push commits that are not brain commits, never rewrite history except rebasing unpushed brain-only commits, and never commit your own CLAUDE.md edits.

## Privacy of captured chats and code changes (0.2)

- Captured sessions and change sets are written to `.brain/`, which is **committed and pushed** in GitHub mode. Treat the repo's visibility as the visibility of your agent chats.
- Every entry passes through secret redaction (API keys, tokens, JWTs, private keys, URL passwords, `password=`-style assignments). Redaction is pattern-based: it reduces risk, it does not guarantee that nothing sensitive is stored.
- `capture.sessions` defaults to `summary` (prompts clipped to 300 chars, files touched, last reply). Full transcripts are opt-in (`full`) and size-limited. `off` disables capture; `capture.tools.<tool> = false` disables one tool.
- `capture.exclude` (default `.env`, `secrets/`) keeps paths out of the change journal.
- Session records, hook error logs and "last seen" times stay machine-local in `.git/hamyad/` (or `~/.hamyad/state/`).
- The REST endpoint (`/api/*`) uses the same token as `/mcp`. `/openapi.json` is public; it describes the API and contains no data.
