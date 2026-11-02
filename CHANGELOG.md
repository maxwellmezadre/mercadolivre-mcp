# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).


## [Unreleased]

### Fixed

- O Mercado Livre redesenhou a lista e o detalhe das compras (`/post-purchase/my-purchases`) e o `sync` parou com "floxResponse.data.brick não encontrado". A lista agora vem da página nova e da API dela, página a página até uma vazia, e o detalhe tem parser próprio. O parser antigo continua para as páginas já em cache.

### Changed

- Compras novas: o valor pago por produto parte do valor da lista (antes do cupom) e é acertado ao total da compra.
- Compras novas não trazem mais o texto e a data de entrega nem o `shipmentId`, que a lista deixou de mostrar. O vendedor pode vir sem nome quando a página mostra só o assistente de mensagens.
- Uma passada de lista não apaga mais a quantidade, a situação, a entrega, o preço ou a data que o cache já sabia.

## [0.2.0] - 2026-09-07

Padronização com os outros MCPs de histórico de compras (amazon, shein,
shopee, aliexpress). A conta continua somente leitura; o que muda é a
superfície local.

### Added

- Tool `login` (e `mercadolivre login --fresh`): o login também pode ser
  disparado pelo cliente MCP.
- `mercadolivre login --from-browser arc|chrome|chromium|brave|edge` e a
  variável `MERCADOLIVRE_IMPORT_BROWSER`: importa a sessão de um navegador já
  logado, pelo Keychain do macOS, sem abrir janela.
- Tool `export` (e `mercadolivre export --format csv|json --scope
  purchases|products`): o cache em planilha, dentro de
  `MERCADOLIVRE_EXPORT_DIR`.
- `MERCADOLIVRE_READ_ONLY=1`: não registra `login`, `sync`, `download_invoice`,
  `export_invoices` e `export`.
- `MERCADOLIVRE_SESSION_KEY` e `MERCADOLIVRE_JITTER_MS`.
- `bun run verify` (`scripts/verify.ts`): typecheck, testes e as invariantes do
  servidor MCP real sobre stdio; é o que a CI roda.
- `bun run setup` (`scripts/install.ts`) agora compila o binário e o instala
  em `~/.local/bin/mercadolivre`, com `--import-browser`, `--prefix`,
  `--skip-build` e `--dry-run`.
- Recarga automática da sessão: um `login` feito pelo terminal é percebido
  pelo servidor MCP em execução (pela data de modificação de `session.enc`),
  sem reiniciar.
- `docs/LOGIN.md`, ADR-0006 (sessão cifrada) e ADR-0007 (centavos inteiros).

### Changed

- A sessão passa a ser gravada cifrada com AES-256-GCM em `session.enc`, com
  a chave em `session.key` (0600) ou em `MERCADOLIVRE_SESSION_KEY`. Um
  `session.json` existente é lido uma vez, regravado cifrado e apagado.
- Arquivos sob o diretório de configuração: `cache.db` (era `cache.sqlite`) e
  `browser-profile/` (era `profile/`). Os antigos são renomeados na primeira
  execução.
- `auth_status` devolve `loggedIn`, `httpOnlyCount`, `ageDays` e
  `soonestExpiry` (eram `authenticated` e `earliestCookieExpiry`), e reporta um
  arquivo de sessão ilegível em vez de falhar.
- Descrições de tools, help do CLI, mensagens de erro e avisos em pt-BR.
- `mercadolivre spending --by` (era `--group-by`).
- Ritmo entre requisições: `MERCADOLIVRE_MIN_INTERVAL_MS` (default 1200) mais
  um jitter aleatório de até `MERCADOLIVRE_JITTER_MS` (default 400). É o mesmo
  intervalo efetivo de antes (1,2 a 1,6 s), agora configurável nas duas partes.
- O default de `MERCADOLIVRE_EXPORT_DIR` é `~/Downloads/mercadolivre-export`
  (era `~/Downloads/mercadolivre-nfe`).
- `playwright-core` virou dependência normal e entra no binário compilado: o
  `login` funciona a partir do binário e dos Releases.
- Cookies host-only de subdomínios (`myaccount.mercadolivre.com.br`) passam a
  ser guardados no login; antes só os do domínio raiz sobreviviam ao filtro.
- Layout do código: `src/session/` (era `src/auth/`), `src/cache/` (era
  `src/store/` e `src/sync/`), `src/mercadolivre/` (era `src/meli/`).
- ADRs renumerados para a numeração compartilhada entre os MCPs.
- Bun 1.3 ou mais novo.

### Deprecated

- `MERCADOLIVRE_HOME`, `MERCADOLIVRE_DOWNLOAD_DIR`,
  `MERCADOLIVRE_REQUEST_INTERVAL_MS` e `MERCADOLIVRE_REAL`: continuam
  funcionando, com um aviso no stderr. Use `MERCADOLIVRE_CONFIG_DIR`,
  `MERCADOLIVRE_EXPORT_DIR`, `MERCADOLIVRE_MIN_INTERVAL_MS` e
  `MERCADOLIVRE_LIVE`.

### Removed

- `scripts/setup.ts` (instalava o pacote npm global). Substituído por
  `scripts/install.ts`.

## [0.1.0] - 2026-09-05

### Added

- Login interativo (`mercadolivre login`) no navegador padrão do sistema (Chrome, Brave,
  Edge, Vivaldi; aviso, fallback ou instrução de instalação para Safari, Firefox e Arc) e
  `MERCADOLIVRE_COOKIE` como alternativa; sessão em `session.json` (0600) com cookies
  renovados a cada resposta.
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
- Parsers validados contra a conta real (68 compras, 113 pedidos): linhas de pagamento
  no ticket, reembolso, pagamento dividido, retirada no vendedor, status de cancelamento,
  quantidade vs tamanho do pacote, junção das linhas do detalhe pelo id do pedido.

[Unreleased]: https://github.com/maxwellmezadre/mercadolivre-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/maxwellmezadre/mercadolivre-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/maxwellmezadre/mercadolivre-mcp/releases/tag/v0.1.0
