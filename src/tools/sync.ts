import { Type } from "@sinclair/typebox";
import { runSync } from "../sync/sync.js";
import { defineTool } from "./define.js";

// F-14: the only tool that talks to Mercado Livre in volume. Every query
// tool reads the cache this one fills (AR-6). Writes the local cache, so it
// is not read-only from the disk's point of view.

export const sync = defineTool({
  name: "sync",
  description:
    "Synchronizes the local cache with the Mercado Livre purchase history (the account is only read). " +
    "mode=incremental (default) refreshes the newest pages and non-final purchases; mode=full walks every page " +
    "and category (do it once; a full sync of ~70 purchases takes about 3 minutes at one request per second); " +
    "mode=reparse re-runs the parsers on cached pages with no network. Returns a report with counts, warnings and errors.",
  readOnly: false,
  input: Type.Object({
    mode: Type.Optional(
      Type.Union([Type.Literal("incremental"), Type.Literal("full"), Type.Literal("reparse")], {
        description: "incremental (default), full or reparse",
      }),
    ),
    maxPages: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, description: "Safety cap on list pages per walk (default 10)" }),
    ),
    withDetails: Type.Optional(Type.Boolean({ description: "Fetch purchase details (default true)" })),
    withInvoices: Type.Optional(Type.Boolean({ description: "Fetch NF-e overviews and XML values (default true)" })),
    withCategories: Type.Optional(Type.Boolean({ description: "Run the category pass (default true)" })),
  }),
  run: (args, ctx) => runSync({ ...ctx, store: ctx.store() }, args),
});
