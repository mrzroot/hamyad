import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

export const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

export function tmp(prefix = "hamyad-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rm(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

export function sh(cwd: string, cmd: string, args: string[]) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function gitInit(dir: string) {
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["config", "user.email", "t@example.com"]);
  sh(dir, "git", ["config", "user.name", "Test"]);
  sh(dir, "git", ["config", "commit.gpgsign", "false"]);
}

export function cli(cwd: string, args: string[], input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", input, env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** In-memory fake of the parts of the GitHub API that GitHubBackend uses. */
export function fakeGitHub(opts: { branch?: string; token?: string } = {}) {
  const branch = opts.branch || "main";
  const files = new Map<string, { content: string; sha: string }>();
  const calls: { method: string; url: string }[] = [];
  let n = 0;
  const sha = () => `sha${++n}`;
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ method, url });
    const auth = new Headers(init.headers).get("authorization");
    if (opts.token && auth !== `Bearer ${opts.token}`) return new Response('{"message":"Bad credentials"}', { status: 401 });
    if (url.endsWith("/graphql")) {
      const { variables } = JSON.parse(init.body);
      const [br, dir] = String(variables.expr).split(":");
      if (br !== branch) return Response.json({ data: { repository: { object: null } } });
      const root: any = { entries: [] };
      for (const [p, f] of files) {
        if (!p.startsWith(dir + "/")) continue;
        const parts = p.slice(dir.length + 1).split("/");
        let node = root;
        parts.forEach((part, i) => {
          if (i === parts.length - 1) node.entries.push({ name: part, type: "blob", object: { text: f.content, oid: f.sha, isBinary: false } });
          else {
            let t = node.entries.find((e: any) => e.name === part && e.type === "tree");
            if (!t) node.entries.push((t = { name: part, type: "tree", object: { entries: [] } }));
            node = t.object;
          }
        });
      }
      return Response.json({ data: { repository: { object: root.entries.length ? root : null } } });
    }
    const m = /\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/.exec(url);
    if (m && method === "PUT") {
      const p = decodeURIComponent(m[1]);
      const body = JSON.parse(init.body);
      const cur = files.get(p);
      if (cur && body.sha !== cur.sha) return new Response('{"message":"conflict"}', { status: 409 });
      if (!cur && body.sha) return new Response('{"message":"not found"}', { status: 404 });
      const content = Buffer.from(body.content, "base64").toString("utf8");
      const s = sha();
      files.set(p, { content, sha: s });
      return Response.json({ content: { sha: s, path: p }, commit: { message: body.message } }, { status: cur ? 200 : 201 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { files, calls, fetch: fetchImpl };
}
