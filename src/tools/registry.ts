import type { Config } from "../config.js";
import { listInstallments, listPaymentMethods, spendingSummary } from "./analytics.js";
import { authStatus } from "./auth.js";
import type { ToolDef } from "./define.js";
import { doctor } from "./doctor.js";
import { exportData } from "./export.js";
import { downloadInvoice, exportInvoices } from "./invoices.js";
import { login } from "./login.js";
import { listProducts, productHistory } from "./products.js";
import { getInvoice, getPurchase, listCategories, listPurchases, searchPurchases } from "./purchases.js";
import { rawGet } from "./raw.js";
import { sync } from "./sync.js";

// Flat registry shared by the MCP server and the CLI (AR-1). The order here
// is the order clients see.
export const allTools: ToolDef[] = [
  // Session and diagnostics
  authStatus,
  login,
  doctor,
  // Cache
  sync,
  // Purchases
  listPurchases,
  getPurchase,
  searchPurchases,
  listCategories,
  // Products
  listProducts,
  productHistory,
  // Payments
  listInstallments,
  listPaymentMethods,
  // Invoices
  getInvoice,
  downloadInvoice,
  exportInvoices,
  // Analytics
  spendingSummary,
  exportData,
  // Escape hatch
  rawGet,
];

/**
 * Read-only mode: the tools that persist something (session, cache, files) are
 * simply not registered. A structural guarantee, not a runtime check.
 */
export function activeTools(config: Pick<Config, "readOnly">): ToolDef[] {
  return config.readOnly ? allTools.filter((tool) => tool.readOnly) : allTools;
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
