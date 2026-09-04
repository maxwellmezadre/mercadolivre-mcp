# API interna do site

O que a ferramenta consome não é uma API pública: é a superfície web de
`myaccount.mercadolivre.com.br`, protegida pelo cookie de sessão do navegador. Tudo
abaixo foi observado numa conta real (site `MLB`, `pt-BR`) e pode mudar sem aviso —
por isso existem `doctor`, `raw_get` e [REDISCOVERY.md](REDISCOVERY.md). Os ids dos
exemplos são fictícios.

## Hosts

| Host | Papel |
| --- | --- |
| `myaccount.mercadolivre.com.br` | lista e detalhe de compras |
| `www.mercadolivre.com.br` | NF-e (`/emissor/omni/…`), mensagens, avaliações, páginas de item |
| `api.mercadolibre.com` | API oficial — **403 sem OAuth**; não é usada |

## Autenticação

Cookie de sessão HTTP-only do domínio `.mercadolivre.com.br`. Não há `client_id`,
token bearer nem refresh token. Uma sessão inválida **não devolve 401**: o site
responde 200 com a página de login ou redireciona para `/jms/{site}/lgz/login`.
Sinais usados (`src/auth/session.ts`): URL final de login, ausência do
`__NORDIC_RENDERING_CTX__`, formulário de login; para JSON e binários, um corpo HTML.

Headers de navegador são obrigatórios (`src/core/http.ts`): `user-agent` (o do login),
`accept`, `accept-language`, `sec-fetch-*`, `upgrade-insecure-requests`; para o
endpoint JSON, `accept: application/json`, `sec-fetch-mode: cors`,
`sec-fetch-dest: empty` e `referer` da página de lista.

## Endpoints

### `GET /my_purchases/list` — lista paginada (SSR) — fonte primária

Parâmetros opcionais: `page` (10 compras por página, ~29 itens), `filterDate`
(`ALL`, `30D`, `3M`, `6M`, `Y`, `1Y`…`4Y` — os últimos são anos-calendário),
`filterCategory` (nome exato), `searchValue` (texto). `limit` é ignorado. Resposta:
HTML com o JSON em `<script id="__NORDIC_RENDERING_CTX__" nonce="…">_n.ctx.r={…};…`
no caminho `appProps.pageProps.floxResponse.data.brick`.

### `GET /my_purchases/api/web/list_items` — a mesma lista em JSON

Mesmos filtros, envelope `{ "type": "register_and_render", "data": { "brick": … } }`.
**Ignora `page`**: sempre devolve a primeira página do filtro. Serve quando o filtro já
reduz o resultado a uma página.

### `GET /my_purchases/{purchaseId}/status?packId=…&orderId=…` — detalhe

Os três ids são obrigatórios e o par `packId`/`orderId` precisa ser do mesmo item da
lista. Sem os parâmetros a rota degrada para a lista; com par cruzado responde 200 com
`pageProps.errorType: "error"`, `httpStatus: 500`, `title: "Ocorreu um erro"`. Dados em
`appProps.pageProps.floxPreloadedState["@meli/web/flox/FLOX_STATE"].brickStack` (mapa
plano `id → brick`, ~66 bricks).

### `GET https://www.mercadolivre.com.br/emissor/omni/api/invoices-overview?identifiers=…`

Vários `order_id` separados por vírgula (a ferramenta usa lotes de 10). Uma NF-e por
**pedido**. Resposta `{ "invoices": [ { invoice_date, invoice_source, transaction_type,
items: [{ id, name }], actions: [{ sub_actions: [{ id: "download_pdf", url }, { id:
"download_xml", url }] }] } ], platform, locale }`. O `orderId` sai da URL de download.

### `GET …/emissor/omni/api/invoices-download/sale/{orderId}/{pdf|xml}`

Binário. O endpoint `/xml` responde `content-type: application/pdf` com corpo XML:
o formato é decidido pelo sufixo da URL e confirmado pelos primeiros bytes.

### Não funcionam de fora

- `/my_purchases/middleend/web/{id}/status` — 404 (rede interna do Mercado Livre).
- `api.mercadolibre.com/items/{MLB…}` — 403 sem token.

## O formato Flox/Nordic

Um brick é `{ id, ui_type, data, bricks }` (`ui_type` e `bricks` em snake_case; o id é
`{ui_type}_{hex}` com sufixo aleatório por render — nunca use o id como chave). Todo
texto e preço é um `RichText`:

```jsonc
{ "rich": [ { "type": "text",  "value": { "text": "1x " } },
            { "type": "price", "value": { "symbol": "R$", "fraction": "385", "cents": "40" } },
            { "type": "icon",  "value": { "id": "verified-small" } } ],
  "accessibility": "Uma parcela de 385 reais com 40 centavos" }
```

`accessibility` é prosa (para exibir); `rich` é estruturado (para calcular). O nó
`price` com `modifier: "strike"` é o preço cheio riscado; o sem modifier é o pago.
`fraction` pode ter separador de milhar (`"1.234"`).

### Bricks da lista

| `ui_type` | Papel |
| --- | --- |
| `list_item_grouper` | agrupador por data: `data.text` = "27 de agosto" / "3 de julho de 2024" |
| `list_item` | **um pedido = um produto**: `data.context` traz `purchase_id`, `pack_id`, `order_id`, `shipment_id`, `vertical_id`; `intro` = status, `title` = manchete de entrega (FULL), `info` = título + quantidade + atributos, `link` = URL do item (`MLB…`), `asset` = imagem; botão "Ver compra" com a URL do detalhe |
| `list_header_subtitle` | "68 compras" |
| `tag_dropdown` (`filterCategory`) / `dropdown` (`filterDate`) | opções dos filtros |
| `paginator` | `total_pages`, `current` |

### Bricks do detalhe

| `ui_type` | Papel |
| --- | --- |
| `ticket` | `subtitle` = "27 de agosto. Compra número {purchaseId}" |
| `ticket_row` | uma rubrica do financeiro: `left_column.primary_text` (rótulo) e `right_column.primary_text` (valor). Rótulos vistos: Produto(s) (N), Desconto, Desconto à vista, Cupons, Frete, Total. Ordem e presença variam: mapear por rótulo |
| `detail_information_row` | endereço (asset `…_shipping`) e pagamento (`"1x " + preço`, bandeira `**** NNNN`, "22 de agosto. Pagamento número N") |
| `row_with_ellipsis` | um produto: título, preços riscado/pago (**totais da linha**), " \| N unidades", variações "Cor: X"; subconjunto em compras grandes |
| `context_with_ellipsis` | o produto do `orderId` consultado (único brick que muda com o pedido) |
| `list_row` | vendedor: `events[].data.url` = `/compras/novo/mensagens/{packId}/{sellerId}`; ícone `verified-small` = loja oficial |
| `itm_invoices_overview_card` | `identifiers` = ids de pedido com NF-e |

## Rate limit

Sem quota publicada. A ferramenta faz uma requisição por vez com intervalo de 1 s mais
jitter de 200–600 ms, e backoff de 2 s e 8 s em 403/429 (três tentativas). Um `sync`
completo de ~70 compras custa ~140–180 requisições (~3 min).
