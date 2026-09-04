# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.1.0] - 2026-09-04

### Added

- Login interativo (`mercadolivre login`) no navegador padrão do sistema (Chromium-based;
  aviso e instrução de instalação para Safari/Firefox) e `MERCADOLIVRE_COOKIE`
  como alternativa; sessão em `session.json` (0600) com cookies renovados a cada resposta.
- Cliente HTTP serial (1 req/s + jitter, backoff em 403/429, redirect manual com
  detecção de login).
- Parsers do formato Nordic/Flox: lista, detalhe (financeiro por rótulo, parcelas,
  endereço, vendedor, produtos), NF-e (overview e XML).
- Cache SQLite (`bun:sqlite`, centavos, FTS5) e `sync` full / incremental / reparse com
  passo de categorias e complemento de preços pela NF-e.
- 16 tools MCP e os comandos equivalentes na CLI: `auth_status`, `doctor`,
  `list_purchases`, `get_purchase`, `search_purchases`, `list_categories`,
  `list_products`, `product_history`, `spending_summary`, `list_installments`,
  `list_payment_methods`, `get_invoice`, `download_invoice`, `export_invoices`,
  `sync`, `raw_get`.
- Anonimizador determinístico de fixtures, scripts de captura e de geração de
  `docs/TOOLS.md`, documentação em pt-BR e ADRs.

[Unreleased]: https://github.com/maxwellmezadre/mercadolivre-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/maxwellmezadre/mercadolivre-mcp/releases/tag/v0.1.0
