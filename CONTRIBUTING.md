# Contribuindo

## Setup

```sh
bun install
bun test
bunx tsc --noEmit
```

Sem linter: o gate é `tsc` estrito + `bun test`. Código, comentários e commits em
inglês; documentação em pt-BR.

## Fluxo

1. Abra uma issue descrevendo o problema (ou o endpoint que mudou — cole a saída de
   `mercadolivre doctor --json`, **nunca** cookies).
2. Teste primeiro: todo comportamento novo entra com um teste que falha antes.
3. Arquivos de lógica abaixo de ~400 linhas; parsers puros; nada de rede fora de
   `src/core/http.ts`.
4. Dinheiro em centavos dentro do sistema; reais só na saída das tools.
5. Mudou um parser? Incremente `PARSER_VERSION` em `src/sync/sync.ts` e rode
   `bun test test/local` sobre uma captura real (`scripts/capture-fixtures.ts`).
6. Mudou uma tool? Regenere a referência: `bun run scripts/gen-tools-doc.ts`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org) sem escopo, uma linha,
inglês, ≤ 72 caracteres: `feat: add purchase list parser`.

## Testes

- `bun test` — unitários (fixtures sintéticos e anonimizados, SQLite em memória).
- `MERCADOLIVRE_REAL=1 bun test test/integration` — contra o site real, com sessão.
- `bun test test/local` — sobre as capturas cruas privadas em `task/captures/`.

## Fixtures

Capturas reais nunca entram no repositório. Use `scripts/anonymize-fixture.ts` e leia
`test/fixtures/README.md`.

## Checklist de PR

- [ ] `bun test` verde e `bunx tsc --noEmit` limpo
- [ ] Docs atualizadas quando o comportamento muda (`README`, `docs/`, `SKILL.md`)
- [ ] Nenhum dado pessoal (ids reais, cookies, endereço) em fixtures ou logs
