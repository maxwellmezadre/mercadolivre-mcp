# Redescoberta

A fonte é uma superfície interna: o layout pode mudar sem aviso. Este é o roteiro para
descobrir o que mudou e atualizar os parsers, sem precisar reescrever a ferramenta.

## 1. Diagnóstico

```sh
mercadolivre doctor --json
```

Cada check diz o que falhou (`session`, `list_page`, `json_endpoint`, `detail_page`,
`money_identity`, `invoices_overview`, `cache`). Sessão expirada → `mercadolivre login`.
Endpoint quebrado → siga abaixo.

## 2. Olhar o payload real

```sh
mercadolivre raw "/my_purchases/list?filterDate=ALL&page=1" --as nordic --json
mercadolivre raw "/my_purchases/<purchaseId>/status?packId=<p>&orderId=<o>" --as nordic --json
mercadolivre raw "/my_purchases/api/web/list_items?filterDate=3M" --as json --json
```

`--as nordic` devolve o censo de `ui_type` (quantos bricks de cada tipo) e a árvore de
bricks (capada por `--max-bytes`). Compare com as tabelas de
[INTERNAL-API.md](INTERNAL-API.md): um `ui_type` sumiu ou mudou de nome? Um campo
mudou de `data.x` para `data.y`?

## 3. No navegador (quando o `raw` não basta)

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

## 4. Atualizar os parsers com segurança

1. Capture o novo payload: `bun run scripts/capture-fixtures.ts task/captures` (privado,
   gitignored) — precisa de sessão válida.
2. Rode `bun test test/local` — o corpus inteiro tem que passar (identidade financeira em
   toda compra).
3. Ajuste `src/meli/parser/*.ts` com um teste falhando antes (TDD), incremente
   `PARSER_VERSION` em `src/sync/sync.ts` (o próximo `sync` reprocessa o cache sem rede).
4. Gere fixtures públicos anonimizados: `bun run scripts/anonymize-fixture.ts task/captures test/fixtures <nomes>`
   (o script falha se sobrar dado real). Veja [../test/fixtures/README.md](../test/fixtures/README.md).
5. `bun test`, `bunx tsc --noEmit`, atualize [INTERNAL-API.md](INTERNAL-API.md).

## Limitações conhecidas (medidas)

| Limitação | Mitigação |
| --- | --- |
| `/api/web/list_items` ignora `page` | paginar pelo SSR |
| Histórico do site vai só até 4 anos-calendário | nenhuma |
| Detalhe exige `packId` **e** `orderId` do mesmo item | cache guarda o par; par cruzado vira `UpstreamError` |
| `row_with_ellipsis` trunca em compras grandes | inventário vem da lista; preço faltante vem da NF-e |
| NF-e é valor bruto | `priceSource: "invoice"` separado; total pago vem do ticket |
| `/xml` responde `content-type: application/pdf` | formato pelo sufixo + magic bytes |
| Cronograma de parcelas não exposto | `list_installments` rotula estimativas |
| API oficial `api.mercadolibre.com` fechada (403) | não usada |
