// Raw shapes of the Flox/Nordic payload (spec §5) and the canonical model the
// parsers produce (spec §7). Raw fields are optional on purpose: bricks are
// server-driven UI and any field may be absent. Money is integer cents (AR-7)
// and every Mercado Livre id is a numeric string that must never become a
// JavaScript number.

// ---------------------------------------------------------------- raw shapes

export type RichNode = {
  type: string;
  value?: {
    text?: string;
    symbol?: string;
    fraction?: string;
    cents?: string;
    /** `"strike"` marks the crossed-out list price. */
    modifier?: string;
    id?: string;
  };
  /** Older node shape: the text sits at the top level. */
  text?: string;
};

export type PriceNode = {
  type: "price";
  value: { symbol?: string; fraction: string; cents?: string; modifier?: string };
};

/** Every textual field: structured nodes plus a prose rendering. */
export type RichText = { rich?: RichNode[]; accessibility?: string; text?: string };

export type Brick = {
  /** `{ui_type}_{hex}`; the hex suffix changes on every render. */
  id?: string;
  ui_type?: string;
  data?: Record<string, unknown>;
  /** Children (the key is `bricks`, not `children`). */
  bricks?: Brick[];
};

/** Detail pages ship a flat `id -> brick` map instead of a tree. */
export type BrickStack = Record<string, Brick>;

export type PageProps = {
  errorType?: string;
  httpStatus?: number;
  title?: string;
  floxResponse?: {
    data?: { brick?: Brick; events?: Array<{ data?: { brick?: Brick } }> };
  };
  floxPreloadedState?: Record<string, { brickStack?: BrickStack }>;
};

export type NordicCtx = { appProps?: { pageProps?: PageProps } };

// ---------------------------------------------------------- canonical model

/**
 * Identity hierarchy (spec §6.5): purchase (checkout) > pack (parcel) >
 * order (ONE product) > shipment. `packId` and `orderId` always come from
 * the same list item (AR-10).
 */
export type PurchaseIds = {
  /** The checkout; "Compra número N" in the UI. Aggregation key (AR-8). */
  purchaseId: string;
  /** Logistic parcel inside the purchase. */
  packId: string;
  /** One product. Used by the detail page and the invoice endpoints. */
  orderId: string;
  /** Shared by the orders of the same pack. */
  shipmentId?: string;
  /** "SHIPPING", "SERVICES", ... */
  verticalId?: string;
};

/** One row of the purchases list = one order = one product (spec §6.2). */
export type PurchaseListItem = PurchaseIds & {
  /** ISO date derived from the enclosing group label. */
  purchaseDate?: string;
  /** "27 de agosto" / "3 de julho de 2024", as rendered. */
  purchaseDateLabel: string;
  /** "Entregue", "A caminho", "Cancelado", ... */
  status?: string;
  /** "Chegou no dia 29 de agosto. Enviado por FULL" */
  deliveryHeadline?: string;
  /** ISO date when the headline says the parcel arrived. */
  deliveredAt?: string;
  isFull: boolean;
  /** Raw product label from the list (title + quantity + attributes prose). */
  productTitle: string;
  quantity: number;
  /** "MLB2086446083" */
  itemId?: string;
  itemUrl?: string;
  imageUrl?: string;
  detailUrl?: string;
};

export type DateFilter = { value: string; label: string };

export type ListPage = {
  page: number;
  totalPages: number;
  /** "68 compras" / '3 compras contêm "cafe"' */
  totalLabel?: string;
  /** Values accepted by the category filter. */
  categories: string[];
  dateFilters: DateFilter[];
  items: PurchaseListItem[];
};

/** Orders of the list grouped by purchase (AR-8). */
export type PurchaseGroup = {
  purchaseId: string;
  purchaseDate?: string;
  purchaseDateLabel: string;
  /** Most frequent status among the orders. */
  status?: string;
  orderCount: number;
  totalUnits: number;
  packIds: string[];
  /** A valid pair for the detail page: the first order's own pack and order. */
  detailRef: { packId: string; orderId: string };
  products: PurchaseListItem[];
};

// ------------------------------------------------------------ detail page

/** Financial breakdown of the WHOLE purchase (spec §6.4 `ticket_row`). */
export type MoneyBreakdown = {
  /** Sum of the items at list price. */
  productsCents?: number;
  /** Negative. */
  discountCents?: number;
  /** Negative. */
  couponsCents?: number;
  /** 0 when free. */
  shippingCents?: number;
  totalCents?: number;
  /** Installment interest: total minus the rest, only when paying in N > 1. */
  interestCents?: number;
  /** Units in the purchase, from the "Produtos (N)" label. */
  itemCount?: number;
  /** Labels the parser does not know, normalized, with their cents. */
  extras: Record<string, number>;
  currency: "BRL";
};

export type Payment = {
  /** 1 = paid in full. */
  installments: number;
  installmentCents: number;
  /** installments * installmentCents. */
  totalCents: number;
  /** "Mastercard", "Pix", "Boleto", "Saldo em conta", ... */
  method?: string;
  cardLast4?: string;
  paymentDate?: string;
  /** Mercado Pago payment id: the bridge to a card statement. */
  paymentId?: string;
  /** Original prose, for auditing. */
  raw: string;
};

export type ShippingAddress = { addressLine?: string; addressCity?: string };

export type Seller = {
  id?: string;
  name?: string;
  isOfficialStore: boolean;
  messagesUrl?: string;
};

/** One `row_with_ellipsis`: prices are LINE TOTALS, already times quantity. */
export type DetailProduct = {
  title: string;
  quantity: number;
  listCents?: number;
  paidCents?: number;
  variations: Record<string, string>;
  itemId?: string;
  imageUrl?: string;
  itemUrl?: string;
};

/** Facts of the detail page; the product inventory comes from the list (spec §6.5). */
export type DetailPage = {
  purchaseId?: string;
  purchaseDateLabel?: string;
  purchaseDate?: string;
  money: MoneyBreakdown;
  payment?: Payment;
  shipping: ShippingAddress;
  seller?: Seller;
  /** Subset of the purchase's products (complete only for small purchases). */
  products: DetailProduct[];
  /** Title of the order the page was queried with (`context_with_ellipsis`). */
  queriedProductTitle?: string;
  invoiceOrderIds: string[];
  hasInvoice: boolean;
  /** Invariant violations, reported instead of hidden. */
  warnings: string[];
};

// ---------------------------------------------------------------- invoices

/** One entry of `/emissor/omni/api/invoices-overview` (spec §4.4). */
export type InvoiceOverview = {
  /** Derived from the download url; the payload carries no order id field. */
  orderId: string;
  invoiceDate?: string;
  source?: string;
  transactionType?: string;
  items: Array<{ id: string; name: string }>;
  pdfUrl?: string;
  xmlUrl?: string;
};

/** One `<det>` of an NF-e 4.00 XML. Values are GROSS (before purchase-level discounts). */
export type InvoiceXmlItem = {
  code?: string;
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  discountCents: number;
  ncm?: string;
  cfop?: string;
};

export type InvoiceXml = {
  /** 44-digit access key. */
  accessKey?: string;
  number?: string;
  issuedAt?: string;
  issuerCnpj?: string;
  issuerName?: string;
  totalCents?: number;
  items: InvoiceXmlItem[];
};
