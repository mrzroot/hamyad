import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brainTimeline, TimelineItem } from "../core/timeline.js";
import { git } from "./git.js";
import type { Project } from "./project.js";

/** Which agent made a commit, from trailers and author names the tools leave behind. */
export function commitTool(author: string, body: string): string {
  const t = `${author}\n${body}`;
  if (/\(aider\)/i.test(author) || /aider:/i.test(body.split("\n")[0] || "")) return "aider";
  if (/Co-Authored-By:.*Claude|Generated with \[Claude Code\]/i.test(t)) return "claude-code";
  if (/Co-authored-by:.*(Cursor|cursoragent)/i.test(t)) return "cursor";
  if (/Co-authored-by:.*Copilot|copilot-swe-agent/i.test(t)) return "copilot";
  if (/Co-authored-by:.*Codex|codex/i.test(author)) return "codex";
  if (/Co-authored-by:.*Gemini/i.test(t)) return "gemini-cli";
  if (/Co-authored-by:.*(Windsurf|Cascade|Devin)/i.test(t)) return "windsurf";
  return "human";
}

export function gitTimeline(root: string, limit = 60): TimelineItem[] {
  const r = git(root, ["log", `-n${limit}`, "--format=%H%x1f%aI%x1f%an%x1f%s%x1f%b%x1e"], { allowFail: true });
  if (!r.ok) return [];
  const out: TimelineItem[] = [];
  for (const rec of r.out.split("\x1e")) {
    const [sha, at, author, subject, body] = rec.trim().split("\x1f");
    if (!sha || !subject || subject.startsWith("brain:")) continue;
    out.push({ at: new Date(at).toISOString(), tool: commitTool(author, body || ""), type: "commit", title: subject, id: sha.slice(0, 7), detail: author });
  }
  return out;
}

/** Hour buckets of dibs edits, per actor (human vs each agent). */
export function dibsTimeline(root: string): TimelineItem[] {
  const gd = git(root, ["rev-parse", "--git-common-dir"], { allowFail: true });
  if (!gd.ok) return [];
  const f = path.join(path.resolve(root, gd.out), "dibs", "journal.jsonl");
  if (!existsSync(f)) return [];
  const buckets = new Map<string, { at: string; actor: string; files: Set<string> }>();
  for (const l of readFileSync(f, "utf8").split("\n")) {
    try {
      const e = JSON.parse(l);
      if (e.kind !== "change") continue;
      const at = new Date(e.ts * 1000).toISOString();
      const k = `${e.actor}|${at.slice(0, 13)}`;
      const b = buckets.get(k) || { at, actor: e.actor, files: new Set<string>() };
      b.at = at > b.at ? at : b.at;
      b.files.add(e.path);
      buckets.set(k, b);
    } catch {
      /* skip */
    }
  }
  const map: Record<string, string> = { claude: "claude-code", gemini: "gemini-cli" };
  return [...buckets.values()].map((b) => ({
    at: b.at,
    tool: map[b.actor] || b.actor,
    type: "dibs" as const,
    title: `edited ${[...b.files].slice(0, 4).join(", ")}${b.files.size > 4 ? ` +${b.files.size - 4}` : ""}`,
  }));
}

export async function projectTimeline(p: Project, o: { git?: boolean; dibs?: boolean } = {}): Promise<TimelineItem[]> {
  const { entries } = await p.brain.snapshot();
  const items = brainTimeline(entries);
  if (p.isGit && o.git !== false) items.push(...gitTimeline(p.root));
  if (p.isGit && o.dibs !== false) items.push(...dibsTimeline(p.root));
  return items;
}
