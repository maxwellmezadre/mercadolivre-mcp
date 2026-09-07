# Quando o Mercado Livre mudar

A fonte é uma superfície interna: o layout pode mudar sem aviso. Este é o
roteiro para descobrir o que mudou e atualizar os parsers sem reescrever a
ferramenta.

## 1. Pergunte ao `doctor` primeiro

```sh
mercadolivre doctor --json
```

Cada check diz o que falhou: `session`, `list_page`, `json_endpoint`,
`detail_page`, `money_identity`, `invoices_overview`, `cache`. Sessão expirada,
refaça o login. Endpoint quebrado, siga abaixo.

| Camada que falhou | Onde olhar |
| --- | --- |
| `list_page` | `src/mercadolivre/parser/nordic.ts` e `list.ts` |
| `json_endpoint` | `src/mercadolivre/parser/nordic.ts` (`floxJsonRootBrick`) |
| `detail_page` | `src/mercadolivre/parser/detail.ts` |
| `money_identity` | os rótulos do `ticket_row` em `detail.ts` |
| `invoices_overview` | `src/mercadolivre/parser/invoice.ts` |

## 2. Olhe o payload real

```sh
mercadolivre raw "/my_purchases/list?filterDate=ALL&page=1" --as nordic --json
mercadolivre raw "/my_purchases/<purchaseId>/status?packId=<p>&orderId=<o>" --as nordic --json
mercadolivre raw "/my_purchases/api/web/list_items?filterDate=3M" --as json --json
```

`--as nordic` devolve o censo de `ui_type` (quantos bricks de cada tipo) e a
árvore de bricks, capada por `--max-bytes`. Compare com as tabelas de
[INTERNAL-API.md](INTERNAL-API.md): um `ui_type` sumiu ou mudou de nome? Um
campo mudou de `data.x` para `data.y`?

## 3. No navegador, quando o `raw` não basta

Console da página de compras:

```js
// endpoints que o front chama ao mexer nos filtros (Flox usa XMLHttpRequest)
const orig = XMLHttpRequest.prototype.open; window.__log = [];
XMLHttpRequest.prototype.open = function (m, u, ...r) { window.__log.push(m + " " + u); return orig.call(this, m, u, ...r); };
// depois de usar um filtro:
console.log(window.__log.slice(-5));

// árvore de bricks
const R = _n.ctx.r.appProps.pageProps;
const root = R.floxResponse.data.brick;                                       // lista
const stack = R.floxPreloadedState["@meli/web/flox/FLOX_STATE"].brickStack;   // detalhe
const t = {}; (function w(x){ if(!x) return; if(x.ui_type) t[x.ui_type]=(t[x.ui_type]||0)+1; (x.bricks||[]).forEach(w); })(root);
console.table(t);

// um parâmetro funciona?
async function probe(qs) {
  const r = await fetch("https://myaccount.mercadolivre.com.br/my_purchases/api/web/list_items?" + qs, { credentials: "include" });
  const j = await r.json(); const ids = []; let pag = null;
  (function w(x){ if(!x) return; if (x.ui_type === "list_item") ids.push(x.data.context.purchase_id); if (x.ui_type === "paginator") pag = x.data; (x.bricks||[]).forEach(w); })(j.data.brick);
  return { n: ids.length, current: pag?.current };
}
await probe("page=2");   // { current: 1 } -> ignorado
```

`performance.getEntriesByType("resource")` mostra as chamadas a outros
micro-frontends (foi assim que o `invoices-overview` apareceu).

## 4. Recapture as fixtures

```sh
bun run scripts/capture-fixtures.ts task/captures   # privado, gitignored; precisa de sessão válida
bun test test/local                                  # o corpus inteiro tem que passar
```

## 5. Atualize os parsers com segurança

1. Ajuste `src/mercadolivre/parser/*.ts` com um teste falhando antes.
2. Incremente `PARSER_VERSION` em `src/cache/sync.ts`: o próximo `sync`
   reprocessa o cache sem rede, a partir do `raw_detail` guardado.
3. Gere fixtures públicos anonimizados:
   `bun run scripts/anonymize-fixture.ts task/captures test/fixtures <nomes>`.
   O script falha se sobrar dado real. Veja
   [../test/fixtures/README.md](../test/fixtures/README.md).
4. `bun run verify` e atualize [INTERNAL-API.md](INTERNAL-API.md).

## Limitações conhecidas (medidas)

| Limitação | Mitigação |
| --- | --- |
| `/api/web/list_items` ignora `page` | paginar pelo SSR |
| Histórico do site vai só até 4 anos-calendário | nenhuma |
| Detalhe exige `packId` e `orderId` do mesmo item | o cache guarda o par; par cruzado vira `UpstreamError` |
| `row_with_ellipsis` trunca em compras grandes | inventário vem da lista; preço faltante vem da NF-e |
| NF-e é valor bruto | `priceSource: "invoice"` separado; total pago vem do ticket |
| `/xml` responde `content-type: application/pdf` | formato pelo sufixo e pelos primeiros bytes |
| Cronograma de parcelas não exposto | `list_installments` rotula estimativas |
| API oficial `api.mercadolibre.com` fechada (403) | não usada |

## Nunca automatize

O login, o 2FA e o captcha são resolvidos por uma pessoa, na janela do
navegador. E nenhuma tool escreve na conta: se o site passar a exigir um
clique para carregar algo, o caminho é o `raw_get` e o `doctor`, não um
navegador automatizado apertando botões.
