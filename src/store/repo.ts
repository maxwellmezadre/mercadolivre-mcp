import type { Database } from "bun:sqlite";
import { normalizeTitle, type MergedProduct } from "../meli/merge.js";
import { groupPurchases } from "../meli/parser/list.js";
import type {
  DetailPage,
  InvoiceOverview,
  InvoiceXml,
  PurchaseListItem,
} from "../meli/types.js";

// Repository over the cache (AR-6, AR-8). Purchases are keyed by purchase id
// and hold the purchase-level facts exactly once; products are keyed by
// order id (one order = one product). Money stays in cents (AR-7). Prices
// keep their provenance: `detail` rows, NF-e `invoice` values (gross, kept in
// their own columns) or `none`.

/** Statuses that never change again; their details are not refreshed. */
export const FINAL_STATUSES = ["Entregue", "Cancelado"];

export type PurchaseRow = {
  purchase_id: string;
  pack_id: string | null;
  order_id: string | null;
  shipment_id: string | null;
  vertical_id: string | null;
  purchase_date: string | null;
  date_label: string | null;
  status: string | null;
  is_full: number | null;
  seller_id: string | null;
  seller_name: string | null;
  is_official: number | null;
  messages_url: string | null;
  products_cents: number | null;
  discount_cents: number | null;
  coupons_cents: number | null;
  shipping_cents: number | null;
  total_cents: number | null;
  interest_cents: number | null;
  item_count: number | null;
  extras: string | null;
  installments: number | null;
  installment_cents: number | null;
  pay_method: string | null;
  card_last4: string | null;
  payment_id: string | null;
  payment_date: string | null;
  address_line: string | null;
  address_city: string | null;
  has_invoice: number | null;
  invoice_order_ids: string | null;
  list_seen_at: string | null;
  detail_fetched_at: string | null;
  raw_detail: string | null;
  warnings: string | null;
};

export type ProductRow = {
  order_id: string;
  purchase_id: string;
  pack_id: string | null;
  shipment_id: string | null;
  item_id: string | null;
  title: string;
  title_norm: string | null;
  quantity: number;
  status: string | null;
  delivery_headline: string | null;
  delivered_at: string | null;
  is_full: number | null;
  list_cents: number | null;
  paid_cents: number | null;
  unit_cents: number | null;
  price_source: "detail" | "invoice" | "none";
  invoice_unit_cents: number | null;
  invoice_line_cents: number | null;
  variations: string | null;
  image_url: string | null;
  item_url: string | null;
  detail_url: string | null;
};

export type InvoiceRow = {
  order_id: string;
  purchase_id: string | null;
  invoice_date: string | null;
  source: string | null;
  tx_type: string | null;
  items: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  access_key: string | null;
  number: string | null;
  issued_at: string | null;
  issuer_cnpj: string | null;
  issuer_name: string | null;
  total_cents: number | null;
  xml_items: string | null;
  fetched_at: string | null;
};

export type Store = {
  readonly db: Database;
  close(): void;
  transaction<T>(fn: () => T): T;

  upsertListItems(items: PurchaseListItem[], seenAt: string): void;
  applyDetail(
    purchaseId: string,
    detail: DetailPage,
    products: MergedProduct[],
    rawDetail: string,
    fetchedAt: string,
  ): void;
  upsertInvoice(purchaseId: string | undefined, overview: InvoiceOverview, fetchedAt: string): void;
  applyInvoiceXml(orderId: string, xml: InvoiceXml): void;
  replaceCategories(pairs: Array<[purchaseId: string, category: string]>): void;
  rebuildFts(): void;

  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
  counts(): { purchases: number; products: number; invoices: number };
  purchaseIds(): Set<string>;
  getPurchase(purchaseId: string): PurchaseRow | undefined;
  productsOf(purchaseId: string): ProductRow[];
  invoicesOf(purchaseId: string): InvoiceRow[];
  categoriesOf(purchaseId: string): string[];
  /** Purchases without a detail, plus non-final ones whose detail is older than the cutoff. */
  purchasesNeedingDetail(opts: { refreshNonFinalBefore?: string }): PurchaseRow[];
  productsWithoutPrice(): ProductRow[];
  searchProducts(query: string, limit: number): ProductRow[];
};

const flag = (value: boolean | undefined): number | null =>
  value === undefined ? null : value ? 1 : 0;
const json = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));
const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/** FTS5 query: every whitespace-separated term quoted, so user text never breaks the syntax. */
export function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"`)
    .join(" ");
}

