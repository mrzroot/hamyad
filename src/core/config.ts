export interface BrainConfig {
  /** Display name of the project */
  project: string;
  /** Keep a generated block inside CLAUDE.md in sync */
  claudeMd: boolean;
  /** Maximum characters of the generated brief (CLAUDE.md block, brain_context) */
  briefChars: number;
  /** git behaviour of `hamyad sync` and the Claude Code hooks */
  git: {
    /** fast-forward pull at session start / sync */
    pull: boolean;
    /** commit .brain/ changes at session end / sync */
    commit: boolean;
    /** push brain commits (only ever pushes when every unpushed commit is a brain commit) */
    push: boolean;
  };
  /** write a session summary entry when a Claude Code session ends */
  sessionLog: boolean;
}

export const DEFAULT_CONFIG: BrainConfig = {
  project: "my-project",
  claudeMd: true,
  briefChars: 6000,
  git: { pull: true, commit: true, push: true },
  sessionLog: true,
};

export function mergeConfig(raw: unknown): BrainConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<BrainConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...r,
    git: { ...DEFAULT_CONFIG.git, ...(r.git || {}) },
  };
}
