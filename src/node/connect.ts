import { INSTRUCTIONS } from "../mcp/server.js";

/**
 * "Connect any AI": exact setup for every tool, from one table. Used by `hamyad connect [tool]`
 * and mirrored in the README / site matrix.
 */

export interface ConnectCtx {
  root: string;
  project: string;
  /** owner/repo when known */
  repo: string;
  /** public base URL of the remote endpoint (Worker or tunnel) */
  url: string;
  memoryFile: string;
}

export type Via = "hooks+mcp" | "mcp" | "remote-mcp" | "openapi" | "file" | "import";

export interface ToolGuide {
  id: string;
  name: string;
  kind: "agent" | "ide" | "chat" | "any";
  /** strongest integration available, in order */
  via: Via[];
  /** does `hamyad init` wire it automatically? */
  auto: boolean;
  /** what it sees / what it writes back, for the matrix */
  sees: string;
  writes: string;
  steps: (c: ConnectCtx) => string;
}

const stdio = (c: ConnectCtx, extra: string[] = []) => JSON.stringify({ mcpServers: { hamyad: { command: "hamyad", args: ["mcp", "--dir", c.root, ...extra] } } }, null, 2);
const remote = (c: ConnectCtx, source: string) => `${c.url}/mcp/<HAMYAD_TOKEN>?source=${source}`;

export const REMOTE_NOTE = (c: ConnectCtx) => `Remote endpoint (needed by chat apps that run in the cloud): either
   a) the Cloudflare Worker over your GitHub repo (see worker/README.md; free tier), URL ${c.url}, or
   b) no GitHub: run  hamyad serve --host 0.0.0.0 --token <HAMYAD_TOKEN>  next to your shared folder/MEMORY.md
      and expose it:   cloudflared tunnel --url http://localhost:8787   (or ngrok http 8787)`;

