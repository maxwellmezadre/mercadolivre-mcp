import type { Database } from "bun:sqlite";
import type { DateFilterValue } from "../meli/api/purchases.js";
import { normalizeTitle } from "../meli/merge.js";
import type { InvoiceRow, ProductRow, PurchaseRow } from "./repo.js";

// Read side of the cache (AR-6): the filters every query tool needs, in SQL.
// Dates are `YYYY-MM-DD` strings, so ranges compare lexicographically. The
// site's `filterDate` windows are emulated locally against the injected clock.

export type PurchaseQuery = {
  from?: string;
  to?: string;
  category?: string;
  /** Full-text search over product titles and variations. */
  search?: string;
  status?: string;
  includeCancelled?: boolean;
  limit?: number;
  offset?: number;
};

export type ProductSort = "date_desc" | "date_asc" | "paid_desc" | "paid_asc";

export type ProductQuery = {
  from?: string;
  to?: string;
  seller?: string;
  minPaidCents?: number;
  maxPaidCents?: number;
  titleContains?: string;
  itemId?: string;
  sort?: ProductSort;
  limit?: number;
  includeCancelled?: boolean;
};

export type ProductWithPurchase = ProductRow & {
  purchase_date: string | null;
  purchase_status: string | null;
  seller_name: string | null;
  seller_id: string | null;
  purchase_total_cents: number | null;
};

const CANCELLED = "Cancelado";

/** FTS5 query: every whitespace-separated term quoted, so user text never breaks the syntax. */
export function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"`)
    .join(" ");
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function monthsAgo(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
}

/** Emulates the site's `filterDate` (spec §4.1): 1Y..4Y are calendar years. */
export function dateFilterRange(
  filter: DateFilterValue | undefined,
  now: Date,
): { from?: string; to?: string } {
  const year = now.getUTCFullYear();
  switch (filter) {
    case "30D":
      return { from: iso(new Date(now.getTime() - 30 * 86_400_000)) };
    case "3M":
      return { from: iso(monthsAgo(now, 3)) };
    case "6M":
      return { from: iso(monthsAgo(now, 6)) };
    case "Y":
      return { from: `${year}-01-01` };
    case "1Y":
    case "2Y":
    case "3Y":
    case "4Y": {
      const target = year - Number(filter[0]);
      return { from: `${target}-01-01`, to: `${target}-12-31` };
    }
    default:
      return {};
  }
}

class Where {
  readonly clauses: string[] = [];
  readonly values: unknown[] = [];
  add(clause: string, ...values: unknown[]): this {
    this.clauses.push(clause);
    this.values.push(...values);
    return this;
  }
  maybe(value: unknown, clause: string, ...values: unknown[]): this {
    return value === undefined || value === null || value === "" ? this : this.add(clause, ...values);
  }
  sql(): string {
    return this.clauses.length > 0 ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }
}

function purchaseWhere(query: PurchaseQuery, alias = "u"): Where {
  const where = new Where()
    .maybe(query.from, `${alias}.purchase_date >= ?`, query.from)
    .maybe(query.to, `${alias}.purchase_date <= ?`, query.to)
    .maybe(query.status, `${alias}.status = ?`, query.status)
    .maybe(
      query.category,
      `EXISTS (SELECT 1 FROM purchase_categories c WHERE c.purchase_id = ${alias}.purchase_id AND c.category = ?)`,
      query.category,
    );
  if (query.search && ftsQuery(query.search)) {
    where.add(
      `${alias}.purchase_id IN (SELECT p.purchase_id FROM products_fts f JOIN products p ON p.order_id = f.order_id WHERE products_fts MATCH ?)`,
      ftsQuery(query.search),
    );
  }
  if (query.includeCancelled === false) where.add(`COALESCE(${alias}.status, '') <> ?`, CANCELLED);
  return where;
}

const PRODUCT_SORT: Record<ProductSort, string> = {
  date_desc: "u.purchase_date DESC, p.rowid",
  date_asc: "u.purchase_date ASC, p.rowid",
  paid_desc: "p.paid_cents IS NULL, p.paid_cents DESC, p.rowid",
  paid_asc: "p.paid_cents IS NULL, p.paid_cents ASC, p.rowid",
};

