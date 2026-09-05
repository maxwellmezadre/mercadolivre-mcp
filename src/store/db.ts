import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

// Infrastructure adapter for the local cache (AR-6, ADR-0002): bun:sqlite,
// synchronous, zero dependencies. The file holds personal data (addresses,
// card digits, consumption history), so it is created with mode 0600 (NFR-5).
// WAL lets the CLI `sync` and the MCP server share the file; migrations are
// ordered and tracked in `user_version`.

export const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  // v1 — spec §10.2, revised: integer cents, price provenance, categories.
  `
  CREATE TABLE purchases (
    purchase_id       TEXT PRIMARY KEY,
    pack_id           TEXT,
    order_id          TEXT,
    shipment_id       TEXT,
    vertical_id       TEXT,
    purchase_date     TEXT,
    date_label        TEXT,
    status            TEXT,
    is_full           INTEGER,
    seller_id         TEXT,
    seller_name       TEXT,
    is_official       INTEGER,
    messages_url      TEXT,
    products_cents    INTEGER,
    discount_cents    INTEGER,
    coupons_cents     INTEGER,
    shipping_cents    INTEGER,
    total_cents       INTEGER,
    interest_cents    INTEGER,
    refund_cents      INTEGER,
    item_count        INTEGER,
    extras            TEXT,
    installments      INTEGER,
    installment_cents INTEGER,
    pay_method        TEXT,
    card_last4        TEXT,
    payment_id        TEXT,
    payment_date      TEXT,
    payments          TEXT,
    address_line      TEXT,
    address_city      TEXT,
    has_invoice       INTEGER,
    invoice_order_ids TEXT,
    list_seen_at      TEXT,
    detail_fetched_at TEXT,
    raw_detail        TEXT,
    warnings          TEXT
  );

  CREATE TABLE products (
    order_id           TEXT PRIMARY KEY,
    purchase_id        TEXT NOT NULL REFERENCES purchases(purchase_id) ON DELETE CASCADE,
    pack_id            TEXT,
    shipment_id        TEXT,
    item_id            TEXT,
    title              TEXT NOT NULL,
    title_norm         TEXT,
    quantity           INTEGER NOT NULL DEFAULT 1,
    status             TEXT,
    delivery_headline  TEXT,
    delivered_at       TEXT,
    is_full            INTEGER,
    list_cents         INTEGER,
    paid_cents         INTEGER,
    unit_cents         INTEGER,
    price_source       TEXT NOT NULL DEFAULT 'none',
    invoice_unit_cents INTEGER,
    invoice_line_cents INTEGER,
    variations         TEXT,
    image_url          TEXT,
    item_url           TEXT,
    detail_url         TEXT
  );
  CREATE INDEX idx_products_purchase ON products(purchase_id);
  CREATE INDEX idx_products_item ON products(item_id);

  CREATE TABLE invoices (
    order_id     TEXT PRIMARY KEY,
    purchase_id  TEXT,
    invoice_date TEXT,
    source       TEXT,
    tx_type      TEXT,
    items        TEXT,
    pdf_url      TEXT,
    xml_url      TEXT,
    access_key   TEXT,
    number       TEXT,
    issued_at    TEXT,
    issuer_cnpj  TEXT,
    issuer_name  TEXT,
    total_cents  INTEGER,
    xml_items    TEXT,
    fetched_at   TEXT
  );
  CREATE INDEX idx_invoices_purchase ON invoices(purchase_id);

  CREATE TABLE purchase_categories (
    purchase_id TEXT NOT NULL,
    category    TEXT NOT NULL,
    PRIMARY KEY (purchase_id, category)
  );

  CREATE TABLE sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE VIRTUAL TABLE products_fts USING fts5(
    order_id UNINDEXED,
    title,
    variations,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

export function migrate(db: Database): void {
  const { user_version: current } = db.query("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

function restrict(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

/** Opens (creating and migrating if needed) the cache. `:memory:` for tests. */
export function openDatabase(path: string): Database {
  if (path === ":memory:") {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
    return db;
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // The file must never be readable by other users, whatever the umask.
  const previous = process.umask(0o077);
  let db: Database;
  try {
    db = new Database(path, { create: true });
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
  } finally {
    process.umask(previous);
  }
  restrict(path);
  return db;
}
