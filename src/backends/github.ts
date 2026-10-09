import type { Backend, RawFile } from "../core/backend.js";

export interface GitHubOptions {
  /** "owner/repo" */
  repo: string;
  token: string;
  branch?: string;
  /** brain folder inside the repo, default `.brain` */
  dir?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

/**
 * GitHub is the source of truth: every write is a commit on the branch.
 * Reads use one GraphQL query that returns the whole `.brain/` tree with file
 * contents, so a request costs 1 sub-request (Cloudflare Workers friendly).
 */
export class GitHubBackend implements Backend {
  readonly label: string;
  private owner: string;
  private name: string;
  private branch: string;
  private dir: string;
  private api: string;
  private f: typeof fetch;

  constructor(private o: GitHubOptions) {
    const [owner, name] = o.repo.split("/");
    if (!owner || !name) throw new Error(`GITHUB_REPO must look like "owner/repo", got "${o.repo}"`);
    if (!o.token) throw new Error("a GitHub token is required");
    this.owner = owner;
    this.name = name;
    this.branch = o.branch || "main";
    this.dir = (o.dir || ".brain").replace(/^\/+|\/+$/g, "");
    this.api = (o.apiUrl || "https://api.github.com").replace(/\/+$/, "");
    this.f = o.fetch || ((...a) => fetch(...a));
    this.label = `github:${o.repo}@${this.branch}/${this.dir}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.o.token}`,
      accept: "application/vnd.github+json",
      "user-agent": this.o.userAgent || "hamyad",
      "x-github-api-version": "2022-11-28",
      ...extra,
    };
  }

  async readAll(): Promise<RawFile[]> {
    const blob = "... on Blob { text oid isBinary }";
    const level = (depth: number): string =>
      depth === 0 ? "" : `entries { name type object { ${blob} ... on Tree { ${level(depth - 1)} } } }`;
    const query = `query($owner:String!,$name:String!,$expr:String!){ repository(owner:$owner,name:$name){ object(expression:$expr){ ... on Tree { ${level(3)} } } } }`;
    const res = await this.f(`${this.api}/graphql`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ query, variables: { owner: this.owner, name: this.name, expr: `${this.branch}:${this.dir}` } }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    if (json.errors?.length) throw new Error(`GitHub GraphQL: ${json.errors.map((e: any) => e.message).join("; ")}`);
    const root = json.data?.repository?.object;
    const out: RawFile[] = [];
    const walk = (node: any, prefix: string) => {
      for (const ent of node?.entries || []) {
        const p = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.name.startsWith(".")) continue;
        if (!prefix && ent.name === "transcripts") continue;
        if (ent.type === "tree") walk(ent.object, p);
        else if (ent.type === "blob" && ent.object && !ent.object.isBinary && /\.(md|json)$/.test(ent.name))
          out.push({ path: p, content: ent.object.text ?? "", sha: ent.object.oid });
      }
    };
    if (root) walk(root, "");
    return out;
  }

  async write(path: string, content: string, message: string, sha?: string) {
    if (path.includes("..")) throw new Error("invalid path");
    const url = `${this.api}/repos/${this.owner}/${this.name}/contents/${encodePath(`${this.dir}/${path}`)}`;
    const body: Record<string, unknown> = { message, content: b64(content), branch: this.branch };
    if (sha) body.sha = sha;
    const res = await this.f(url, { method: "PUT", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) {
      throw new Error(`GitHub rejected the write (${res.status}); the file changed in the meantime, read it again and retry`);
    }
    if (!res.ok) throw new Error(`GitHub contents API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    return { sha: json?.content?.sha as string | undefined };
  }
}

function encodePath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** UTF-8 safe base64 that works in Node and Workers. */
export function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
