import { Command } from "commander";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { compactObject, runTool } from "../tools/define.js";
import { activeTools, toolByName } from "../tools/registry.js";

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
    const config = loadConfig();
    const tool = activeTools(config).find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new Error(
        toolByName(toolName)
          ? `A tool ${toolName} não está disponível com MERCADOLIVRE_READ_ONLY=1.`
          : `Tool desconhecida: ${toolName}`,
      );
    }
    const ctx = createContext(config);
    const result = await runTool(tool, compactObject(args), ctx);
    // Await the write: a large result piped to a slow reader is truncated when
    // the process exits before stdout drains.
    await new Promise<void>((resolve, reject) =>
      process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatHuman(result)}\n`, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function toNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

const PERIOD = "ALL, 30D, 3M, 6M, Y, 1Y..4Y";

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("mercadolivre")
    .description("Histórico de compras do Mercado Livre: CLI e servidor MCP")
    .version(version);

  // Every command accepts --json for structured output.
  const command = (signature: string) =>
    program.command(signature).option("--json", "saída em JSON");

  command("status")
    .description("Mostra a sessão salva (origem, apelido, validade dos cookies)")
    .option("--verify", "gasta 1 requisição para confirmar que o site aceita a sessão")
    .action((options) =>
      invoke("auth_status", { verify: options.verify ?? false }, options.json ?? false),
    );

  command("login")
    .description("Abre o navegador para você entrar na conta e salva a sessão cifrada")
    .option("--fresh", "apaga o perfil do navegador de automação antes")
    .option("--from-browser <navegador>", "importa a sessão de um navegador já logado (macOS): dia|arc|chrome|chromium|brave|edge")
    .action((options) =>
      invoke("login", { fresh: options.fresh, from_browser: options.fromBrowser }, options.json ?? false),
    );

  command("doctor")
    .description("Diagnóstico camada a camada: sessão, cada endpoint do site e o cache")
    .action((options) => invoke("doctor", {}, options.json ?? false));

  command("sync")
    .description("Sincroniza o cache local (incremental por padrão; --full uma vez; --reparse sem rede)")
    .option("--full", "percorre todas as páginas e categorias")
    .option("--reparse", "reprocessa as páginas em cache, sem rede")
    .option("--max-pages <n>", "teto de páginas da lista (default 10)")
    .option("--no-details", "pula o detalhe das compras")
    .option("--no-invoices", "pula o overview e o XML das NF-e")
    .option("--no-categories", "pula a passada por categoria")
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

  command("purchases")
    .description("Lista as compras (agrupadas por compra) com filtros")
    .option("--date <filtro>", PERIOD)
    .option("--category <nome>", "nome exato da categoria (veja categories)")
    .option("--search <texto>", "busca por texto")
    .option("--from <data>", "cache: data da compra >= YYYY-MM-DD")
    .option("--to <data>", "cache: data da compra <= YYYY-MM-DD")
    .option("--limit <n>", "cache: máximo de compras (default 50)")
    .option("--offset <n>", "cache: compras a pular")
    .option("--live", "lê o site em vez do cache")
    .option("--page <n>", "site: primeira página (default 1)")
    .option("--max-pages <n>", "site: páginas consecutivas a ler (default 1)")
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
    .description("Detalhe completo de uma compra (financeiro, parcelas, produtos, vendedor, NF-e)")
    .option("--pack <packId>", "id do pacote, par de --order")
    .option("--order <orderId>", "id do pedido, par de --pack")
    .option("--no-invoice", "pula os metadados da NF-e")
    .option("--max-lookup-pages <n>", "páginas a varrer quando --pack/--order não são informados")
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

  command("search <texto>")
    .description("Busca no histórico por título, marca ou variação do produto")
    .option("--live", "pergunta ao site em vez do cache")
    .option("--limit <n>", "cache: máximo de produtos")
    .action((query: string, options) =>
      invoke(
        "search_purchases",
        { query, scope: options.live ? "live" : undefined, limit: toNumber(options.limit) },
        options.json ?? false,
      ),
    );

  command("categories")
    .description("Categorias e janelas de tempo aceitas pelos filtros")
    .action((options) => invoke("list_categories", {}, options.json ?? false));

  command("products")
    .description("Produtos comprados, do cache, com preço pago e unitário")
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .option("--seller <nome>", "nome (parcial) ou id do vendedor")
    .option("--min-paid <reais>", "valor mínimo pago na linha")
    .option("--max-paid <reais>", "valor máximo pago na linha")
    .option("--title <texto>", "texto contido no título")
    .option("--sort <ordem>", "date_desc, date_asc, paid_desc ou paid_asc")
    .option("--limit <n>", "máximo de linhas (default 100)")
    .option("--include-cancelled", "inclui compras canceladas")
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
    .description("Cada compra de um produto e a evolução do preço unitário")
    .option("--item <itemId>", "id do item, por exemplo MLB2086446083")
    .option("--title <texto>", "texto contido no título")
    .action((options) =>
      invoke(
        "product_history",
        { itemId: options.item, titleContains: options.title },
        options.json ?? false,
      ),
    );

  command("spending")
    .description("Resumo de gastos do cache, por mês, ano, vendedor, categoria ou sem agrupar")
    .option("--by <chave>", "month (default), year, seller, category ou none")
    .option("--date <filtro>", PERIOD)
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .option("--include-cancelled", "inclui compras canceladas")
    .action((options) =>
      invoke(
        "spending_summary",
        {
          groupBy: options.by,
          dateFilter: options.date,
          from: options.from,
          to: options.to,
          includeCancelled: options.includeCancelled,
        },
        options.json ?? false,
      ),
    );

  command("installments")
    .description("Compras parceladas, com a estimativa do que ainda falta pagar")
    .option("--all", "toda compra paga, não só as de 2 ou mais parcelas")
    .option("--date <filtro>", PERIOD)
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .action((options) =>
      invoke(
        "list_installments",
        { onlyMultiple: options.all ? false : undefined, dateFilter: options.date, from: options.from, to: options.to },
        options.json ?? false,
      ),
    );

  command("payment-methods")
    .description("Meios de pagamento usados e quanto passou por cada um")
    .option("--date <filtro>", PERIOD)
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .action((options) =>
      invoke(
        "list_payment_methods",
        { dateFilter: options.date, from: options.from, to: options.to },
        options.json ?? false,
      ),
    );

  command("invoice <orderId>")
    .description("Metadados e links da NF-e de um pedido")
    .action((orderId: string, options) =>
      invoke("get_invoice", { orderId }, options.json ?? false),
    );

  command("download-invoice <orderId>")
    .description("Baixa a NF-e de um pedido (pdf ou xml) para o diretório de exportação")
    .requiredOption("--format <formato>", "pdf ou xml")
    .option("--name <arquivo>", "nome do arquivo dentro do diretório de exportação")
    .action((orderId: string, options) =>
      invoke(
        "download_invoice",
        { orderId, format: options.format, fileName: options.name },
        options.json ?? false,
      ),
    );

  command("export-invoices")
    .description("Baixa todas as NF-e do período que estão no cache (pdf, xml ou os dois)")
    .option("--date <filtro>", PERIOD)
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .option("--format <formato>", "pdf, xml ou both (default both)")
    .option("--overwrite", "baixa de novo por cima dos arquivos existentes")
    .option("--include-cancelled", "inclui compras canceladas")
    .action((options) =>
      invoke(
        "export_invoices",
        {
          dateFilter: options.date,
          from: options.from,
          to: options.to,
          format: options.format,
          overwrite: options.overwrite,
          includeCancelled: options.includeCancelled,
        },
        options.json ?? false,
      ),
    );

  command("export")
    .description("Exporta o cache para JSON ou CSV, dentro de MERCADOLIVRE_EXPORT_DIR")
    .option("--format <formato>", "json | csv", "csv")
    .option("--scope <escopo>", "purchases | products", "purchases")
    .option("--date <filtro>", PERIOD)
    .option("--from <data>", "data da compra >= YYYY-MM-DD")
    .option("--to <data>", "data da compra <= YYYY-MM-DD")
    .option("--include-cancelled", "inclui compras canceladas")
    .option("--filename <nome>", "nome do arquivo")
    .action((options) =>
      invoke(
        "export",
        {
          format: options.format,
          scope: options.scope,
          dateFilter: options.date,
          from: options.from,
          to: options.to,
          includeCancelled: options.includeCancelled,
          filename: options.filename,
        },
        options.json ?? false,
      ),
    );

  command("raw <url>")
    .description("GET autenticado num host permitido do Mercado Livre (redescoberta)")
    .option("--as <modo>", "html, json ou nordic", "html")
    .option("--max-bytes <n>", "limita o corpo devolvido")
    .action((url: string, options) =>
      invoke(
        "raw_get",
        { url, as: options.as, maxBytes: toNumber(options.maxBytes) },
        options.json ?? false,
      ),
    );

  program
    .command("mcp")
    .description("Sobe o servidor MCP (stdio)")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(createContext(loadConfig()), version);
    });

  await program.parseAsync(argv);
}
