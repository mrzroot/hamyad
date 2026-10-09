// Browser build used by the website's live demo: the real brain + MCP server, in memory.
export { Brain, changesSince } from "./core/brain.js";
export { MemoryBackend } from "./core/backend.js";
export { mergeConfig } from "./core/config.js";
export { renderBrief, renderClaudeBlock, renderChanges, renderMemoryMd } from "./core/render.js";
export { brainTimeline, sortTimeline } from "./core/timeline.js";
export { toolLabel, TOOL_LABELS } from "./core/tools.js";
export { McpServer, TOOLS } from "./mcp/server.js";
export { serializeEntry } from "./core/entry.js";
export { VERSION } from "./version.js";
