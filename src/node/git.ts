import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BLOCK_END } from "../core/render.js";

export function git(cwd: string, args: string[], opts: { allowFail?: boolean; timeout?: number } = {}): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: opts.timeout,
      // HAMYAD_INTERNAL lets our own post-commit hook ignore brain commits
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", HAMYAD_INTERNAL: "1" },
    });
    return { ok: true, out: out.trim() };
  } catch (e: any) {
    if (!opts.allowFail) throw new Error(`git ${args.join(" ")} failed: ${(e.stderr || e.message || "").toString().trim()}`);
    return { ok: false, out: (e.stderr || e.stdout || e.message || "").toString().trim() };
  }
}

export function gitRoot(cwd: string): string | undefined {
  const r = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  return r.ok && r.out ? r.out : undefined;
}

export function hasUpstream(root: string): boolean {
  return git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowFail: true }).ok;
}

export interface SyncReport {
  pulled?: string;
  committed?: string;
  pushed?: string;
  skipped: string[];
}

/** fetch + fast-forward only. Never rewrites local work. */
export function pullFastForward(root: string, rep: SyncReport) {
  if (!hasUpstream(root)) {
    rep.skipped.push("pull: branch has no upstream");
    return;
  }
  const f = git(root, ["fetch", "--quiet"], { allowFail: true, timeout: 20000 });
  if (!f.ok) {
    rep.skipped.push(`pull: fetch failed (${f.out.split("\n")[0]})`);
    return;
  }
  const behind = Number(git(root, ["rev-list", "--count", "HEAD..@{u}"]).out || 0);
  if (!behind) {
    rep.pulled = "already up to date";
    return;
  }
  const ahead = Number(git(root, ["rev-list", "--count", "@{u}..HEAD"]).out || 0);
  if (ahead && onlyBrainCommitsAhead(root)) {
    const r = git(root, ["pull", "--rebase", "--autostash", "--quiet"], { allowFail: true });
    if (r.ok) rep.pulled = `rebased ${ahead} brain commit(s) onto ${behind} new commit(s)`;
    else {
      git(root, ["rebase", "--abort"], { allowFail: true });
      rep.skipped.push(`pull: rebase failed, run git pull yourself (${r.out.split("\n")[0]})`);
    }
    return;
  }
  if (ahead) {
    rep.skipped.push(`pull: branch has diverged (${ahead} local, ${behind} remote commits); run git pull yourself`);
    return;
  }
  const r = git(root, ["merge", "--ff-only", "--quiet", "@{u}"], { allowFail: true });
  if (r.ok) rep.pulled = `fast-forwarded ${behind} commit(s)`;
  else rep.skipped.push(`pull: fast-forward failed (${r.out.split("\n")[0]})`);
}

export function onlyBrainCommitsAhead(root: string): boolean {
  const r = git(root, ["log", "--format=%s", "@{u}..HEAD"], { allowFail: true });
  if (!r.ok) return false;
  const subjects = r.out.split("\n").filter(Boolean);
  return subjects.every((s) => s.startsWith("brain:"));
}

function stripBlock(s: string): string {
  const a = s.indexOf("<!-- hamyad:begin");
  const b = s.indexOf(BLOCK_END);
  return a !== -1 && b > a ? s.slice(0, a) + s.slice(b + BLOCK_END.length) : s;
}

/** True when CLAUDE.md differs from HEAD only inside the generated block. */
export function claudeMdOnlyBlockChanged(root: string, rel = "CLAUDE.md"): boolean {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return false;
  const head = git(root, ["show", `HEAD:${rel}`], { allowFail: true });
  const now = readFileSync(abs, "utf8");
  // Not tracked yet: only safe when the file is nothing but our block (we created it).
  if (!head.ok) return now.includes(BLOCK_END) && stripBlock(now).replace(/^\s*# [\w.-]+\.md\s*/, "").trim() === "";
  return stripBlock(head.out).replace(/\s+/g, "") === stripBlock(now).replace(/\s+/g, "");
}

/** Commit .brain/ (and CLAUDE.md when only our block changed). Returns the short sha. */
export function commitBrain(root: string, brainRel: string | string[], message: string, rep: SyncReport, instructionFiles: string[] = ["CLAUDE.md"]) {
  const paths = (Array.isArray(brainRel) ? brainRel : [brainRel]).filter(Boolean);
  for (const f of instructionFiles) if (claudeMdOnlyBlockChanged(root, f)) paths.push(f);
  if (!paths.length) return;
  git(root, ["add", "-A", "--", ...paths]);
  const staged = git(root, ["diff", "--cached", "--name-only", "--", ...paths]).out;
  if (!staged) return;
  const r = git(root, ["commit", "--quiet", "--no-verify", "-m", message, "--", ...paths], { allowFail: true });
  if (r.ok) rep.committed = `${git(root, ["rev-parse", "--short", "HEAD"]).out} ${message}`;
  else rep.skipped.push(`commit failed: ${r.out.split("\n")[0]}`);
}

/** Push only if every unpushed commit is a brain commit, so we never publish the user's WIP. */
export function pushBrain(root: string, rep: SyncReport) {
  if (!hasUpstream(root)) {
    rep.skipped.push("push: branch has no upstream");
    return;
  }
  const ahead = Number(git(root, ["rev-list", "--count", "@{u}..HEAD"]).out || 0);
  if (!ahead) return;
  if (!onlyBrainCommitsAhead(root)) {
    rep.skipped.push("push: you have unpushed non-brain commits; push them yourself (brain commits will go with them)");
    return;
  }
  let r = git(root, ["push", "--quiet"], { allowFail: true });
  if (!r.ok) {
    const p = git(root, ["pull", "--rebase", "--autostash", "--quiet"], { allowFail: true });
    if (!p.ok) git(root, ["rebase", "--abort"], { allowFail: true });
    r = p.ok ? git(root, ["push", "--quiet"], { allowFail: true }) : p;
  }
  if (r.ok) rep.pushed = `${ahead} brain commit(s)`;
  else rep.skipped.push(`push failed: ${r.out.split("\n")[0]}`);
}
