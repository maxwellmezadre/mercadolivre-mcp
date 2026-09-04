# ADR-0002 — Runtime Bun e `bun:sqlite`

- **Status:** Aceito
- **Contexto:** o cache local é obrigatório (origem lenta, ~1 MB por página, rate limit,
  perguntas analíticas). O trello-cli suportava Node ≥ 18; aqui o SQLite pesa na escolha.

## Decisão

Bun ≥ 1.2 como único runtime, `bun:sqlite` para o cache (síncrono, FTS5, zero
dependência) e `bun build --compile` para distribuir um binário sem runtime instalado.

## Consequências

- Sem `node:sqlite`/`better-sqlite3` e sem camada de abstração de banco.
- `npm i -g` funciona, mas exige Bun instalado; o binário das Releases não exige nada.
- O `login` (Playwright) não entra no binário: roda pelo checkout/npm ou usa
  `MERCADOLIVRE_COOKIE`.