export const GUIDES: ToolGuide[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "agent",
    via: ["hooks+mcp"],
    auto: true,
    sees: "brief in CLAUDE.md + “decisions changed” at SessionStart + MCP",
    writes: "session summary, change set (git diff), MCP writes",
    steps: () => "Wired by `hamyad init` (.mcp.json + .claude/settings.json hooks + CLAUDE.md). Approve the `hamyad` MCP server on first run.",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    kind: "chat",
    via: ["mcp"],
    auto: true,
    sees: "brain_context tool",
    writes: "MCP writes (attributed to claude-desktop)",
    steps: (c) => `hamyad init --global writes it for you, or Settings → Developer → Edit Config:\n${stdio(c, ["--source", "claude-desktop"])}`,
  },
  {
    id: "claude-ai",
    name: "Claude.ai (web, mobile, Projects)",
    kind: "chat",
    via: ["remote-mcp", "file"],
    auto: false,
    sees: "brain_context via connector; or MEMORY.md in Project knowledge",
    writes: "decisions/tasks/notes/session summaries via connector",
    steps: (c) => `${REMOTE_NOTE(c)}
   Customize → Connectors → Add custom connector → URL ${remote(c, "claude-chat")}
   Project → Custom instructions: paste the block printed by \`hamyad connect instructions\`.
   Read-only fallback: Project knowledge → GitHub → ${c.repo} → ${c.memoryFile} (or upload the file).`,
  },
  {
    id: "chatgpt",
    name: "ChatGPT (web, desktop, mobile)",
    kind: "chat",
    via: ["remote-mcp", "openapi", "file"],
    auto: false,
    sees: "brain_context / search+fetch (deep research) via MCP; or the GPT Action",
    writes: "decisions (with supersedes), tasks, notes, session summaries",
    steps: (c) => `${REMOTE_NOTE(c)}
   A) MCP connector (Plus/Pro/Business/Enterprise, developer mode):
      Settings → Apps → Advanced → Developer mode ON (Business/Enterprise: an admin enables it), then
      chatgpt.com/plugins → + → Add custom MCP server → URL ${remote(c, "chatgpt")}, authentication none (the token is in the path).
      Also exposes read-only search/fetch, so it works in deep research.
   B) Custom GPT Action (any paid plan, no developer mode):
      Explore GPTs → Create → Configure → Actions → Import from URL: ${c.url}/openapi.json
      Authentication: API Key → Bearer → <HAMYAD_TOKEN>. Instructions: paste \`hamyad connect instructions\`.
   C) Projects/files only: upload ${c.memoryFile} (regenerated on every change).`,
  },
  {
    id: "codex",
    name: "Codex CLI + IDE extension (+ Codex cloud via AGENTS.md)",
    kind: "agent",
    via: ["hooks+mcp"],
    auto: true,
    sees: "AGENTS.md brief + SessionStart context + MCP (mcp__hamyad)",
    writes: "session summary, change set, MCP writes",
    steps: () => "Wired by `hamyad init` (.codex/config.toml [mcp_servers.hamyad] + .codex/hooks.json + AGENTS.md). Trust the project once and approve the hooks in /hooks. `hamyad init --global` also adds it to ~/.codex/config.toml.",
  },
  {
    id: "cursor",
    name: "Cursor (editor + cursor-agent CLI)",
    kind: "ide",
    via: ["hooks+mcp"],
    auto: true,
    sees: "rule + AGENTS.md + sessionStart context + MCP",
    writes: "session summary, change set, MCP writes",
    steps: () => "Wired by `hamyad init` (.cursor/mcp.json, .cursor/hooks.json, .cursor/rules/hamyad.mdc). Enable the hamyad server in Settings → MCP the first time.",
  },
  {
    id: "windsurf",
    name: "Windsurf / Devin Desktop",
    kind: "ide",
    via: ["hooks+mcp"],
    auto: true,
    sees: "rule + AGENTS.md + “changed” notice on first prompt + MCP",
    writes: "session summary from Cascade transcript, change set",
    steps: (c) => `Hooks + rule wired by \`hamyad init\`. MCP is global only: \`hamyad init --tools windsurf --global\`, or Cascade → MCP → Manage → View raw config:\n${stdio(c)}`,
  },
  {
    id: "copilot",
    name: "GitHub Copilot (VS Code agent mode, Copilot CLI, cloud agent)",
    kind: "ide",
    via: ["hooks+mcp"],
    auto: true,
    sees: "AGENTS.md + sessionStart context + MCP",
    writes: "session summary, change set, MCP writes",
    steps: () => "Wired by `hamyad init` (.vscode/mcp.json for VS Code, .mcp.json + .github/hooks/hamyad.json for Copilot CLI / cloud agent). In VS Code: Chat → Agent mode → tools → enable hamyad.",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI (+ Gemini Code Assist agent mode)",
    kind: "agent",
    via: ["hooks+mcp"],
    auto: true,
    sees: "AGENTS.md (context.fileName) + SessionStart context + MCP",
    writes: "session summary, change set, MCP writes",
    steps: () => "Wired by `hamyad init` (.gemini/settings.json: mcpServers, hooks, context.fileName). Trust the folder once.",
  },
  {
    id: "gemini-app",
    name: "Gemini app (gemini.google.com)",
    kind: "chat",
    via: ["remote-mcp", "file"],
    auto: false,
    sees: "connector (where available) or the uploaded MEMORY.md",
    writes: "via connector; otherwise paste its summary into `hamyad add`",
    steps: (c) => `${REMOTE_NOTE(c)}
   Where custom apps exist (Gemini Spark, US personal accounts): Settings & help → Connected Apps → Add a custom app → ${remote(c, "gemini-app")}
   Everywhere else: create a Gem and add ${c.memoryFile} as knowledge (re-upload after big changes), or attach it to the chat.`,
  },
  {
    id: "grok",
    name: "Grok (grok.com + Grok CLI)",
    kind: "chat",
    via: ["remote-mcp", "mcp", "file"],
    auto: true,
    sees: "connector tools; Grok CLI reads .mcp.json",
    writes: "decisions/tasks/notes/sessions via MCP",
    steps: (c) => `${REMOTE_NOTE(c)}
   grok.com → Connectors (grok.com/connectors) → New Connector → Custom → ${remote(c, "grok")}
   Grok CLI already loads the project .mcp.json written by \`hamyad init\` (check with \`grok inspect\`).`,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    kind: "chat",
    via: ["remote-mcp", "file"],
    auto: false,
    sees: "connector tools, or MEMORY.md in a Space",
    writes: "via connector",
    steps: (c) => `${REMOTE_NOTE(c)}
   Account settings → Connectors → + Custom connector → Remote → URL ${remote(c, "perplexity")}, Transport: Streamable HTTP, Auth: None.
   Mac app (local): Connectors → + → Simple: command \`hamyad mcp --dir ${c.root} --source perplexity\`.
   Fallback: upload ${c.memoryFile} to a Space.`,
  },
  {
    id: "zed",
    name: "Zed (agent panel)",
    kind: "ide",
    via: ["mcp"],
    auto: true,
    sees: "AGENTS.md rules + MCP",
    writes: "MCP writes; commits via git hook",
    steps: () => "Wired by `hamyad init --tools zed` (.zed/settings.json context_servers.hamyad).",
  },
  {
    id: "cline",
    name: "Cline / Roo Code",
    kind: "ide",
    via: ["mcp"],
    auto: true,
    sees: "MCP + .clinerules/AGENTS.md",
    writes: "MCP writes",
    steps: (c) => `Roo Code: wired by \`hamyad init --tools roo\` (.roo/mcp.json). Cline: MCP Servers → Configure MCP Servers, add:\n${stdio(c, ["--source", "cline"])}`,
  },
  {
    id: "jetbrains",
    name: "JetBrains AI Assistant + Junie",
    kind: "ide",
    via: ["mcp"],
    auto: true,
    sees: "MCP + AGENTS.md (Junie)",
    writes: "MCP writes",
    steps: (c) => `Junie: wired by \`hamyad init --tools junie\` (.junie/mcp/mcp.json). AI Assistant: Settings → Tools → AI Assistant → Model Context Protocol (MCP) → + → As JSON, level: Project:\n${stdio(c, ["--source", "jetbrains"])}`,
  },
  {
    id: "aider",
    name: "aider",
    kind: "agent",
    via: ["file", "import"],
    auto: true,
    sees: "AGENTS.md via read: in .aider.conf.yml",
    writes: "chat history imported on every commit (git hook)",
    steps: () => "Wired by `hamyad init` (.aider.conf.yml read: AGENTS.md + git post-commit hook that imports .aider.chat.history.md).",
  },
  {
    id: "any",
    name: "Anything else (other MCP clients, scripts, Shortcuts, n8n…)",
    kind: "any",
    via: ["mcp", "remote-mcp", "openapi", "file"],
    auto: false,
    sees: "MCP, REST, or MEMORY.md",
    writes: "MCP or REST",
    steps: (c) => `Local MCP (stdio): command \`hamyad mcp --dir ${c.root}\`
   Remote MCP (Streamable HTTP): ${c.url}/mcp  (Authorization: Bearer <HAMYAD_TOKEN>)
   REST + OpenAPI 3.1: ${c.url}/openapi.json  (GET /api/context, /api/search?q=, POST /api/entries, …)
   One file: ${c.memoryFile}, or ${c.url}/api/memory.md?key=<HAMYAD_TOKEN> for tools that can read a URL.`,
  },
];

