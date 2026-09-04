import { authStatus } from "./auth.js";
import type { ToolDef } from "./define.js";
import { listProducts, productHistory } from "./products.js";
import { getInvoice, getPurchase, listCategories, listPurchases, searchPurchases } from "./purchases.js";
import { rawGet } from "./raw.js";
import { sync } from "./sync.js";

// Flat registry shared by the MCP server and the CLI (AR-1). The order here
// is the order clients see.
export const allTools: ToolDef[] = [
  authStatus,
  listPurchases,
  getPurchase,
  searchPurchases,
  listCategories,
  listProducts,
  productHistory,
  getInvoice,
  sync,
  rawGet,
];

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
