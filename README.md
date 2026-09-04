# mercadolivre-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.2-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/mercadolivre-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/mercadolivre-mcp/actions/workflows/ci.yml)

Um CLI que **também** embute um servidor MCP, sobre um núcleo compartilhado, para o
**histórico de compras da sua conta do Mercado Livre** (lado comprador): compras,
produtos, preço cheio e pago, descontos e cupons, parcelamento, meio de pagamento,
vendedor, entrega e notas fiscais (NF-e em PDF e XML).

O Mercado Livre não tem API pública do lado comprador. Esta ferramenta lê a mesma
superfície web que o seu navegador usa, com a **sua sessão** (você faz o login; a
senha nunca passa por aqui), e guarda tudo num cache SQLite local para responder
na hora perguntas como "quanto gastei em 2025 com limpeza?" ou "quantas vezes
comprei esse café e a que preço?". A conta é **somente leitura**.

## Sumário

- [Instalação](#instalação)
- [Login](#login)
- [Uso — CLI](#uso--cli)
- [Uso — MCP](#uso--mcp)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Tools](#tools)
- [Como funciona](#como-funciona)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)

## Instalação

Requer [Bun](https://bun.sh) ≥ 1.2 (o cache usa `bun:sqlite`).

```sh
git clone https://github.com/maxwellmezadre/mercadolivre-mcp.git
cd mercadolivre-mcp
bun install
bun run src/bin.ts --help
```

Para ter o comando `mercadolivre` no PATH:

```sh
bun link            # ou: npm i -g @maxwellmezadre/mercadolivre-mcp
```

### Binário único

```sh
bun run build:binary   # gera ./mercadolivre (embute o runtime)
./mercadolivre --version
```

O binário não embute o Playwright: rode o `login` a partir do checkout ou do
pacote npm (`bunx @maxwellmezadre/mercadolivre-mcp login`), ou use
`MERCADOLIVRE_COOKIE` (ver [Configuração](docs/CONFIGURATION.md)).

## Login

```sh
mercadolivre login
```

Abre o **navegador padrão do sistema** na página de compras; você entra normalmente (senha,
2FA, captcha). O navegador precisa ser o Google Chrome ou um baseado em Chromium (Arc,
Brave, Edge, Vivaldi): com Safari ou Firefox como padrão, a ferramenta avisa, usa outro
compatível que já esteja instalado ou pede para instalar um.
Quando a lista de compras carrega, a sessão do navegador é salva em
`~/.config/mercadolivre-mcp/session.json` com permissão `0600`. Não há OAuth nem
refresh token nesta superfície: a sessão dura enquanto o Mercado Livre a mantiver
viva (semanas), e a ferramenta renova os cookies que o site lhe devolve.

Sem navegador disponível, exporte o header `Cookie` copiado do DevTools:

```sh
export MERCADOLIVRE_COOKIE="_d2id=…; ssid=…; orgnickp=…"
```

Confira com `mercadolivre status --verify`.

## Uso — CLI

```sh
mercadolivre sync --full                 # primeira carga: ~3 min para ~70 compras (1 req/s)
mercadolivre purchases --date 3M         # compras dos últimos 3 meses (do cache)
mercadolivre purchase 2000000000000001   # detalhe: financeiro, parcelas, produtos, vendedor, NF-e
mercadolivre search "café" --json        # busca textual no cache
mercadolivre spending --group-by month   # gastos por mês
mercadolivre products --seller "gallo"   # produtos comprados, com preço pago e unitário
mercadolivre product-history --title "azeite"
mercadolivre installments                # parcelas em aberto (estimativa)
mercadolivre export-invoices --date Y    # NF-e do ano em PDF e XML
mercadolivre doctor                      # diagnóstico endpoint a endpoint
```

Todo comando aceita `--json`. Lista completa em [docs/CLI.md](docs/CLI.md).

## Uso — MCP

```sh
mercadolivre mcp        # servidor stdio
```

Claude Code (escopo do usuário):

```sh
claude mcp add -s user mercadolivre -- mercadolivre mcp
```

Claude Desktop ou qualquer cliente que leia `mcpServers`:

```json
{
  "mcpServers": {
    "mercadolivre": {
      "command": "mercadolivre",
      "args": ["mcp"]
    }
  }
}
```

Rodando a partir do checkout, use `"command": "bun"` e
`"args": ["run", "/caminho/para/mercadolivre-mcp/src/bin.ts", "mcp"]`.

Depois do login, peça ao agente para rodar `sync` (ou faça `mercadolivre sync --full`
no terminal: é a carga mais longa e o Claude Desktop tem timeout curto para tools).

## Variáveis de ambiente

Nenhuma é obrigatória.

| Variável | Default | Descrição |
| --- | --- | --- |
| `MERCADOLIVRE_HOME` | `~/.config/mercadolivre-mcp` | Onde ficam `session.json`, `cache.sqlite` e o perfil do navegador |
| `MERCADOLIVRE_COOKIE` | — | Header `Cookie` completo; vence o `session.json` e nunca é gravado |
| `MERCADOLIVRE_DOWNLOAD_DIR` | `~/Downloads/mercadolivre-nfe` | Único diretório onde as NF-e são gravadas |
| `MERCADOLIVRE_REQUEST_INTERVAL_MS` | `1000` | Intervalo mínimo entre requisições (mais jitter de 200–600 ms) |
| `MERCADOLIVRE_HTTP_TIMEOUT_MS` | `30000` | Timeout por requisição |
| `MERCADOLIVRE_USER_AGENT` | o do login | User-Agent enviado ao site |
| `MERCADOLIVRE_LOGIN_BROWSER` | navegador padrão | Navegador do `login`: caminho do `.app`, executável ou bundle id (só Chromium-based) |
| `MERCADOLIVRE_LOG_FILE` | — | Arquivo de log (os logs vão sempre para stderr) |

Referência completa: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Tools

16 tools; todas só leem a conta. Três escrevem no disco local (`sync` no cache,
`download_invoice` e `export_invoices` no diretório de downloads).

- **Sessão e diagnóstico:** `auth_status`, `doctor`.
- **Compras:** `list_purchases`, `get_purchase`, `search_purchases`, `list_categories`.
- **Produtos:** `list_products`, `product_history`.
- **Financeiro:** `spending_summary`, `list_installments`, `list_payment_methods`.
- **Nota fiscal:** `get_invoice`, `download_invoice`, `export_invoices`.
- **Cache e redescoberta:** `sync`, `raw_get`.

Parâmetros de cada uma: [docs/TOOLS.md](docs/TOOLS.md).

## Como funciona

1. A lista de compras é uma página server-side (Nordic/Flox) com o JSON embutido em
   `<script id="__NORDIC_RENDERING_CTX__">`; os parsers leem esse JSON, nunca o HTML.
2. Uma **compra** (`purchase_id`) contém pacotes (`pack_id`) que contêm **pedidos**
   (`order_id`), e cada pedido é **um produto**. Tudo é agregado por compra; contar
   pedidos como compras infla o número por ~3×. Ver [docs/DATA-MODEL.md](docs/DATA-MODEL.md).
3. `sync` percorre as páginas a 1 requisição por segundo, busca o detalhe de cada compra
   uma única vez, as NF-e e as categorias, e grava tudo em SQLite (dinheiro em centavos).
   As demais tools consultam o cache.
4. Quando o site mudar, `doctor` diz qual endpoint quebrou e `raw_get` mostra o payload
   real; o roteiro de redescoberta está em [docs/REDISCOVERY.md](docs/REDISCOVERY.md).

## Troubleshooting

- **`No Mercado Livre session found`** — rode `mercadolivre login` (ou exporte
  `MERCADOLIVRE_COOKIE`).
- **`session expired or rejected`** — o site respondeu com a página de login. Faça o
  login de novo; troca de senha, logout e inatividade longa matam a sessão.
- **`HTTP 403 … rate limited or blocked`** — o site recusou requisições. Espere alguns
  minutos; não rode dois `sync` ao mesmo tempo nem reduza
  `MERCADOLIVRE_REQUEST_INTERVAL_MS`.
- **Compra grande com produtos sem preço** — o detalhe da compra só traz uma parte das
  linhas; `sync` completa o que falta com a NF-e (`priceSource: "invoice"`, valor bruto).
- **`Could not load playwright-core`** — o `login` precisa do Playwright; rode-o pelo
  checkout/npm ou use `MERCADOLIVRE_COOKIE`.
- **Layout novo do site** — `mercadolivre doctor`, depois [docs/REDISCOVERY.md](docs/REDISCOVERY.md).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) · [Configuração](docs/CONFIGURATION.md) ·
  [Uso](docs/USAGE.md) · [Tools](docs/TOOLS.md) · [CLI](docs/CLI.md)
- [Modelo de dados](docs/DATA-MODEL.md) · [API interna do site](docs/INTERNAL-API.md) ·
  [Redescoberta](docs/REDISCOVERY.md)
- [PRD](docs/PRD.md) · [ADRs](docs/adr/) · [Skill para agentes](SKILL.md)

## Licença

[MIT](LICENSE). Uso pessoal, na sua própria conta, em volume baixo: sem revenda de
dados, sem compartilhar a sessão, sem coletar dados de terceiros.
