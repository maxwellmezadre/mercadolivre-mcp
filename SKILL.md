---
name: mercadolivre-mcp
description: >-
  Histórico de compras do Mercado Livre da conta do usuário via MCP
  `mercadolivre`: compras, produtos, preço cheio e pago, descontos, cupons,
  frete, parcelas, cartão, vendedor, categorias, notas fiscais (NF-e em PDF e
  XML) e resumos de gastos, com cache local. Use para perguntas como "quanto
  gastei no Mercado Livre", "quantas vezes comprei esse café e a que preço",
  "quanto ainda falta pagar de parcela", "me manda as notas fiscais de 2025".
  Triggers: Mercado Livre, mercadolivre, ML, minhas compras, compra, pedido,
  quanto gastei, gasto, parcelas, nota fiscal, NF-e, NFe, XML da nota,
  recompra, preço que paguei, vendedor, Mercado Envios.
---

# Mercado Livre — histórico de compras

MCP `mercadolivre` (`mcp__mercadolivre__*`), 18 tools. Referência completa de
parâmetros em `TOOLS.md`, ao lado deste arquivo.

## Leia antes de responder

1. Comece por `auth_status`. Sem `verify` ele não usa a rede e já diz se há
   sessão, de qual conta e até quando os cookies valem. Sem sessão, a correção
   é o usuário rodar `mercadolivre login` (ou `--from-browser chrome`) no
   terminal, ou chamar a tool `login`. O servidor recarrega a sessão nova
   sozinho, sem reiniciar.
2. O cache responde quase tudo. `list_purchases`, `search_purchases`,
   `list_products`, `product_history`, `spending_summary`, `list_installments`,
   `list_payment_methods` e `export` leem o SQLite local. Se `list_purchases`
   devolver `note` falando em sync, o cache está vazio: rode `sync` com
   `mode: "full"` uma vez (cerca de 3 minutos para 70 compras). Depois, o
   `sync` incremental (padrão) basta.
3. Compra não é pedido. Uma compra (`purchaseId`, "Compra número N") tem
   vários pedidos (`orderId`), e cada pedido é um produto. As tools já agregam
   por compra; não some pedidos como se fossem compras.
4. `get_purchase` vai ao site e precisa do par `packId` + `orderId` do mesmo
   item. Use o `detailRef` que `list_purchases` devolve. Sem o par, a tool
   procura no cache e depois varre a lista, uma requisição por página.
5. Valores: `total` é o que saiu do bolso, depois de desconto e cupons.
   `paidPrice` de um produto é o total da linha; `unitPrice` é pago dividido
   por quantidade. `priceSource` diz de onde veio: `detail`, `invoice` (NF-e,
   valor bruto) ou `none`.
6. Parcelas são estimativa. O site não expõe o cronograma; `list_installments`
   assume cobranças mensais e diz isso em `note`. Repita o aviso ao usuário.
7. Categorias são N para N em `spending_summary`: uma compra pode contar em
   duas. E `list_categories` pode vir vazio, porque o site não oferece o filtro
   para toda conta; não é erro.
8. Canceladas ficam fora dos totais por padrão (`includeCancelled: true`
   inclui).
9. Endereço e últimos dígitos do cartão aparecem em `get_purchase`. Não os
   repita em resumos.
10. `doctor` quando algo falhar de um jeito estranho: ele diz qual camada
    quebrou (sessão, lista, endpoint JSON, detalhe, dinheiro, NF-e, cache).

## Tools ↔ CLI

| Tool | CLI | Para quê |
| --- | --- | --- |
| `auth_status` | `mercadolivre status [--verify]` | Tem sessão? De quem? `verify` gasta 1 requisição |
| `login` | `mercadolivre login [--from-browser chrome]` | Abre o navegador ou importa a sessão |
| `doctor` | `mercadolivre doctor` | Qual camada quebrou (até 4 requisições) |
| `sync` | `mercadolivre sync [--full\|--reparse]` | Enche o cache |
| `list_purchases` | `mercadolivre purchases [--date --category --search --live]` | Compras agrupadas, com produtos e valores |
| `get_purchase` | `mercadolivre purchase <id> [--pack --order]` | Detalhe completo (site) |
| `search_purchases` | `mercadolivre search <texto> [--live]` | Busca textual |
| `list_categories` | `mercadolivre categories` | Categorias aceitas pelo filtro |
| `list_products` | `mercadolivre products` | Produtos comprados, preço pago e unitário |
| `product_history` | `mercadolivre product-history --item\|--title` | Recompras e evolução do preço |
| `list_installments` | `mercadolivre installments` | Parcelas, com estimativa do que falta |
| `list_payment_methods` | `mercadolivre payment-methods` | Meios de pagamento e totais |
| `get_invoice` | `mercadolivre invoice <orderId>` | Metadados e links da NF-e |
| `download_invoice` | `mercadolivre download-invoice <orderId> --format pdf\|xml` | Salva a NF-e |
| `export_invoices` | `mercadolivre export-invoices [--date --format]` | Todas as NF-e do período |
| `spending_summary` | `mercadolivre spending --by …` | month, year, seller, category, none |
| `export` | `mercadolivre export --format csv --scope purchases\|products` | CSV/JSON em `MERCADOLIVRE_EXPORT_DIR` |
| `raw_get` | `mercadolivre raw <url> [--as nordic]` | Redescoberta; só GET |

Todo comando do CLI aceita `--json`.

## Receitas

- "Quanto gastei em agosto?" → `spending_summary` com `from: "2026-08-01"`,
  `to: "2026-08-31"`.
- "Quanto já gastei com café?" → `product_history` com `titleContains: "café"`.
- "Quais compras eu parcelei e quanto falta?" → `list_installments`, e avise
  que as datas são estimadas.
- "Me manda as notas fiscais de 2025" → `export_invoices` com
  `dateFilter: "1Y"`, depois informe o diretório devolvido.
- "O que comprei da loja X?" → `list_products` com `seller: "X"`.
- "Quero isso numa planilha" → `export` com `format: "csv"` e
  `scope: "products"`.

## Avisos

- Somente leitura na conta. Nenhuma tool cancela, reclama, avalia ou paga.
- Ritmo: uma requisição por vez, com pausa. Não paralelize chamadas que vão ao
  site e prefira rodar `sync --full` pelo terminal no Claude Desktop, que tem
  timeout curto para tools.
- Dados sensíveis: endereço, últimos dígitos do cartão e histórico de consumo
  ficam no cache local (0600) e a sessão fica cifrada. Não copie esses
  arquivos para lugar nenhum.
- Arredondamento: valores saem em reais decimais; por dentro são centavos
  inteiros, então as somas fecham.
- Com `MERCADOLIVRE_READ_ONLY=1`, `login`, `sync`, `download_invoice`,
  `export_invoices` e `export` não existem: explique que o cache é um retrato
  e que atualizar é fora do agente.
