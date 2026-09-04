// Raw shapes of the Flox/Nordic payload (spec §5). Everything is optional on
// purpose: bricks are server-driven UI and any field may be absent. Parsers
// (AR-5) turn these into the canonical model declared further down.

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
