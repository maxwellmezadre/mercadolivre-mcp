import { authStatus } from "./auth.js";
import type { ToolDef } from "./define.js";
import { getInvoice, getPurchase, listCategories, listPurchases } from "./purchases.js";
import { rawGet } from "./raw.js";

// Flat registry shared by the MCP server and the CLI (AR-1). The order here
// is the order clients see.
export const allTools: ToolDef[] = [
  authStatus,
  listPurchases,
  getPurchase,
  listCategories,
  getInvoice,
  rawGet,
];

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
