import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config.js";
import { type Ctx, createContext } from "../../src/context.js";
import { runTool } from "../../src/tools/define.js";
import { doctor } from "../../src/tools/doctor.js";

// REAL integration against Mercado Livre: the risk this project lives with
// is the internal layout changing under it. Gated twice: runs only with
// MERCADOLIVRE_LIVE=1 AND a session file on this machine. Skipped visibly
// otherwise; never part of CI. Each test costs one or two requests at the
// tool's own pace.

const config = (() => {
  try {
    return loadConfig();
  } catch {
    return null;
  }
})();
const enabled = process.env.MERCADOLIVRE_LIVE === "1" && config !== null && existsSync(config.sessionPath);
const gated = enabled ? describe : describe.skip;
const TIMEOUT = 90_000;

gated("real Mercado Livre session", () => {
  // Built in beforeAll, never at registration: a skipped suite must not touch
  // the user's config dir (createContext migrates legacy files on construction).
  let ctx: Ctx;
  beforeAll(() => {
    ctx = createContext(config ?? loadConfig(), { cacheFile: ":memory:" });
  });

  test(
    "the purchases list page parses with at least one purchase",
    async () => {
      const page = await ctx.meli.purchases.listPage(1, { dateFilter: "ALL" });
      expect(page.totalPages).toBeGreaterThan(0);
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items[0]).toMatchObject({ purchaseId: expect.any(String), packId: expect.any(String), orderId: expect.any(String) });
    },
    TIMEOUT,
  );

  test(
    "the detail of the newest purchase carries a ticket total and product rows",
    async () => {
      const page = await ctx.meli.purchases.listPage(1, { dateFilter: "ALL" });
      const first = page.items[0]!;
      const { detail } = await ctx.meli.purchases.getDetail({ purchaseId: first.purchaseId, packId: first.packId, orderId: first.orderId });
      expect(detail.money.totalCents).toBeDefined();
      expect(detail.products.length).toBeGreaterThan(0);
      expect(detail.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  test(
    "doctor is green",
    async () => {
      const report = (await runTool(doctor, {}, ctx)) as { ok: boolean; checks: unknown[] };
      expect(report.ok).toBe(true);
    },
    TIMEOUT,
  );
});
