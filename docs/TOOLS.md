# Tools

Referência das tools MCP, gerada por `bun run scripts/gen-tools-doc.ts` a partir do registry.
Os comandos equivalentes da CLI estão em [CLI.md](CLI.md). Valores monetários saem em BRL (reais);
as datas são `YYYY-MM-DD`.

Total: 16 tools. *Read-only* indica que a tool não escreve nada no disco local
(a conta do Mercado Livre é somente leitura em todas elas).

## `auth_status`

*Read-only.*

Checks whether a Mercado Livre session is configured and, with verify=true, whether the site still accepts it. Returns the session source, nickname, user id, cookie count and the earliest cookie expiry. Start here when another tool reports a session problem.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | não | Also perform one request to the purchases page to confirm the session is accepted (default false) |

## `doctor`

*Read-only.*

Diagnoses the setup end to end: session, purchases list page, JSON list endpoint, purchase detail page, money identity, invoices overview and the local cache. Names the endpoint that broke when Mercado Livre changes something; run it before reporting a problem. Costs up to four requests.

Sem parâmetros.

## `list_purchases`

*Read-only.*

Lists Mercado Livre purchases grouped by purchase (one purchase = one checkout; one product per order inside it), newest first. Reads the local cache by default (run sync first; falls back to the site while the cache is empty; fromCache=false forces the site). Filters: time window (dateFilter) or explicit from/to dates, exact category (see list_categories) and free-text search. Returns money in BRL and the detailRef needed by get_purchase.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `fromCache` | boolean | não | Read the local cache (default true) |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year) |
| `from` | string | não | Cache only: purchase date >= YYYY-MM-DD |
| `to` | string | não | Cache only: purchase date <= YYYY-MM-DD |
| `category` | string | não | Exact category name from list_categories |
| `search` | string | não | Free text: product title or brand |
| `limit` | integer (min 1, max 500) | não | Cache only: maximum purchases (default 50) |
| `offset` | integer (min 0) | não | Cache only: purchases to skip (default 0) |
| `page` | integer (min 1) | não | Site only: first page to read (default 1) |
| `maxPages` | integer (min 1, max 50) | não | Site only: consecutive pages to read (default 1) |

## `get_purchase`

*Read-only.*

Full detail of one purchase: money breakdown (products, discount, coupons, shipping, total), installments and card, delivery address, seller, every product with list/paid/unit price and variations, and the NF-e invoice metadata. packId and orderId must come from the same list item (list_purchases gives a valid detailRef); without them the tool looks the purchase up in the cache, then scans the purchase list (one request per page).

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `purchaseId` | string | sim | Purchase id ('Compra número N') |
| `packId` | string | não | Pack id paired with orderId |
| `orderId` | string | não | Order id paired with packId |
| `includeInvoice` | boolean | não | Fetch NF-e metadata too (default true) |
| `maxLookupPages` | integer (min 1, max 50) | não | Pages to scan when the pair is missing (default 10) |

## `search_purchases`

*Read-only.*

Searches the purchase history by product title, brand or variation. scope=cache (default) is a full-text search over the local cache and names the matching products per purchase; scope=live asks the site (first page of results only).

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `query` | string | sim | Words to look for |
| `scope` | `cache` \| `live` | não | cache (default) or live |
| `limit` | integer (min 1, max 500) | não | Cache only: maximum products (default 100) |

## `list_categories`

*Read-only.*

Lists the category names accepted by list_purchases (category) and the available time windows. Uses the categories saved by the last sync, or the site when the cache is empty.

Sem parâmetros.

## `list_products`

*Read-only.*

Lists purchased products from the local cache (run sync first) with the price paid, unit price, quantity, variations and seller. Filters by date range, seller, price range and title. Cancelled purchases are left out unless includeCancelled=true. Amounts in BRL.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `from` | string | não | Purchase date >= YYYY-MM-DD |
| `to` | string | não | Purchase date <= YYYY-MM-DD |
| `seller` | string | não | Seller name (partial) or seller id |
| `minPaid` | number (min 0) | não | Minimum amount paid for the line, in BRL |
| `maxPaid` | number (min 0) | não | Maximum amount paid for the line, in BRL |
| `titleContains` | string | não | Text contained in the product title |
| `sort` | `date_desc` \| `date_asc` \| `paid_desc` \| `paid_asc` | não | Sort order (default date_desc) |
| `limit` | integer (min 1, max 1000) | não | Maximum rows (default 100) |
| `includeCancelled` | boolean | não | Include cancelled purchases (default false) |

## `product_history`

*Read-only.*

Every purchase of one product (by item id or title text) from the local cache, oldest first, with the unit price trend: useful for 'how much did I pay for this before?' and repurchase questions. Amounts in BRL.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `itemId` | string | não | Item id, e.g. MLB2086446083 |
| `titleContains` | string | não | Text contained in the product title |

