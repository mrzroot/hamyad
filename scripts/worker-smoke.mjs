// Starts `wrangler dev` on the real Workers runtime (workerd) and speaks MCP to it.
// Only protocol-level calls are made, so no real GitHub token is needed.
import { spawn } from "node:child_process";

const port = 8799;
const dev = spawn(
  "npx",
  ["-y", "wrangler@4", "dev", "--port", String(port), "--var", "HAMYAD_TOKEN:smoke", "--var", "GITHUB_TOKEN:dummy", "--var", "GITHUB_REPO:mrzroot/hamyad"],
  { cwd: new URL("../worker", import.meta.url), stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
);
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 90_000;
async function up() {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/health");
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("wrangler dev did not start:\n" + log);
}

const rpc = (body, path = "/mcp/smoke") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });

try {
  const health = await up();
  if (health.name !== "hamyad") throw new Error("bad health " + JSON.stringify(health));
  const unauth = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "/mcp");
  if (unauth.status !== 401) throw new Error("expected 401, got " + unauth.status);
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } })).json();
  if (init.result?.serverInfo?.name !== "hamyad") throw new Error("bad initialize " + JSON.stringify(init));
  const tools = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  if (tools.result.tools.length !== 7) throw new Error("bad tools/list");
  console.log(`workerd smoke OK: ${init.result.serverInfo.name} ${init.result.serverInfo.version}, ${tools.result.tools.length} tools`);
} finally {
  dev.kill("SIGTERM");
}
process.exit(0);
