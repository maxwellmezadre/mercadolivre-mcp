# Arquitetura

Camadas pragmáticas (ADR-0001): transporte, aplicação, domínio e infraestrutura,
com o contexto injetado e sem singletons.

```
┌─────────────────────────────────────────────────────────────────┐
│ Transporte      src/mcp/server.ts (stdio)   src/cli/index.ts     │
│                 ambos chamam runTool(tool, args, ctx)             │
├─────────────────────────────────────────────────────────────────┤
│ Aplicação       src/tools/*.ts  — 16 tools TypeBox (define.ts)   │
│                 src/sync/sync.ts — full / incremental / reparse   │
├─────────────────────────────────────────────────────────────────┤
│ Domínio         src/meli/parser/*  — Nordic/Flox → modelo        │
│                 src/meli/merge.ts  — lista × detalhe             │
│                 src/meli/types.ts  — modelo canônico (centavos)  │
├─────────────────────────────────────────────────────────────────┤
│ Infraestrutura  src/core/http.ts   — fila serial, backoff        │
│                 src/auth/*         — sessão (cookies), login     │
│                 src/meli/api/*     — URLs dos endpoints           │
│                 src/store/*        — bun:sqlite, migrations, FTS │
└─────────────────────────────────────────────────────────────────┘
```

## Fluxo de dados

1. `auth/session.ts` monta o header `Cookie` do host a partir do `session.json`
   (ou de `MERCADOLIVRE_COOKIE`) e absorve cada `Set-Cookie` recebido.
2. `core/http.ts` é o único funil de rede: uma requisição por vez, intervalo mínimo
   com jitter, backoff em 403/429, redirecionamentos seguidos à mão (o redirect para
   `/jms/.../lgz/login` vira `SessionError` sem baixar a página de login).
3. `meli/api/*.ts` conhecem as URLs (lista SSR, lista JSON, detalhe, NF-e) e entregam o
   corpo aos parsers.
4. `meli/parser/nordic.ts` extrai o JSON do `<script id="__NORDIC_RENDERING_CTX__">`
   com um scanner de chaves balanceadas; `list.ts`, `detail.ts` e `invoice.ts` produzem
   o modelo canônico de `meli/types.ts`, sempre em centavos.
5. `sync/sync.ts` percorre a lista, busca um detalhe por compra, casa as linhas do
   detalhe com o inventário da lista (`meli/merge.ts`), completa preços com a NF-e e
   grava tudo via `store/repo.ts`.
6. As tools de consulta leem `store/queries.ts` e convertem centavos em reais na saída.

## Princípios

- **AR-1 camadas**: transporte → tools → domínio → infraestrutura; nenhuma camada
  importa a de cima.
- **AR-2 SDK confinado**: só `src/mcp/server.ts` importa `@modelcontextprotocol/sdk`
  (ADR-0004).
- **AR-3 TypeBox como fonte única**: o schema da tool é o tipo, a validação e o
  `inputSchema` anunciado (ADR-0003).
- **AR-4 contexto injetado**: `Ctx` carrega config, log, relógio, sessão, HTTP, APIs e
  o cache (aberto sob demanda). `fetch`, `now`, `sleep` e `random` são substituíveis.
- **AR-5 parsers puros**: funções sobre o JSON dos bricks; a rede nunca entra neles.
- **AR-6 cache como superfície de consulta**: a rede só entra via `sync`, quando pedido
  (`fromCache=false`, `scope=live`) ou enquanto o cache está vazio (ADR-0006).
- **AR-7 centavos**: inteiros dentro do sistema; reais apenas na borda das tools.
- **AR-8 `purchase_id` como chave**: pedido = um produto; financeiro gravado uma vez por
  compra (ADR-0007).
- **AR-9 config só por ambiente**, validada fail-fast, agregando todos os problemas.
- **AR-10 par `(packId, orderId)` do mesmo item**: par cruzado é uma página de erro
  com HTTP 200, detectada pelo parser.

## Erros

`SessionError` (sem sessão / expirada), `UpstreamError` (status ou página de erro do
site), `RateLimitError` (403/429 após as tentativas), `ParseError` (layout mudou) e
`ToolInputError` (argumentos inválidos). No MCP, tudo vira `isError: true` com a
mensagem; na CLI, mensagem em stderr e exit code 1. Cookies nunca aparecem em
mensagens ou logs (`core/logger.ts` redige os valores).

## Testes

`bun test`: fake `fetch` e relógio falso (`test/http.test.ts`), SQLite em memória,
fixtures sintéticos no formato do site e, quando existirem, fixtures reais
anonimizados em `test/fixtures/`. `test/local/` roda sobre as capturas cruas
privadas (`task/captures/`), `test/integration/` contra o site real
(`MERCADOLIVRE_REAL=1`); ambos se pulam quando não há o que testar.
