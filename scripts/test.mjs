// Cross-platform test runner (Node 20 does not expand globs on Windows).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("dist/test").filter((f) => f.endsWith(".test.js")).map((f) => `dist/test/${f}`);
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
