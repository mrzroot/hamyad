/** Every tool hamyad knows, by the `source` id used in entries. */
export const TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-chat": "Claude.ai chat",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  chatgpt: "ChatGPT",
  "gemini-cli": "Gemini CLI",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  windsurf: "Windsurf",
  aider: "aider",
  "gemini-app": "Gemini app",
  grok: "Grok",
  perplexity: "Perplexity",
  zed: "Zed",
  cline: "Cline",
  roo: "Roo Code",
  jetbrains: "JetBrains AI",
  junie: "Junie",
  api: "REST API",
  mcp: "MCP client",
  cli: "hamyad CLI",
  git: "git",
  github: "GitHub",
  human: "you",
};

export const toolLabel = (s: string) => TOOL_LABELS[s] || s;

/**
 * Map an MCP client's `initialize.clientInfo.name` to a source id, so one
 * shared `.mcp.json` (read by Claude Code *and* Copilot CLI) still attributes
 * writes to the right tool.
 */
export function sourceFromClient(name?: string): string | undefined {
  const n = (name || "").toLowerCase();
  if (!n) return undefined;
  if (n.includes("claude-code") || n === "claude code") return "claude-code";
  if (n.includes("claude-ai") || n.includes("claude.ai") || n === "anthropic/claudeai" || n.includes("claudeai")) return "claude-chat";
  if (n.includes("claude")) return "claude-desktop";
  if (n.includes("codex")) return "codex";
  if (n.includes("openai") || n.includes("chatgpt")) return "chatgpt";
  if (n.includes("gemini")) return "gemini-cli";
  if (n.includes("cursor")) return "cursor";
  if (n.includes("copilot") || n.includes("visual studio code") || n.includes("vscode")) return "copilot";
  if (n.includes("windsurf") || n.includes("codeium") || n.includes("devin")) return "windsurf";
  if (n.includes("aider")) return "aider";
  if (n.includes("grok") || n.includes("xai")) return "grok";
  if (n.includes("perplexity")) return "perplexity";
  if (n.includes("zed")) return "zed";
  if (n.includes("roo")) return "roo";
  if (n.includes("cline")) return "cline";
  if (n.includes("junie")) return "junie";
  if (n.includes("jetbrains") || n.includes("intellij")) return "jetbrains";
  return n.replace(/[^a-z0-9.-]+/g, "-").slice(0, 40);
}
