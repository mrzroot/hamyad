export type CaptureMode = "off" | "summary" | "full";

export interface BrainConfig {
  /** Display name of the project */
  project: string;
  /** Keep a generated block inside CLAUDE.md in sync (kept for 0.1 configs; see instructionFiles) */
  claudeMd: boolean;
  /** Files (relative to the project root) that get the generated brief block: read by every agent at startup */
  instructionFiles: string[];
  /** MEMORY.md exports kept fresh after every change. Relative to the project root, absolute, or ~/... */
  exports: string[];
  /** Maximum characters of the generated brief (instruction blocks, brain_context) */
  briefChars: number;
  /** git behaviour of `hamyad sync` and the hooks */
  git: {
    /** fast-forward pull at session start / sync */
    pull: boolean;
    /** commit .brain/ changes at session end / sync */
    commit: boolean;
    /** push brain commits (only ever pushes when every unpushed commit is a brain commit) */
    push: boolean;
  };
  /** write a session summary entry when an agent session ends (0.1 name; see capture.sessions) */
  sessionLog: boolean;
  /** What hooks and importers record from agent sessions */
  capture: {
    /** off: nothing; summary: prompts (clipped) + outcome + files; full: also a redacted transcript file (opt-in) */
    sessions: CaptureMode;
    /** record a change-journal entry (diffstat + clipped patch) per agent session */
    changes: boolean;
    /** include a clipped, redacted unified diff in change entries */
    patch: boolean;
    maxPatchBytes: number;
    maxTranscriptBytes: number;
    maxPromptChars: number;
    /** mask secrets in everything hamyad writes */
    redact: boolean;
    /** glob-ish path prefixes never shown in change entries (e.g. "secrets/", ".env") */
    exclude: string[];
    /** per-tool switch, e.g. { "cursor": false } */
    tools: Record<string, boolean>;
  };
}

export const DEFAULT_CONFIG: BrainConfig = {
  project: "my-project",
  claudeMd: true,
  instructionFiles: ["CLAUDE.md", "AGENTS.md"],
  exports: [".brain/MEMORY.md"],
  briefChars: 6000,
  git: { pull: true, commit: true, push: true },
  sessionLog: true,
  capture: {
    sessions: "summary",
    changes: true,
    patch: true,
    maxPatchBytes: 12000,
    maxTranscriptBytes: 150000,
    maxPromptChars: 300,
    redact: true,
    exclude: [".env", "secrets/"],
    tools: {},
  },
};

export function mergeConfig(raw: unknown): BrainConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<BrainConfig> & Record<string, any>;
  const cfg: BrainConfig = {
    ...DEFAULT_CONFIG,
    ...r,
    git: { ...DEFAULT_CONFIG.git, ...(r.git || {}) },
    capture: { ...DEFAULT_CONFIG.capture, ...(r.capture || {}), tools: { ...(r.capture?.tools || {}) } },
  };
  // 0.1 configs: no instructionFiles key -> CLAUDE.md (if claudeMd) only, so upgrading does not create AGENTS.md uninvited
  if (!Array.isArray(r.instructionFiles)) cfg.instructionFiles = r.claudeMd === false ? [] : raw && "claudeMd" in (raw as any) && !("capture" in (raw as any)) ? ["CLAUDE.md"] : [...DEFAULT_CONFIG.instructionFiles];
  if (r.claudeMd === false) cfg.instructionFiles = cfg.instructionFiles.filter((f) => f !== "CLAUDE.md");
  if (r.sessionLog === false && !r.capture?.sessions) cfg.capture.sessions = "off";
  if (!["off", "summary", "full"].includes(cfg.capture.sessions)) cfg.capture.sessions = "summary";
  if (!Array.isArray(cfg.exports)) cfg.exports = [...DEFAULT_CONFIG.exports];
  return cfg;
}

export function captureEnabled(cfg: BrainConfig, tool: string): boolean {
  return cfg.capture.sessions !== "off" && cfg.capture.tools[tool] !== false;
}