export function findGuide(id: string): ToolGuide | undefined {
  const k = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  const alias: Record<string, string> = {
    claude: "claude-code", claudecode: "claude-code", claudeai: "claude-ai", claudechat: "claude-ai", desktop: "claude-desktop", claudedesktop: "claude-desktop",
    openai: "chatgpt", gpt: "chatgpt", codexcli: "codex", vscode: "copilot", githubcopilot: "copilot", gemini: "gemini-cli", geminicli: "gemini-cli",
    geminiapp: "gemini-app", bard: "gemini-app", xai: "grok", roo: "cline", roocode: "cline", junie: "jetbrains", intellij: "jetbrains", pycharm: "jetbrains",
    devin: "windsurf", other: "any", generic: "any", rest: "any", openapi: "any",
  };
  const want = alias[k] || id.toLowerCase();
  return GUIDES.find((g) => g.id === want);
}

export function renderMatrix(): string {
  const rows = GUIDES.map((g) => `| ${g.name} | ${g.via.join(" · ")} | ${g.auto ? "✓ `hamyad init`" : "2 min setup"} | ${g.sees} | ${g.writes} |`);
  return ["| Tool | How | Setup | Sees | Writes back |", "|---|---|---|---|---|", ...rows].join("\n");
}

export function instructionsBlock(project: string): string {
  return `This project ("${project}") has a shared brain exposed by the hamyad connector/action.\n${INSTRUCTIONS}`;
}