export type Queries = {
  purchases(query: PurchaseQuery): PurchaseRow[];
  countPurchases(query: PurchaseQuery): number;
  productsByPurchase(purchaseIds: string[]): Map<string, ProductRow[]>;
  categoriesByPurchase(purchaseIds: string[]): Map<string, string[]>;
  products(query: ProductQuery): ProductWithPurchase[];
  /** Cached invoices of the purchases in a period, newest purchase first. */
  invoices(query: Pick<PurchaseQuery, "from" | "to" | "includeCancelled">): Array<InvoiceRow & { purchase_date: string | null }>;
};

export function createQueries(db: Database): Queries {
  const all = <T>(sql: string, ...params: unknown[]) => db.query(sql).all(...(params as never[])) as T[];
  const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

  return {
    purchases(query) {
      const where = purchaseWhere(query);
      return all<PurchaseRow>(
        `SELECT u.* FROM purchases u ${where.sql()} ORDER BY u.purchase_date DESC, u.rowid DESC LIMIT ? OFFSET ?`,
        ...where.values,
        query.limit ?? 50,
        query.offset ?? 0,
      );
    },

    countPurchases(query) {
      const where = purchaseWhere(query);
      return (all<{ n: number }>(`SELECT COUNT(*) AS n FROM purchases u ${where.sql()}`, ...where.values)[0] as { n: number }).n;
    },

    productsByPurchase(purchaseIds) {
      const map = new Map<string, ProductRow[]>();
      if (purchaseIds.length === 0) return map;
      const rows = all<ProductRow>(
        `SELECT * FROM products WHERE purchase_id IN (${placeholders(purchaseIds.length)}) ORDER BY rowid`,
        ...purchaseIds,
      );
      for (const row of rows) map.set(row.purchase_id, [...(map.get(row.purchase_id) ?? []), row]);
      return map;
    },

    categoriesByPurchase(purchaseIds) {
      const map = new Map<string, string[]>();
      if (purchaseIds.length === 0) return map;
      const rows = all<{ purchase_id: string; category: string }>(
        `SELECT purchase_id, category FROM purchase_categories WHERE purchase_id IN (${placeholders(purchaseIds.length)}) ORDER BY rowid`,
        ...purchaseIds,
      );
      for (const row of rows) map.set(row.purchase_id, [...(map.get(row.purchase_id) ?? []), row.category]);
      return map;
    },

    invoices(query) {
      const where = purchaseWhere(query);
      return all<InvoiceRow & { purchase_date: string | null }>(
        `SELECT i.*, u.purchase_date FROM invoices i JOIN purchases u ON u.purchase_id = i.purchase_id
         ${where.sql()} ORDER BY u.purchase_date DESC, i.order_id`,
        ...where.values,
      );
    },

    products(query) {
      const where = new Where()
        .maybe(query.from, "u.purchase_date >= ?", query.from)
        .maybe(query.to, "u.purchase_date <= ?", query.to)
        .maybe(query.minPaidCents, "p.paid_cents >= ?", query.minPaidCents)
        .maybe(query.maxPaidCents, "p.paid_cents <= ?", query.maxPaidCents)
        .maybe(query.itemId, "p.item_id = ?", query.itemId)
        .maybe(query.titleContains, "p.title_norm LIKE ?", `%${normalizeTitle(query.titleContains ?? "")}%`);
      if (query.seller) {
        where.add("(LOWER(u.seller_name) LIKE ? OR u.seller_id = ?)", `%${query.seller.toLowerCase()}%`, query.seller);
      }
      if (query.includeCancelled !== true) {
        where.add("COALESCE(u.status, '') <> ? AND COALESCE(p.status, '') <> ?", CANCELLED, CANCELLED);
      }
      return all<ProductWithPurchase>(
        `SELECT p.*, u.purchase_date, u.status AS purchase_status, u.seller_name, u.seller_id,
                u.total_cents AS purchase_total_cents
         FROM products p JOIN purchases u ON u.purchase_id = p.purchase_id
         ${where.sql()} ORDER BY ${PRODUCT_SORT[query.sort ?? "date_desc"]} LIMIT ?`,
        ...where.values,
        query.limit ?? 100,
      );
    },
  };
}
