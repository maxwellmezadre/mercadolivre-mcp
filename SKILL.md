---
name: mercadolivre-mcp
description: >-
  Use quando o usuário quiser consultar o histórico de compras da própria conta
  do Mercado Livre: listar compras, ver o detalhe de uma compra (produtos, preço
  pago, desconto, cupom, frete, parcelas, cartão, vendedor, endereço), buscar um
  produto comprado, calcular gastos por mês/ano/vendedor/categoria, recompras e
  evolução de preço, parcelas em aberto, meios de pagamento, ou baixar/exportar
  notas fiscais (NF-e em PDF/XML). Triggers: Mercado Livre, mercadolivre, ML,
  minhas compras, compra, pedido, quanto gastei, gasto, parcelas, nota fiscal,
  NF-e, NFe, XML da nota, recompra, preço que paguei, vendedor, Mercado Envios.
---

# mercadolivre-mcp

CLI + servidor MCP para o histórico de compras de uma conta do Mercado Livre (lado
comprador). Só leitura na conta. Os dados vêm de um cache SQLite local preenchido
pela tool `sync`; a rede só entra quando pedido.

## Antes de tudo

1. `auth_status` — há sessão? Se não: peça ao usuário para rodar `mercadolivre login`
   no terminal (ele digita a senha no navegador; a ferramenta nunca a vê) ou
   configurar `MERCADOLIVRE_COOKIE`.
2. `sync` — se o cache estiver vazio (`list_purchases` avisa com `note`), rode
   `sync` com `mode: "full"` uma vez (≈3 min; para ~70 compras). Nas sessões
   seguintes, `sync` incremental (padrão) basta.
3. `doctor` — quando algo falha de forma estranha, ele diz qual endpoint quebrou.

## Tools / comandos

| Tool (MCP) | Comando (CLI) | O que faz |
| --- | --- | --- |
| `auth_status` | `mercadolivre status [--verify]` | Sessão configurada? nickname, expiração |
| `doctor` | `mercadolivre doctor` | Checa sessão e cada endpoint |
| `sync` | `mercadolivre sync [--full\|--reparse]` | Preenche/atualiza o cache (**escreve no cache**) |
| `list_purchases` | `mercadolivre purchases [--date --category --search --from --to --live]` | Compras agrupadas por compra, com produtos e valores |
| `get_purchase` | `mercadolivre purchase <id> [--pack --order]` | Detalhe completo de uma compra (busca no site) |
| `search_purchases` | `mercadolivre search <texto> [--live]` | Busca textual (FTS no cache) |
| `list_categories` | `mercadolivre categories` | Categorias aceitas pelo filtro |
| `list_products` | `mercadolivre products [...filtros]` | Produtos comprados com preço pago/unitário |
| `product_history` | `mercadolivre product-history --item\|--title` | Recompras e tendência de preço |
| `spending_summary` | `mercadolivre spending [--group-by]` | Gastos por mês/ano/vendedor/categoria |
| `list_installments` | `mercadolivre installments` | Parcelas (estimativa do que falta) |
| `list_payment_methods` | `mercadolivre payment-methods` | Meios de pagamento e totais |
| `get_invoice` | `mercadolivre invoice <orderId>` | Metadados e links da NF-e |
| `download_invoice` | `mercadolivre download-invoice <orderId> --format pdf\|xml` | Baixa a NF-e (**escreve arquivo**) |
| `export_invoices` | `mercadolivre export-invoices [--date --format]` | Baixa todas as NF-e do período (**escreve arquivos**) |
| `raw_get` | `mercadolivre raw <url> [--as nordic]` | GET bruto para redescobrir o site |

Todo comando aceita `--json`.

## Conceitos que evitam respostas erradas

- **Compra ≠ pedido.** Uma compra (`purchaseId`, "Compra número N") tem vários
  pedidos (`orderId`), e cada pedido é **um produto**. As tools já agregam por compra;
  não some pedidos como se fossem compras.
- **`get_purchase` precisa do par `packId` + `orderId` do mesmo item** — use o
  `detailRef` que `list_purchases` devolve. Sem o par, a tool procura no cache e
  depois varre a lista (mais requisições).
- **Valores:** `total` é o que saiu do bolso (após desconto e cupons). `paidPrice` de
  um produto é o total da linha; `unitPrice` = pago / quantidade. `priceSource`
  diz de onde veio: `detail`, `invoice` (NF-e, valor **bruto**) ou `none`.
- **Parcelas são estimativa** (`list_installments`): o site não expõe o cronograma;
  diga isso ao usuário quando responder sobre parcelas em aberto.
- **Categorias são N:N** em `spending_summary`: uma compra pode contar em duas.
- **Canceladas** ficam fora dos totais por padrão (`includeCancelled: true` inclui).

## Receitas

- "Quanto gastei em agosto?" → `spending_summary` com `from: "2026-08-01", to: "2026-08-31"`.
- "Quanto já gastei com café?" → `product_history` com `titleContains: "café"`.
- "Me manda as notas fiscais de 2025" → `export_invoices` com `dateFilter: "1Y"`,
  depois informe o diretório retornado.
- "O que comprei da loja X?" → `list_products` com `seller: "X"`.

## Avisos

- **Rate limit:** uma requisição por segundo; não paralelize chamadas que vão ao site.
  `sync` completo ≈ 3 minutos — prefira rodá-lo pelo terminal no Claude Desktop.
- **Dados sensíveis:** endereço, últimos dígitos do cartão e histórico de consumo ficam
  no cache local (0600). Não copie a sessão nem o cache para outro lugar.
- **Sessão expirada:** as tools devolvem uma mensagem com o que fazer; não tente
  "adivinhar" cookies.
- **Layout novo do site:** `doctor` primeiro; depois `raw_get` com `as: "nordic"` e o
  roteiro em `docs/REDISCOVERY.md`.
