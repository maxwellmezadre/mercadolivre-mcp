# ADR-0002: Runtime Bun e `bun:sqlite`

## Contexto

O cache local é obrigatório: a origem é lenta, cada página pesa perto de 1 MB,
há rate limit e as perguntas são analíticas. O SQLite pesa na escolha do
runtime.

## Decisão

Bun 1.3 ou mais novo como único runtime, `bun:sqlite` para o cache (síncrono,
FTS5, zero dependência) e `bun build --compile` para distribuir um binário sem
runtime instalado. O `playwright-core` entra no binário; só o `chromium-bidi`,
um require dinâmico que o compilador não resolve e que este projeto não usa,
fica de fora.

## Consequências

Sem `node:sqlite`, sem `better-sqlite3` e sem camada de abstração de banco.
`npm i -g` funciona, mas exige Bun instalado; o binário das Releases não exige
nada e faz tudo, inclusive o `login`.
