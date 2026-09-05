import { describe, expect, test } from "bun:test";
import { createSessionStore } from "../src/auth/session.js";
import type { Ctx } from "../src/context.js";
import { SessionError, UpstreamError } from "../src/core/errors.js";
import type { InvoicesApi } from "../src/meli/api/invoices.js";
import type { PurchasesApi } from "../src/meli/api/purchases.js";
import type { DetailPage, ListPage, PurchaseListItem } from "../src/meli/types.js";
import { openDatabase } from "../src/store/db.js";
import { createStore } from "../src/store/repo.js";
import { runTool } from "../src/tools/define.js";
import { doctor } from "../src/tools/doctor.js";

// `doctor` runs the rediscovery checklist (spec appendix B.5) and names the
// endpoint that broke, so a layout change is diagnosed in one call.

const item: PurchaseListItem = {
  purchaseId: "100", packId: "100k", orderId: "1", purchaseDateLabel: "x", isFull: false, productTitle: "Produto", quantity: 1,
};
const page = (items: PurchaseListItem[]): ListPage => ({ page: 1, totalPages: 7, totalLabel: "68 compras", categories: ["Pet Shop"], dateFilters: [], items });
const detail = (warnings: string[] = []): DetailPage => ({
  purchaseId: "100", purchaseDateLabel: "x",
  money: { productsCents: 100, totalCents: 100, extras: {}, currency: "BRL" },
  shipping: {}, products: [{ title: "Produto", quantity: 1, paidCents: 100, variations: {} }],
  invoiceOrderIds: [], hasInvoice: false, payments: [], isEmpty: false, warnings,
});

type Behaviour = { listPage?: () => Promise<ListPage>; listFiltered?: () => Promise<ListPage>; getDetail?: () => Promise<{ detail: DetailPage; brickStack: Record<string, never> }>; overview?: () => Promise<[]> };

function ctxWith(behaviour: Behaviour = {}, opts: { session?: boolean } = {}) {
  const calls: string[] = [];
  const purchases: PurchasesApi = {
    listPage: async () => { calls.push("listPage"); return behaviour.listPage ? behaviour.listPage() : page([item]); },
    listFiltered: async () => { calls.push("listFiltered"); return behaviour.listFiltered ? behaviour.listFiltered() : page([item]); },
    getDetail: async () => { calls.push("getDetail"); return behaviour.getDetail ? behaviour.getDetail() : { detail: detail(), brickStack: {} }; },
  };
  const invoices: InvoicesApi = {
    overview: async () => { calls.push("overview"); return behaviour.overview ? behaviour.overview() : []; },
    download: async () => { throw new Error("not used"); },
    downloadXml: async () => { throw new Error("not used"); },
  };
  const session = createSessionStore({ sessionFile: "/nonexistent/session.json", cookie: opts.session === false ? undefined : "ssid=abcdefghijk" });
  const store = createStore(openDatabase(":memory:"));
  const ctx = { session, meli: { purchases, invoices }, store: () => store, now: () => new Date("2026-09-04T12:00:00Z"), config: { cacheFile: ":memory:" } } as unknown as Ctx;
  return { ctx, calls };
}

type Report = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; hint?: string };
const byName = (report: Report, name: string) => report.checks.find((check) => check.name === name);

describe("doctor", () => {
  test("green across the board when every endpoint answers as expected", async () => {
    const { ctx, calls } = ctxWith();

    const report = (await runTool(doctor, {}, ctx)) as Report;

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(["session", "list_page", "json_endpoint", "detail_page", "money_identity", "invoices_overview", "cache"]);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(byName(report, "list_page")?.detail).toMatch(/7 pages/);
    expect(calls).toEqual(["listPage", "listFiltered", "getDetail", "overview"]);
  });

  test("an expired session fails the session check and skips the rest", async () => {
    const { ctx, calls } = ctxWith({ listPage: async () => { throw new SessionError("EXPIRED"); } });

    const report = (await runTool(doctor, {}, ctx)) as Report;

    expect(report.ok).toBe(false);
    expect(byName(report, "session")?.ok).toBe(false);
    expect(byName(report, "detail_page")?.detail).toMatch(/skipped/);
    expect(report.hint).toMatch(/mercadolivre login/);
    expect(calls).toEqual(["listPage"]);
  });

  test("without any session it does not touch the network", async () => {
    const { ctx, calls } = ctxWith({}, { session: false });

    const report = (await runTool(doctor, {}, ctx)) as Report;

    expect(report.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("names the endpoint that broke and keeps checking the others", async () => {
    const { ctx } = ctxWith({ getDetail: async () => { throw new UpstreamError(500, "Ocorreu um erro"); } });

    const report = (await runTool(doctor, {}, ctx)) as Report;

    expect(report.ok).toBe(false);
    expect(byName(report, "detail_page")).toMatchObject({ ok: false });
    expect(byName(report, "detail_page")?.detail).toMatch(/Ocorreu um erro/);
    expect(byName(report, "invoices_overview")?.ok).toBe(true);
  });

  test("reports money invariant warnings as a failed identity check", async () => {
    const { ctx } = ctxWith({ getDetail: async () => ({ detail: detail(["money breakdown does not add up"]), brickStack: {} }) });

    const report = (await runTool(doctor, {}, ctx)) as Report;

    expect(byName(report, "money_identity")).toMatchObject({ ok: false });
    expect(byName(report, "money_identity")?.detail).toMatch(/does not add up/);
  });
});
