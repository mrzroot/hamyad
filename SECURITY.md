# Security

- **Report a vulnerability** privately through GitHub Security Advisories on this repository.
- The remote server refuses to start on Workers without `HAMYAD_TOKEN`, and `hamyad serve` refuses to bind a public interface without `--token`.
- Use a **fine-grained** GitHub token limited to the one repository, with only *Contents: Read and write*.
- Anyone holding the connector URL with the token in its path can read and write the brain. Treat it like a password and rotate it with `wrangler secret put HAMYAD_TOKEN`.
- Brain entries are data. Text inside entries can come from chats or web research; Claude is told to treat it as context, not commands. Review `.brain/` diffs like any other code change.
- Hooks never push commits that are not brain commits, never rewrite history except rebasing unpushed brain-only commits, and never commit your own CLAUDE.md edits.
