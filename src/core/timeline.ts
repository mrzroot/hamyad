import type { Entry } from "./entry.js";
import { toolLabel } from "./tools.js";

/** One row of the cross-tool timeline. */
export interface TimelineItem {
  at: string;
  tool: string;
  type: "session" | "change" | "decision" | "superseded" | "task" | "note" | "context" | "commit" | "dibs";
  title: string;
  id?: string;
  detail?: string;
}

/** Brain-side items (works everywhere, including the Worker). */
export function brainTimeline(entries: Entry[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) {
    const at = e.kind === "session" || e.kind === "change" ? e.updated || e.created : e.created;
    const type = e.kind === "decision" || e.kind === "context" || e.kind === "task" || e.kind === "note" || e.kind === "session" || e.kind === "change" ? e.kind : "note";
    out.push({ at, tool: e.source, type, title: e.title.replace(/^[^:]{2,30}:\s*/, e.kind === "session" || e.kind === "change" ? "" : "$&"), id: e.id, detail: e.status && e.kind !== "session" && e.kind !== "change" ? e.status : undefined });
    if (e.status === "superseded") {
      const by = e.supersededBy ? byId.get(e.supersededBy) : undefined;
      out.push({ at: e.updated, tool: by?.source || e.source, type: "superseded", title: `${e.title} → ${by?.title || e.supersededBy || "replaced"}`, id: e.id });
    }
  }
  return out;
}

const ICON: Record<TimelineItem["type"], string> = {
  session: "💬",
  change: "±",
  decision: "◆",
  superseded: "✗",
  task: "☐",
  note: "✎",
  context: "ℹ",
  commit: "●",
  dibs: "✋",
};

export function sortTimeline(items: TimelineItem[], o: { limit?: number; tool?: string; since?: string } = {}): TimelineItem[] {
  let xs = items.filter((i) => i.at);
  if (o.tool) xs = xs.filter((i) => i.tool === o.tool || toolLabel(i.tool).toLowerCase() === o.tool!.toLowerCase());
  if (o.since) xs = xs.filter((i) => i.at >= o.since!);
  xs.sort((a, b) => b.at.localeCompare(a.at));
  return o.limit ? xs.slice(0, o.limit) : xs;
}

export function renderTimeline(items: TimelineItem[], o: { color?: boolean } = {}): string {
  const lines: string[] = [];
  let day = "";
  for (const i of items) {
    const d = i.at.slice(0, 10);
    if (d !== day) {
      day = d;
      lines.push(`\n${d}`);
    }
    const label = `[${toolLabel(i.tool)}]`.padEnd(18);
    lines.push(`  ${i.at.slice(11, 16)}  ${ICON[i.type]} ${label} ${i.type === "superseded" ? "superseded: " : i.type === "decision" ? "decided: " : ""}${i.title}${i.detail ? ` (${i.detail})` : ""}${i.id ? `  ${i.id}` : ""}`);
  }
  return lines.join("\n").trim() + "\n";
}
