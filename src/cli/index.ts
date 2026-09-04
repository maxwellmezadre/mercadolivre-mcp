import { Command } from "commander";
import { interactiveLogin } from "../auth/login.js";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { compactObject, runTool } from "../tools/define.js";
import { toolByName } from "../tools/registry.js";

// Commander program (F-17). Every command maps onto a registry tool and calls
// `runTool`, so CLI and MCP share validation and behaviour (AR-1). stdout
// carries only the result; errors and prompts go to stderr.

function formatValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function formatHuman(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  if (Array.isArray(result)) return result.map(formatValue).join("\n");
  return Object.entries(result)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n");
}

async function invoke(
  toolName: string,
  args: Record<string, unknown>,
  json: boolean,
): Promise<void> {
  try {
    const tool = toolByName(toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}`);
    const ctx = createContext(loadConfig());
    const result = await runTool(tool, compactObject(args), ctx);
    console.log(json ? JSON.stringify(result, null, 2) : formatHuman(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function toNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("mercadolivre")
    .description("Mercado Livre purchase history — CLI and MCP server")
    .version(version);

  // Every command accepts --json for structured output.
  const command = (signature: string) =>
    program.command(signature).option("--json", "structured JSON output");

  command("status")
    .description("Show whether a Mercado Livre session is configured")
    .option("--verify", "also request the purchases page to confirm the session")
    .action((options) =>
      invoke("auth_status", { verify: options.verify ?? false }, options.json ?? false),
    );

  command("purchases")
    .description("List purchases (grouped by purchase) with optional filters")
    .option("--date <filter>", "ALL, 30D, 3M, 6M, Y, 1Y..4Y")
    .option("--category <name>", "exact category name (see categories)")
    .option("--search <text>", "free text search")
    .option("--from <date>", "cache: purchase date >= YYYY-MM-DD")
    .option("--to <date>", "cache: purchase date <= YYYY-MM-DD")
    .option("--limit <n>", "cache: maximum purchases (default 50)")
    .option("--offset <n>", "cache: purchases to skip")
    .option("--live", "read the site instead of the cache")
    .option("--page <n>", "site: first page (default 1)")
    .option("--max-pages <n>", "site: consecutive pages to read (default 1)")
    .action((options) =>
      invoke(
        "list_purchases",
        {
          fromCache: options.live ? false : undefined,
          dateFilter: options.date,
          category: options.category,
          search: options.search,
          from: options.from,
          to: options.to,
          limit: toNumber(options.limit),
          offset: toNumber(options.offset),
          page: toNumber(options.page),
          maxPages: toNumber(options.maxPages),
        },
        options.json ?? false,
      ),
    );

  command("purchase <purchaseId>")
    .description("Full detail of one purchase (money, installments, products, seller, invoice)")
    .option("--pack <packId>", "pack id paired with --order")
    .option("--order <orderId>", "order id paired with --pack")
    .option("--no-invoice", "skip the NF-e metadata")
    .option("--max-lookup-pages <n>", "pages to scan when --pack/--order are missing")
    .action((purchaseId: string, options) =>
      invoke(
        "get_purchase",
        {
          purchaseId,
          packId: options.pack,
          orderId: options.order,
          includeInvoice: options.invoice,
          maxLookupPages: toNumber(options.maxLookupPages),
        },
        options.json ?? false,
      ),
    );

  command("search <query>")
    .description("Search the purchase history by product title, brand or variation")
    .option("--live", "ask the site instead of the cache")
    .option("--limit <n>", "cache: maximum products")
    .action((query: string, options) =>
      invoke(
        "search_purchases",
        { query, scope: options.live ? "live" : undefined, limit: toNumber(options.limit) },
        options.json ?? false,
      ),
    );

  command("categories")
    .description("Category names and time windows accepted by the purchase filters")
    .action((options) => invoke("list_categories", {}, options.json ?? false));

  command("products")
    .description("Purchased products from the cache, with prices paid")
    .option("--from <date>", "purchase date >= YYYY-MM-DD")
    .option("--to <date>", "purchase date <= YYYY-MM-DD")
    .option("--seller <name>", "seller name (partial) or id")
    .option("--min-paid <brl>", "minimum amount paid for the line")
    .option("--max-paid <brl>", "maximum amount paid for the line")
    .option("--title <text>", "text contained in the title")
    .option("--sort <order>", "date_desc, date_asc, paid_desc or paid_asc")
    .option("--limit <n>", "maximum rows (default 100)")
    .option("--include-cancelled", "include cancelled purchases")
    .action((options) =>
      invoke(
        "list_products",
        {
          from: options.from,
          to: options.to,
          seller: options.seller,
          minPaid: toNumber(options.minPaid),
          maxPaid: toNumber(options.maxPaid),
          titleContains: options.title,
          sort: options.sort,
          limit: toNumber(options.limit),
          includeCancelled: options.includeCancelled,
        },
        options.json ?? false,
      ),
    );

  command("product-history")
    .description("Every purchase of one product and its unit price trend")
    .option("--item <itemId>", "item id, e.g. MLB2086446083")
    .option("--title <text>", "text contained in the title")
    .action((options) =>
      invoke(
        "product_history",
        { itemId: options.item, titleContains: options.title },
        options.json ?? false,
      ),
    );

  command("invoice <orderId>")
    .description("NF-e metadata and download links of one order")
    .action((orderId: string, options) =>
      invoke("get_invoice", { orderId }, options.json ?? false),
    );

  command("sync")
    .description("Synchronize the local cache (incremental by default; --full once, --reparse offline)")
    .option("--full", "walk every page and category")
    .option("--reparse", "re-run the parsers on cached pages, no network")
    .option("--max-pages <n>", "safety cap on list pages (default 10)")
    .option("--no-details", "skip purchase details")
    .option("--no-invoices", "skip NF-e overviews and xml")
    .option("--no-categories", "skip the category pass")
    .action((options) =>
      invoke(
        "sync",
        {
          mode: options.reparse ? "reparse" : options.full ? "full" : "incremental",
          maxPages: toNumber(options.maxPages),
          withDetails: options.details,
          withInvoices: options.invoices,
          withCategories: options.categories,
        },
        options.json ?? false,
      ),
    );

  command("raw <url>")
    .description("Authenticated GET on an allowed Mercado Livre host (rediscovery)")
    .option("--as <mode>", "html, json or nordic", "html")
    .option("--max-bytes <n>", "cap the returned body")
    .action((url: string, options) =>
      invoke(
        "raw_get",
        { url, as: options.as, maxBytes: toNumber(options.maxBytes) },
        options.json ?? false,
      ),
    );

  program
    .command("login")
    .description(
      "Open a browser window to log in; the session is saved locally (this tool never sees the password)",
    )
    .action(async () => {
      try {
        const result = await interactiveLogin(createContext(loadConfig()));
        console.error(`Session saved to ${result.sessionFile} (${result.cookieCount} cookies).`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command("mcp")
    .description("Start the MCP server (stdio)")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(createContext(loadConfig()), version);
    });

  await program.parseAsync(argv);
}
