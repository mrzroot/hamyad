# hamyad on Cloudflare Workers

Remote MCP endpoint for claude.ai custom connectors. Storage = the `.brain/` folder of one GitHub repo; every write is a commit.

```bash
# from a clone of github.com/mrzroot/hamyad (or $(npm root -g)/hamyad/worker after installing the package)
npm ci && npm run build        # skip in the installed package: dist/ is prebuilt
cd worker
$EDITOR wrangler.toml          # GITHUB_REPO = "you/your-project"
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: only that repo, Contents: Read and write
npx wrangler secret put HAMYAD_TOKEN   # long random string
curl https://hamyad.<you>.workers.dev/health
```

claude.ai → Customize → Connectors → Add custom connector →
`https://hamyad.<you>.workers.dev/mcp/<HAMYAD_TOKEN>` (No sign in), or `/mcp` + header `Authorization: Bearer <HAMYAD_TOKEN>`.

Cost: one GraphQL request per read and one REST request per write, well inside the free plan (100k requests/day).
