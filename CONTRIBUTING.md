# Contributing

```bash
git clone https://github.com/mrzroot/hamyad && cd hamyad
npm ci
npm test            # build + 37 tests (unit, git loop, MCP SDK interop)
npm run bundle:worker
```

- Zero runtime dependencies is a goal: the MCP core is hand-written JSON-RPC and is tested against the official SDK client.
- Keep `src/core`, `src/mcp/server.ts`, `src/mcp/http.ts` and `src/backends/github.ts` free of Node built-ins so they run on Cloudflare Workers.
- Persian contributions to `README.fa.md` and the site are very welcome.
