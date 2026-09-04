import { Type } from "@sinclair/typebox";
import { LOGIN_HINT, SessionError } from "../core/errors.js";
import type { PurchaseListItem } from "../meli/types.js";
import { compactObject, defineTool } from "./define.js";

// F-15: the rediscovery checklist (spec appendix B.5). Each check is
// best-effort and names what broke, so a layout change is diagnosed in one
// call instead of by guessing from tool errors. Costs up to four requests.

type Check = { name: string; ok: boolean; detail: string };

const NETWORK_CHECKS = ["list_page", "json_endpoint", "detail_page", "money_identity", "invoices_overview"];

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const doctor = defineTool({
  name: "doctor",
  description:
    "Diagnoses the setup end to end: session, purchases list page, JSON list endpoint, purchase detail page, " +
    "money identity, invoices overview and the local cache. Names the endpoint that broke when Mercado Livre " +
    "changes something; run it before reporting a problem. Costs up to four requests.",
  readOnly: true,
  input: Type.Object({}),
  run: async (_args, ctx) => {
    const checks: Check[] = [];
    const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    const has = (name: string) => checks.some((check) => check.name === name);

    let sessionOk = ctx.session.hasSession();
    push(
      "session",
      sessionOk,
      sessionOk
        ? `${ctx.session.source()} session with ${ctx.session.cookies().length} cookie(s)`
        : "no session configured",
    );

    let first: PurchaseListItem | undefined;
    if (sessionOk) {
      try {
        const page = await ctx.meli.purchases.listPage(1, { dateFilter: "ALL" });
        first = page.items[0];
        push(
          "list_page",
          page.totalPages > 0 && page.items.length > 0,
          `${page.totalPages} pages, ${page.items.length} items on page 1, ${page.categories.length} categories`,
        );
      } catch (error) {
        if (error instanceof SessionError) {
          checks[0] = { name: "session", ok: false, detail: error.message };
          sessionOk = false;
        } else {
          push("list_page", false, message(error));
        }
      }
    }

    if (sessionOk) {
      try {
        const page = await ctx.meli.purchases.listFiltered({ dateFilter: "3M" });
        push("json_endpoint", true, `${page.items.length} items for the last 3 months`);
      } catch (error) {
        push("json_endpoint", false, message(error));
      }

      if (first) {
        try {
          const { detail } = await ctx.meli.purchases.getDetail({
            purchaseId: first.purchaseId,
            packId: first.packId,
            orderId: first.orderId,
          });
          const hasTotal = detail.money.totalCents !== undefined;
          const hasRows = detail.products.length > 0;
          push(
            "detail_page",
            hasTotal && hasRows,
            hasTotal && hasRows
              ? `purchase ${first.purchaseId}: ticket total present, ${detail.products.length} product row(s)`
              : `purchase ${first.purchaseId}: ${hasTotal ? "no product rows" : "no ticket total"}`,
          );
          push(
            "money_identity",
            detail.warnings.length === 0,
            detail.warnings.length === 0 ? "breakdown adds up" : detail.warnings.join("; "),
          );
        } catch (error) {
          push("detail_page", false, message(error));
          push("money_identity", false, "skipped: the detail page failed");
        }
        try {
          const invoices = await ctx.meli.invoices.overview([first.orderId]);
          push("invoices_overview", true, `${invoices.length} invoice(s) for order ${first.orderId}`);
        } catch (error) {
          push("invoices_overview", false, message(error));
        }
      }
    }

    for (const name of NETWORK_CHECKS) {
      if (!has(name)) push(name, false, sessionOk ? "skipped: no purchase on page 1" : "skipped: no valid session");
    }

    try {
      const store = ctx.store();
      const counts = store.counts();
      push(
        "cache",
        true,
        `${counts.purchases} purchases, ${counts.products} products, ${counts.invoices} invoices; ` +
          `last sync ${store.getState("last_sync_at") ?? "never"}`,
      );
    } catch (error) {
      push("cache", false, message(error));
    }

    // Keep the checklist in its canonical order whatever the path taken.
    const order = ["session", ...NETWORK_CHECKS, "cache"];
    checks.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

    return compactObject({
      ok: checks.every((check) => check.ok),
      checks,
      hint: sessionOk ? undefined : LOGIN_HINT,
    });
  },
});