export function createStore(db: Database): Store {
  const run = (sql: string, ...params: unknown[]) => db.query(sql).run(...(params as never[]));
  const all = <T>(sql: string, ...params: unknown[]) => db.query(sql).all(...(params as never[])) as T[];
  const one = <T>(sql: string, ...params: unknown[]) =>
    (db.query(sql).get(...(params as never[])) as T | null) ?? undefined;
  const transaction = <T>(fn: () => T): T => db.transaction(fn)() as T;

  function upsertProduct(item: PurchaseListItem): void {
    run(
      `INSERT INTO products (order_id, purchase_id, pack_id, shipment_id, item_id, title, title_norm, quantity,
         status, delivery_headline, delivered_at, is_full, image_url, item_url, detail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET
         purchase_id = excluded.purchase_id, pack_id = excluded.pack_id, shipment_id = excluded.shipment_id,
         item_id = COALESCE(excluded.item_id, products.item_id), quantity = excluded.quantity,
         status = excluded.status, delivery_headline = excluded.delivery_headline,
         delivered_at = excluded.delivered_at, is_full = excluded.is_full,
         image_url = COALESCE(excluded.image_url, products.image_url),
         item_url = COALESCE(excluded.item_url, products.item_url),
         detail_url = COALESCE(excluded.detail_url, products.detail_url)`,
      item.orderId, item.purchaseId, item.packId, orNull(item.shipmentId), orNull(item.itemId),
      item.productTitle, normalizeTitle(item.productTitle), item.quantity,
      orNull(item.status), orNull(item.deliveryHeadline), orNull(item.deliveredAt), flag(item.isFull),
      orNull(item.imageUrl), orNull(item.itemUrl), orNull(item.detailUrl),
    );
  }

  return {
    db,
    close: () => db.close(),
    transaction,

    upsertListItems(items, seenAt) {
      transaction(() => {
        // Purchases first: products reference them.
        for (const group of groupPurchases(items)) {
          const first = group.products[0] as PurchaseListItem;
          run(
            `INSERT INTO purchases (purchase_id, pack_id, order_id, shipment_id, vertical_id, purchase_date,
               date_label, status, is_full, list_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(purchase_id) DO UPDATE SET
               pack_id = excluded.pack_id, order_id = excluded.order_id, shipment_id = excluded.shipment_id,
               vertical_id = COALESCE(excluded.vertical_id, purchases.vertical_id),
               purchase_date = COALESCE(excluded.purchase_date, purchases.purchase_date),
               date_label = COALESCE(excluded.date_label, purchases.date_label),
               status = excluded.status, is_full = excluded.is_full, list_seen_at = excluded.list_seen_at`,
            group.purchaseId, group.detailRef.packId, group.detailRef.orderId, orNull(first.shipmentId),
            orNull(first.verticalId), orNull(group.purchaseDate), group.purchaseDateLabel,
            orNull(group.status), flag(group.products.some((product) => product.isFull)), seenAt,
          );
        }
        for (const item of items) upsertProduct(item);
      });
    },

    applyDetail(purchaseId, detail, products, rawDetail, fetchedAt) {
      transaction(() => {
        const { money, payment, seller, shipping } = detail;
        run(
          `UPDATE purchases SET
             purchase_date = COALESCE(?, purchase_date), date_label = COALESCE(?, date_label),
             seller_id = ?, seller_name = ?, is_official = ?, messages_url = ?,
             products_cents = ?, discount_cents = ?, coupons_cents = ?, shipping_cents = ?, total_cents = ?,
             interest_cents = ?, item_count = ?, extras = ?,
             installments = ?, installment_cents = ?, pay_method = ?, card_last4 = ?, payment_id = ?, payment_date = ?,
             address_line = ?, address_city = ?, has_invoice = ?, invoice_order_ids = ?,
             detail_fetched_at = ?, raw_detail = ?, warnings = ?
           WHERE purchase_id = ?`,
          orNull(detail.purchaseDate), orNull(detail.purchaseDateLabel),
          orNull(seller?.id), orNull(seller?.name), flag(seller?.isOfficialStore), orNull(seller?.messagesUrl),
          orNull(money.productsCents), orNull(money.discountCents), orNull(money.couponsCents),
          orNull(money.shippingCents), orNull(money.totalCents), orNull(money.interestCents),
          orNull(money.itemCount), json(money.extras),
          orNull(payment?.installments), orNull(payment?.installmentCents), orNull(payment?.method),
          orNull(payment?.cardLast4), orNull(payment?.paymentId), orNull(payment?.paymentDate),
          orNull(shipping.addressLine), orNull(shipping.addressCity),
          flag(detail.hasInvoice), json(detail.invoiceOrderIds),
          fetchedAt, rawDetail, json(detail.warnings), purchaseId,
        );
        for (const product of products) {
          if (!product.orderId || product.priceSource !== "detail") continue;
          run(
            `UPDATE products SET title = ?, title_norm = ?, list_cents = ?, paid_cents = ?, unit_cents = ?,
               price_source = 'detail', variations = ?,
               image_url = COALESCE(?, image_url), item_url = COALESCE(?, item_url),
               item_id = COALESCE(?, item_id)
             WHERE order_id = ?`,
            product.title, normalizeTitle(product.title), orNull(product.listCents), orNull(product.paidCents),
            orNull(product.unitCents), json(product.variations), orNull(product.imageUrl),
            orNull(product.itemUrl), orNull(product.itemId), product.orderId,
          );
        }
      });
    },

    upsertInvoice(purchaseId, overview, fetchedAt) {
      run(
        `INSERT INTO invoices (order_id, purchase_id, invoice_date, source, tx_type, items, pdf_url, xml_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET
           purchase_id = COALESCE(excluded.purchase_id, invoices.purchase_id),
           invoice_date = excluded.invoice_date, source = excluded.source, tx_type = excluded.tx_type,
           items = excluded.items, pdf_url = excluded.pdf_url, xml_url = excluded.xml_url,
           fetched_at = excluded.fetched_at`,
        overview.orderId, orNull(purchaseId), orNull(overview.invoiceDate), orNull(overview.source),
        orNull(overview.transactionType), json(overview.items), orNull(overview.pdfUrl),
        orNull(overview.xmlUrl), fetchedAt,
      );
    },

    applyInvoiceXml(orderId, xml) {
      transaction(() => {
        const product = one<ProductRow>("SELECT * FROM products WHERE order_id = ?", orderId);
        run(
          `INSERT INTO invoices (order_id, purchase_id) VALUES (?, ?)
           ON CONFLICT(order_id) DO NOTHING`,
          orderId, product?.purchase_id ?? null,
        );
        run(
          `UPDATE invoices SET access_key = ?, number = ?, issued_at = ?, issuer_cnpj = ?, issuer_name = ?,
             total_cents = ?, xml_items = ? WHERE order_id = ?`,
          orNull(xml.accessKey), orNull(xml.number), orNull(xml.issuedAt), orNull(xml.issuerCnpj),
          orNull(xml.issuerName), orNull(xml.totalCents), json(xml.items), orderId,
        );
        if (!product || xml.items.length === 0) return;
        // One order = one product: the NF-e lines are that product (spec §6.6).
        const lineCents = xml.items.reduce((sum, item) => sum + item.totalCents, 0);
        const quantity = product.quantity > 0 ? product.quantity : 1;
        const unitCents = Math.round(lineCents / quantity);
        run(
          `UPDATE products SET invoice_unit_cents = ?, invoice_line_cents = ? WHERE order_id = ?`,
          unitCents, lineCents, orderId,
        );
        if (product.price_source === "none") {
          run(
            `UPDATE products SET paid_cents = ?, unit_cents = ?, price_source = 'invoice' WHERE order_id = ?`,
            lineCents, unitCents, orderId,
          );
        }
      });
    },

    replaceCategories(pairs) {
      transaction(() => {
        run("DELETE FROM purchase_categories");
        for (const [purchaseId, category] of pairs) {
          run(
            "INSERT OR IGNORE INTO purchase_categories (purchase_id, category) VALUES (?, ?)",
            purchaseId, category,
          );
        }
      });
    },

    rebuildFts() {
      transaction(() => {
        run("DELETE FROM products_fts");
        run(
          `INSERT INTO products_fts (order_id, title, variations)
           SELECT order_id, title, COALESCE(variations, '') FROM products`,
        );
      });
    },

    getState: (key) => one<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", key)?.value,
    setState(key, value) {
      run("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)", key, value);
    },

    counts() {
      const count = (table: string) =>
        (one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`) as { n: number }).n;
      return { purchases: count("purchases"), products: count("products"), invoices: count("invoices") };
    },

    purchaseIds: () =>
      new Set(all<{ purchase_id: string }>("SELECT purchase_id FROM purchases").map((row) => row.purchase_id)),

    getPurchase: (purchaseId) =>
      one<PurchaseRow>("SELECT * FROM purchases WHERE purchase_id = ?", purchaseId),

    productsOf: (purchaseId) =>
      all<ProductRow>("SELECT * FROM products WHERE purchase_id = ? ORDER BY rowid", purchaseId),

    invoicesOf: (purchaseId) =>
      all<InvoiceRow>("SELECT * FROM invoices WHERE purchase_id = ? ORDER BY order_id", purchaseId),

    categoriesOf: (purchaseId) =>
      all<{ category: string }>(
        "SELECT category FROM purchase_categories WHERE purchase_id = ? ORDER BY rowid",
        purchaseId,
      ).map((row) => row.category),

    purchasesNeedingDetail({ refreshNonFinalBefore }) {
      const placeholders = FINAL_STATUSES.map(() => "?").join(", ");
      return all<PurchaseRow>(
        `SELECT * FROM purchases
         WHERE detail_fetched_at IS NULL
            OR (? IS NOT NULL AND detail_fetched_at < ? AND COALESCE(status, '') NOT IN (${placeholders}))
         ORDER BY purchase_date DESC, rowid`,
        refreshNonFinalBefore ?? null, refreshNonFinalBefore ?? null, ...FINAL_STATUSES,
      );
    },

    productsWithoutPrice: () =>
      all<ProductRow>("SELECT * FROM products WHERE price_source = 'none' ORDER BY rowid"),

    searchProducts(query, limit) {
      const match = ftsQuery(query);
      if (!match) return [];
      return all<ProductRow>(
        `SELECT p.* FROM products_fts f JOIN products p ON p.order_id = f.order_id
         WHERE products_fts MATCH ? ORDER BY rank LIMIT ?`,
        match, limit,
      );
    },
  };
}
