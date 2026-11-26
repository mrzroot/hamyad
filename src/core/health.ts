import type { Entry } from "./entry.js";

export interface HealthIssue {
  level: "warn" | "error";
  code: "missing_store" | "broken_supersedes" | "broken_superseded_by" | "oversized_entry" | "uncommitted_brain" | "hook_errors";
  message: string;
  entryId?: string;
}

export interface BrainHealthReport {
  healthy: boolean;
  storeExists: boolean;
  entryCount: number;
  issues: HealthIssue[];
}

const OVERSIZED_BYTES = 16 * 1024;

export function auditBrainHealth(
  entries: Entry[],
  opts: {
    storeExists: boolean;
    uncommittedFiles?: number;
    hookErrorsLog?: boolean;
  },
): BrainHealthReport {
  const issues: HealthIssue[] = [];
  if (!opts.storeExists) {
    issues.push({
      level: "error",
      code: "missing_store",
      message: "Brain store does not exist yet (run `hamyad init`).",
    });
  }

  const ids = new Set(entries.map((e) => e.id));

  for (const e of entries) {
    for (const ref of e.supersedes || []) {
      if (!ids.has(ref)) {
        issues.push({
          level: "warn",
          code: "broken_supersedes",
          entryId: e.id,
          message: `Entry ${e.id} supersedes missing entry "${ref}".`,
        });
      }
    }
    if (e.supersededBy && !ids.has(e.supersededBy)) {
      issues.push({
        level: "warn",
        code: "broken_superseded_by",
        entryId: e.id,
        message: `Entry ${e.id} points supersededBy to missing entry "${e.supersededBy}".`,
      });
    }
    const size = Buffer.byteLength(`${e.title}\n${e.body || ""}`, "utf8");
    if (size > OVERSIZED_BYTES) {
      issues.push({
        level: "warn",
        code: "oversized_entry",
        entryId: e.id,
        message: `Entry ${e.id} (${e.path}) is ${(size / 1024).toFixed(1)} KB (>16 KB).`,
      });
    }
  }

  if (opts.uncommittedFiles && opts.uncommittedFiles > 0) {
    issues.push({
      level: "warn",
      code: "uncommitted_brain",
      message: `${opts.uncommittedFiles} uncommitted brain file(s); run \`hamyad sync\`.`,
    });
  }

  if (opts.hookErrorsLog) {
    issues.push({
      level: "warn",
      code: "hook_errors",
      message: "Hook errors logged in state dir (hook-errors.log).",
    });
  }

  return {
    healthy: issues.length === 0,
    storeExists: opts.storeExists,
    entryCount: entries.length,
    issues,
  };
}
