# CLI

`mercadolivre <comando> [opções]`. Todo comando aceita `--json` (saída estruturada);
sem ele a saída é `chave: valor`. Erros vão para stderr com exit code 1.

## Sessão e diagnóstico

| Comando | Descrição |
| --- | --- |
| `login` | Abre o navegador para você entrar; salva a sessão em `MERCADOLIVRE_HOME` |
| `status [--verify]` | Sessão configurada? `--verify` faz uma requisição para confirmar |
| `doctor` | Checa sessão, lista, endpoint JSON, detalhe, identidade financeira, NF-e e cache |
| `mcp` | Sobe o servidor MCP (stdio) |

## Cache

| Comando | Descrição |
| --- | --- |
| `sync` | Incremental: página 1 até uma página conhecida, detalhes novos/não finais, NF-e, categorias se houver compra nova |
| `sync --full` | Todas as páginas, um detalhe por compra, NF-e e categorias (carga inicial) |
| `sync --reparse` | Reprocessa os detalhes em cache sem rede |
| `sync --max-pages <n> --no-details --no-invoices --no-categories` | Ajustes |

## Compras e produtos

| Comando | Descrição |
| --- | --- |
| `purchases [--date F] [--category C] [--search S] [--from D] [--to D] [--limit N] [--offset N]` | Compras do cache, agrupadas por compra |
| `purchases --live [--page N] [--max-pages N]` | Mesmo, direto do site |
| `purchase <purchaseId> [--pack P --order O] [--no-invoice]` | Detalhe completo (site) |
| `search <texto> [--live] [--limit N]` | Busca textual |
| `categories` | Categorias aceitas por `--category` |
| `products [--from --to --seller --min-paid --max-paid --title --sort --limit --include-cancelled]` | Produtos comprados com preços |
| `product-history --item MLB… \| --title <texto>` | Recompras e tendência de preço |

## Financeiro

| Comando | Descrição |
| --- | --- |
| `spending [--group-by month\|year\|seller\|category\|none] [--date F] [--from D] [--to D] [--include-cancelled]` | Resumo de gastos |
| `installments [--all] [--date F] [--from D] [--to D]` | Parcelas (estimativa do que falta) |
| `payment-methods [--date F] [--from D] [--to D]` | Meios de pagamento e totais |

## Nota fiscal

| Comando | Descrição |
| --- | --- |
| `invoice <orderId>` | Metadados e links da NF-e de um pedido |
| `download-invoice <orderId> --format pdf\|xml [--name arquivo]` | Baixa uma NF-e |
| `export-invoices [--date F] [--from D] [--to D] [--format pdf\|xml\|both] [--overwrite] [--include-cancelled]` | Baixa todas as NF-e do período |

## Redescoberta

| Comando | Descrição |
| --- | --- |
| `raw <url> [--as html\|json\|nordic] [--max-bytes N]` | GET autenticado em `myaccount.` / `www.mercadolivre.com.br` |

`F` = `ALL`, `30D`, `3M`, `6M`, `Y`, `1Y`…`4Y`; `D` = `YYYY-MM-DD`.
