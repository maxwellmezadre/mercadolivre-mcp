# CLI

`mercadolivre <comando> [opções]`. Todo comando aceita `--json`. O resultado vai
para o stdout; erros, avisos e progresso vão para o stderr, então
`mercadolivre purchases --json | jq` funciona. Erro sai com código 1.

`F` = `ALL`, `30D`, `3M`, `6M`, `Y`, `1Y` a `4Y` (anos-calendário); `D` =
`YYYY-MM-DD`.

## Sessão e diagnóstico

| Comando | O que faz |
| --- | --- |
| `status [--verify]` | A sessão salva. `--verify` gasta 1 requisição para confirmar |
| `login [--fresh] [--from-browser <nav>]` | Abre o navegador padrão, ou importa de um já logado (macOS) |
| `doctor` | Diagnóstico camada a camada, até 4 requisições |

## Cache

| Comando | O que faz |
| --- | --- |
| `sync` | Incremental: página 1 até uma página conhecida, detalhes novos e não finais, NF-e, categorias se houver compra nova |
| `sync --full` | Todas as páginas, um detalhe por compra, NF-e e categorias |
| `sync --reparse` | Reprocessa os detalhes em cache sem rede |
| `sync --max-pages <n> --no-details --no-invoices --no-categories` | Ajustes |

## Compras

| Comando | O que faz |
| --- | --- |
| `purchases [--date F] [--category C] [--search S] [--from D] [--to D] [--limit N] [--offset N]` | Compras do cache, agrupadas por compra |
| `purchases --live [--page N] [--max-pages N]` | O mesmo, direto do site |
| `purchase <purchaseId> [--pack P --order O] [--no-invoice]` | Detalhe completo (site) |
| `search <texto> [--live] [--limit N]` | Busca textual |
| `categories` | Categorias aceitas por `--category` |

## Produtos

| Comando | O que faz |
| --- | --- |
| `products [--from --to --seller --min-paid --max-paid --title --sort --limit --include-cancelled]` | Produtos comprados com preços |
| `product-history --item MLB… \| --title <texto>` | Recompras e evolução do preço |

## Pagamento

| Comando | O que faz |
| --- | --- |
| `installments [--all] [--date F] [--from D] [--to D]` | Parcelas, com a estimativa do que falta |
| `payment-methods [--date F] [--from D] [--to D]` | Meios de pagamento e totais |

## Nota fiscal

| Comando | O que faz |
| --- | --- |
| `invoice <orderId>` | Metadados e links da NF-e de um pedido |
| `download-invoice <orderId> --format pdf\|xml [--name arquivo]` | Baixa uma NF-e |
| `export-invoices [--date F] [--from D] [--to D] [--format pdf\|xml\|both] [--overwrite] [--include-cancelled]` | Baixa todas as NF-e do período |

## Análise

| Comando | O que faz |
| --- | --- |
| `spending --by month\|year\|seller\|category\|none [--date F] [--from D] [--to D] [--include-cancelled]` | Resumo de gastos |
| `export --format json\|csv --scope purchases\|products [--date F] [--from D] [--to D] [--include-cancelled] [--filename]` | Arquivo dentro de `MERCADOLIVRE_EXPORT_DIR` |

## Redescoberta

| Comando | O que faz |
| --- | --- |
| `raw <url> [--as html\|json\|nordic] [--max-bytes N]` | GET autenticado em `myaccount.` ou `www.mercadolivre.com.br` |

## Servidor

| Comando | O que faz |
| --- | --- |
| `mcp` | Sobe o servidor MCP em stdio |

## Saída

Sem `--json` a saída é `chave: valor`, uma por linha, com objetos e listas em
JSON compacto. Com `--json` é exatamente o que o cliente MCP receberia.

## Exemplos

```sh
# quanto gastei por mês este ano
mercadolivre spending --by month --date Y

# o que comprei de um vendedor específico
mercadolivre products --seller "gallo" --json | jq '[.products[].paidPrice] | add'

# todas as notas do ano passado, para a contabilidade
mercadolivre export-invoices --date 1Y --format both

# planilha com todos os produtos já comprados
mercadolivre export --format csv --scope products
```
