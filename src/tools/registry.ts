import { listInstallments, listPaymentMethods, spendingSummary } from "./analytics.js";
import { authStatus } from "./auth.js";
import type { ToolDef } from "./define.js";
import { doctor } from "./doctor.js";
import { downloadInvoice, exportInvoices } from "./invoices.js";
import { listProducts, productHistory } from "./products.js";
import { getInvoice, getPurchase, listCategories, listPurchases, searchPurchases } from "./purchases.js";
import { rawGet } from "./raw.js";
import { sync } from "./sync.js";

// Flat registry shared by the MCP server and the CLI (AR-1). The order here
// is the order clients see.
export const allTools: ToolDef[] = [
  authStatus,
  doctor,
  listPurchases,
  getPurchase,
  searchPurchases,
  listCategories,
  listProducts,
  productHistory,
  spendingSummary,
  listInstallments,
  listPaymentMethods,
  getInvoice,
  downloadInvoice,
  exportInvoices,
  sync,
  rawGet,
];

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}
