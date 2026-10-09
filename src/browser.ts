// Browser build used by the website's live demo: the real brain + MCP server, in memory.
export { Brain } from "./core/brain.js";
export { MemoryBackend } from "./core/backend.js";
export { mergeConfig } from "./core/config.js";
export { renderBrief, renderClaudeBlock } from "./core/render.js";
export { McpServer, TOOLS } from "./mcp/server.js";
export { serializeEntry } from "./core/entry.js";
export { VERSION } from "./version.js";