## `spending_summary`

*Read-only.*

Spending summary from the local cache: total paid, discounts, coupons, shipping, purchase and product counts and average ticket, grouped by month (default), year, seller, category or none. Accepts a time window (dateFilter) or explicit from/to dates. Cancelled purchases are excluded unless includeCancelled=true. Amounts in BRL.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year) |
| `from` | string | não | Purchase date >= YYYY-MM-DD |
| `to` | string | não | Purchase date <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Include cancelled purchases (default false) |
| `groupBy` | `month` \| `year` \| `seller` \| `category` \| `none` | não | month (default), year, seller, category or none |

## `list_installments`

*Read-only.*

Purchases paid in installments, from the local cache: installment count and value, card, payment date and an ESTIMATE of how many installments are still open and when the last one falls (the site does not expose the real schedule). monthlyCommitment sums the open installments. onlyMultiple=false lists every paid purchase. Amounts in BRL.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year) |
| `from` | string | não | Purchase date >= YYYY-MM-DD |
| `to` | string | não | Purchase date <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Include cancelled purchases (default false) |
| `onlyMultiple` | boolean | não | Only purchases with 2+ installments (default true) |

## `list_payment_methods`

*Read-only.*

Payment methods used in the purchases of the local cache (card brand plus last digits, Pix, boleto, account balance), with how many purchases and how much went through each, biggest first. Amounts in BRL.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year) |
| `from` | string | não | Purchase date >= YYYY-MM-DD |
| `to` | string | não | Purchase date <= YYYY-MM-DD |
| `includeCancelled` | boolean | não | Include cancelled purchases (default false) |

## `get_invoice`

*Read-only.*

NF-e invoice metadata of one order (invoice date, items, PDF and XML links). Orders are one product each; get_purchase lists them under invoiceOrderIds.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `orderId` | string | sim | Order id (one product) |

## `download_invoice`

*Escreve no disco (cache ou downloads).*

Downloads the NF-e of one order as PDF or XML into the configured download directory (MERCADOLIVRE_DOWNLOAD_DIR, default ~/Downloads/mercadolivre-nfe) and returns the file path. The XML carries the exact unit value of the product (vUnCom), gross of purchase-level discounts.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `orderId` | string | sim | Order id (one product); see get_purchase invoiceOrderIds |
| `format` | `pdf` \| `xml` | sim | pdf or xml |
| `fileName` | string | não | File name inside the download directory (default nfe-<orderId>.<format>) |

## `export_invoices`

*Escreve no disco (cache ou downloads).*

Downloads every NF-e known to the local cache for a period (run sync with invoices first) into the configured download directory, as PDF, XML or both. Files that already exist are skipped unless overwrite=true; cancelled purchases are left out unless includeCancelled=true. Useful for bookkeeping.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `dateFilter` | `ALL` \| `30D` \| `3M` \| `6M` \| `Y` \| `1Y` \| `2Y` \| `3Y` \| `4Y` | não | Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year) |
| `from` | string | não | Purchase date >= YYYY-MM-DD |
| `to` | string | não | Purchase date <= YYYY-MM-DD |
| `format` | `pdf` \| `xml` \| `both` | não | pdf, xml or both (default both) |
| `overwrite` | boolean | não | Download again over existing files (default false) |
| `includeCancelled` | boolean | não | Include cancelled purchases (default false) |

## `sync`

*Escreve no disco (cache ou downloads).*

Synchronizes the local cache with the Mercado Livre purchase history (the account is only read). mode=incremental (default) refreshes the newest pages and non-final purchases; mode=full walks every page and category (do it once; a full sync of ~70 purchases takes about 3 minutes at one request per second); mode=reparse re-runs the parsers on cached pages with no network. Returns a report with counts, warnings and errors.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `mode` | `incremental` \| `full` \| `reparse` | não | incremental (default), full or reparse |
| `maxPages` | integer (min 1, max 100) | não | Safety cap on list pages per walk (default 10) |
| `withDetails` | boolean | não | Fetch purchase details (default true) |
| `withInvoices` | boolean | não | Fetch NF-e overviews and XML values (default true) |
| `withCategories` | boolean | não | Run the category pass (default true) |

## `raw_get`

*Read-only.*

Authenticated GET on an allowed Mercado Livre host (myaccount.mercadolivre.com.br, www.mercadolivre.com.br), for rediscovering endpoints when the site changes. as=html returns the page text, as=json parses a JSON endpoint, as=nordic extracts the server-rendered brick tree plus a ui_type census. Output is capped at maxBytes.

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `url` | string | sim | Absolute URL or a path (paths resolve against myaccount.mercadolivre.com.br) |
| `as` | `html` \| `json` \| `nordic` | não | How to read the response (default html) |
| `maxBytes` | integer (min 1024, max 1000000) | não | Maximum characters returned in body (default 65536) |
