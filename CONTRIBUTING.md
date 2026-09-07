# Contribuindo

## Ambiente

Requer [Bun](https://bun.sh) 1.3 ou mais novo.

```sh
bun install
bun run verify
```

`bun run verify` é o portão: type-check estrito, testes e as invariantes do
servidor MCP real sobre stdio, sem rede e sem sessão. Se ele passa, o PR passa.

## Convenções

- Código, comentários, testes e commits em inglês. Documentação, descrições de
  tools, help do CLI e mensagens de erro em pt-BR, porque quem lê essas é o
  usuário.
- Sem linter. O gate é `tsc` estrito (`noUncheckedIndexedAccess`, `noUnused*`,
  `verbatimModuleSyntax`) mais os testes.
- Nenhum arquivo de lógica acima de cerca de 450 linhas.
- Comentários explicam por quê, não o quê. Os identificadores `F-n`, `NFR-n` e
  `AR-n` citados no código vêm de [`docs/PRD.md`](docs/PRD.md).
- Conventional Commits, sem escopo, uma linha, até 72 caracteres.

## Regras de arquitetura

Estas não são estilo, são o que mantém o projeto consertável quando o site
mudar (veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. Nenhuma rede fora de `src/core/http.ts`.
2. Só `src/mercadolivre/parser/` conhece os bricks e os campos do site.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`; `playwright-core`
   só em `src/session/login.ts`, por import dinâmico.
4. Dinheiro em centavo inteiro para dentro; decimal só na borda da tool.
5. stdout é do JSON-RPC. Log só no stderr, com valores de cookie redigidos.
6. Falha de tool vira `isError`, nunca crash.
7. Nada de escrita na conta. Nem uma tool, nem um host novo no `raw_get`.

## Testes

Escreva o teste antes. Sem framework de mock: `fetch`, relógio, `sleep` e
`random` são injetados, o SQLite roda em memória e os fixtures são páginas
reais anonimizadas.

- Mudou um parser? Incremente `PARSER_VERSION` em `src/cache/sync.ts` e rode
  `bun test test/local` sobre uma captura real (`scripts/capture-fixtures.ts`).
- Mudou uma tool? Rode `bun run docs:tools`.
- `test/integration/` faz chamadas reais e só roda com `MERCADOLIVRE_LIVE=1` e
  uma sessão salva; `test/local/` roda sobre as capturas cruas em
  `task/captures/`. Os dois se auto-ignoram quando não há o que testar.

## Publicando

A tag `vX.Y.Z` dispara o release: binários para Linux, macOS e Windows, e o
publish no npm por OIDC (trusted publishing, sem token).

Uma ressalva do npm: a primeira versão de um pacote novo não sai por OIDC. O
npmjs exige que o pacote exista para configurar o trusted publisher, e exige o
trusted publisher para publicar ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).
A `0.1.0` foi publicada à mão e o trusted publisher configurado depois. O
workflow pula a publicação quando a versão já está no registro, em vez de
falhar.

## Dado pessoal

O repositório é público. Capturas cruas ficam em `task/captures/`, que é
gitignored, e só entram em `test/fixtures/` depois de passar por
`scripts/anonymize-fixture.ts`, que falha se sobrar qualquer dado original.
Leia [`test/fixtures/README.md`](test/fixtures/README.md). Nunca cole cookies,
`session.enc`, `session.key` nem ids reais numa issue.
