# Arquitetura

Camadas pragmáticas (ADR-0001): transporte, aplicação, domínio e infraestrutura,
com o contexto injetado e sem singletons.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Transporte      src/mcp/server.ts (stdio)   src/cli/index.ts         │
│                 ambos chamam runTool(tool, args, ctx)                 │
├─────────────────────────────────────────────────────────────────────┤
│ Aplicação       src/tools/*.ts  (18 tools TypeBox, define.ts)        │
│                 src/cache/sync.ts (full, incremental, reparse)       │
├─────────────────────────────────────────────────────────────────────┤
│ Domínio         src/mercadolivre/parser/*  (Nordic/Flox para modelo) │
│                 src/mercadolivre/merge.ts  (lista com detalhe)       │
│                 src/mercadolivre/types.ts  (modelo canônico, cents)  │
├─────────────────────────────────────────────────────────────────────┤
│ Infraestrutura  src/core/http.ts      (fila serial, backoff)         │
│                 src/session/*         (sessão cifrada, login)        │
│                 src/mercadolivre/api/* (URLs dos endpoints)          │
│                 src/cache/db.ts, repo.ts, queries.ts (bun:sqlite)    │
└─────────────────────────────────────────────────────────────────────┘
```

## Fluxo de uma pergunta

1. `bin.ts` decide entre servidor MCP e CLI (import preguiçoso por modo: o
   caminho MCP nunca carrega o commander).
2. `tools/define.ts` valida os argumentos contra o schema TypeBox da tool.
3. A tool lê do cache (`cache/queries.ts`) sempre que possível e converte
   centavos em reais na saída.
4. Quando precisa de rede: `mercadolivre/api/*` monta a URL e `core/http.ts` a
   envia, uma requisição por vez, com intervalo, backoff e o cookie do host.
   `session/store.ts` monta o header `Cookie` e absorve cada `Set-Cookie`.
5. `mercadolivre/parser/nordic.ts` extrai o JSON do
   `<script id="__NORDIC_RENDERING_CTX__">` com um scanner de chaves
   balanceadas; `list.ts`, `detail.ts` e `invoice.ts` produzem o modelo
   canônico, sempre em centavos.
6. `cache/sync.ts` percorre a lista, busca um detalhe por compra, casa as linhas
   do detalhe com o inventário da lista (`merge.ts`), completa preços com a
   NF-e e grava tudo via `cache/repo.ts`.

## Regras

1. Dependências só para dentro (AR-1). O SDK do MCP só existe em `src/mcp/`
   (AR-2), o commander só em `src/cli/`, o `playwright-core` só em
   `src/session/login.ts`, por import dinâmico.
2. Só `src/mercadolivre/parser/` conhece os bricks e os campos do site (AR-5).
   Se o layout mudar, é ali que quebra.
3. Toda rede passa por `src/core/http.ts`. Uma requisição por vez, sempre.
4. TypeBox é a fonte única: o schema da tool é o tipo, a validação e o
   `inputSchema` anunciado (AR-3). A configuração também é um schema (AR-9).
5. Dinheiro é centavo inteiro para dentro, decimal só na borda da tool (AR-7).
6. O cache é a superfície de consulta (AR-6): a rede só entra via `sync`,
   quando pedido (`fromCache=false`, `scope=live`, `get_purchase`) ou enquanto
   o cache está vazio.
7. `purchase_id` é a chave de agregação e um pedido é um produto (AR-8); o par
   `(packId, orderId)` vem do mesmo item da lista (AR-10).
8. stdout é do JSON-RPC. Log só no stderr, com os valores de cookie redigidos.
9. Falha de tool vira `isError`, nunca crash. Um argumento ruim não pode
   derrubar o servidor.
10. Nenhum arquivo de lógica passa de cerca de 450 linhas.

## O que cada diretório faz

| Diretório | Responsabilidade |
| --- | --- |
| `src/core/` | Erros tipados, logger com redação, cliente HTTP serial |
| `src/session/` | Sessão cifrada em repouso, detecção do navegador padrão, login pela janela, importação pelo Keychain |
| `src/mercadolivre/api/` | URLs da lista, do detalhe e das NF-e; entregam o corpo aos parsers |
| `src/mercadolivre/parser/` | Nordic, bricks, rich text, lista, detalhe, NF-e, datas |
| `src/mercadolivre/` | Modelo canônico e a junção lista com detalhe |
| `src/cache/` | Schema e migrations, repositório, queries, o sync |
| `src/tools/` | Uma tool por assunto; o registry é compartilhado com o CLI |

## Erros

`SessionError` (sem sessão, expirada ou arquivo ilegível), `LoginError` (a
janela ou a importação não terminou), `UpstreamError` (status ou página de
erro do site), `RateLimitError` (403/429 após as tentativas), `ParseError`
(layout mudou) e `ToolInputError` (argumentos inválidos). No MCP, tudo vira
`isError: true` com a mensagem; no CLI, mensagem em stderr e exit code 1.

## Testes

- Unitários com `fetch`, relógio, `sleep` e `random` injetados, SQLite em
  memória e fixtures reais anonimizados em `test/fixtures/`.
- `test/local/` roda sobre as capturas cruas (`task/captures/`, fora do git) e
  se auto-ignora em outra máquina.
- `test/integration/` faz chamadas reais, só com `MERCADOLIVRE_LIVE=1` e uma
  sessão salva.
- `scripts/verify.ts` é o portão: typecheck, testes e as invariantes que só
  aparecem com o servidor MCP rodando de verdade.
