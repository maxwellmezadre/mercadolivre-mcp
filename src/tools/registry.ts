import { authStatus } from "./auth.js";
import type { ToolDef } from "./define.js";
import { rawGet } from "./raw.js";

// Flat registry shared by the MCP server and the CLI (AR-1). The order here
// is the order clients see.
export const allTools: ToolDef[] = [authStatus, rawGet];

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
