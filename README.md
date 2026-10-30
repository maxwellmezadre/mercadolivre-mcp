# mercadolivre-mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3-black.svg)](https://bun.sh)
[![TypeScript: strict](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/mercadolivre-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/mercadolivre-mcp/actions/workflows/ci.yml)

CLI + servidor MCP para o histórico de compras da sua conta do Mercado Livre
(lado comprador): compras, produtos, preço cheio e pago, descontos e cupons,
parcelamento, meio de pagamento, vendedor, entrega e notas fiscais (NF-e em PDF
e XML), com cache local em SQLite para responder "quanto gastei em 2025 com
limpeza?" sem bater no site a cada pergunta.

O Mercado Livre não tem API pública do lado comprador: a API oficial é para
vendedores e responde 403 ao resto. Este projeto lê a mesma superfície web que
o seu navegador usa (as páginas de "Minhas compras" e o endpoint das NF-e),
autenticado pelos cookies da sua própria sessão. Somente leitura: nenhuma
operação de escrita na conta existe, e o `raw_get` só faz GET em dois hosts do
site.

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
- [Licença](#licença)

## Instalação

Requer [Bun](https://bun.sh) 1.3 ou mais novo (o cache usa `bun:sqlite`).

### Tudo de uma vez (Claude Code)

```sh
git clone https://github.com/maxwellmezadre/mercadolivre-mcp.git
cd mercadolivre-mcp
bun install
bun run setup
```

O `setup` compila o binário para `~/.local/bin/mercadolivre`, registra o
servidor MCP `mercadolivre` no seu `~/.claude.json` (escopo de usuário, com
caminho absoluto) e instala a Skill em `~/.claude/skills/mercadolivre-mcp/`.
Rode de novo para atualizar. Com `--import-browser chrome` o registro já sai
com `MERCADOLIVRE_IMPORT_BROWSER=chrome`.

### npm

```sh
npm i -g @maxwellmezadre/mercadolivre-mcp   # instala `mercadolivre` e `mercadolivre-mcp` no PATH
mercadolivre --version
```

O pacote roda com o Bun (por causa do `bun:sqlite`), então o Bun precisa estar
instalado. Sem instalar nada:

```sh
bunx -p @maxwellmezadre/mercadolivre-mcp mercadolivre purchases
```

O `-p` e o nome do executável são necessários: o pacote declara dois binários
e, sem eles, `bunx @maxwellmezadre/mercadolivre-mcp` executa o homônimo do
pacote, que é o servidor MCP, e não a CLI.

### Binário único

```sh
bun run build:binary   # gera ./mercadolivre, sem precisar de runtime instalado
./mercadolivre --version
```

O binário embute tudo, inclusive o `playwright-core` que o `login` usa. Os
binários de cada [Release](https://github.com/maxwellmezadre/mercadolivre-mcp/releases)
são esses mesmos, para Linux, macOS e Windows.

## Login

A senha nunca passa por aqui. Dois caminhos:

```sh
mercadolivre login                        # abre o seu navegador padrão para você entrar
mercadolivre login --from-browser chrome  # importa a sessão de um navegador já logado (macOS)
```

O primeiro abre o navegador padrão do sistema, que precisa ser o Google Chrome
ou outro Chromium que exponha o DevTools (Brave, Edge, Vivaldi, Chromium).
Safari e Firefox são outros motores, e o Arc não aceita automação: nesses casos
a ferramenta avisa e usa outro navegador compatível que já esteja instalado. O
segundo é o mais rápido se você já usa o site no Chrome, no Arc, no Brave ou no
Edge: ele lê os cookies pelo Keychain (o macOS pede permissão uma vez) e não
abre janela nenhuma.

A sessão é gravada cifrada com AES-256-GCM em
`~/.config/mercadolivre-mcp/session.enc` (0600). Sem navegador nenhum,
`MERCADOLIVRE_COOKIE` aceita o header `Cookie` copiado do DevTools. Detalhes em
[`docs/LOGIN.md`](docs/LOGIN.md).

## Uso — CLI

```sh
mercadolivre status --verify             # o site ainda aceita a sessão?
mercadolivre sync --full                 # primeira carga: ~3 min para ~70 compras
mercadolivre purchases --date 3M         # compras dos últimos 3 meses, do cache
mercadolivre purchase 2000000000000001   # detalhe: financeiro, parcelas, produtos, vendedor, NF-e
mercadolivre search "café"               # entre os produtos que você já comprou
mercadolivre products --seller "gallo"   # produtos comprados, com preço pago e unitário
mercadolivre product-history --title "azeite"
mercadolivre spending --by month         # quanto você gastou por mês
mercadolivre installments                # parcelas em aberto (estimativa)
mercadolivre export --format csv --scope products
mercadolivre export-invoices --date Y    # NF-e do ano em PDF e XML
mercadolivre doctor                      # qual camada quebrou
```

Todo comando aceita `--json` e imprime exatamente o que o cliente MCP
receberia. Referência completa em [`docs/CLI.md`](docs/CLI.md).

## Uso — MCP

```sh
claude mcp add -s user mercadolivre -- /Users/você/.local/bin/mercadolivre mcp
```

Ou, à mão, em `~/.claude.json`:

```json
{
  "mcpServers": {
    "mercadolivre": {
      "type": "stdio",
      "command": "/Users/você/.local/bin/mercadolivre",
      "args": ["mcp"]
    }
  }
}
```

Use o caminho absoluto: clientes MCP não herdam o `PATH` do seu shell. Depois
é só perguntar: "quanto gastei no Mercado Livre este ano?", "quantas vezes
comprei esse café e a que preço?", "me manda as notas fiscais de 2025".

## Variáveis de ambiente

Todas opcionais. A tabela completa está em
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

| Variável | Default | Para quê |
| --- | --- | --- |
| `MERCADOLIVRE_CONFIG_DIR` | `~/.config/mercadolivre-mcp` | Onde ficam sessão, chave, cache e perfil do navegador |
| `MERCADOLIVRE_SESSION_KEY` | gerada em `session.key` | Chave AES em base64 de 32 bytes |
| `MERCADOLIVRE_EXPORT_DIR` | `~/Downloads/mercadolivre-export` | O único diretório onde `export`, `download_invoice` e `export_invoices` escrevem |
| `MERCADOLIVRE_READ_ONLY` | `0` | Não registra as tools que escrevem em disco |
| `MERCADOLIVRE_IMPORT_BROWSER` | — | `dia` \| `arc` \| `chrome` \| `chromium` \| `brave` \| `edge`: o `login` importa daí |
| `MERCADOLIVRE_LOGIN_BROWSER` | navegador padrão | Navegador da janela de login: `.app`, executável ou bundle id |
| `MERCADOLIVRE_COOKIE` | — | Header `Cookie` completo; vence a sessão salva e nunca é gravado |
| `MERCADOLIVRE_MIN_INTERVAL_MS` | `1200` | Intervalo mínimo entre requisições |

Nomes antigos (`MERCADOLIVRE_HOME`, `MERCADOLIVRE_DOWNLOAD_DIR`,
`MERCADOLIVRE_REQUEST_INTERVAL_MS`, `MERCADOLIVRE_REAL`) continuam funcionando
com um aviso.

## Tools

São 18, iguais no MCP e no CLI. Referência gerada:
[`docs/TOOLS.md`](docs/TOOLS.md).

| Tool | Comando | Rede |
| --- | --- | --- |
| `auth_status` | `mercadolivre status [--verify]` | 0 (1 com `--verify`) |
| `login` | `mercadolivre login [--from-browser]` | 1, para confirmar a sessão |
| `doctor` | `mercadolivre doctor` | ≤ 4 |
| `sync` | `mercadolivre sync [--full\|--reparse]` | 1 por página, 1 por compra, NF-e e categorias |
| `list_purchases` | `mercadolivre purchases` | 0 (site com `--live` ou cache vazio) |
| `get_purchase` | `mercadolivre purchase <id>` | 1 (2 com a NF-e) |
| `search_purchases` | `mercadolivre search <texto>` | 0 (1 com `--live`) |
| `list_categories` | `mercadolivre categories` | 0 (1 se o cache estiver vazio) |
| `list_products` | `mercadolivre products` | 0 |
| `product_history` | `mercadolivre product-history` | 0 |
| `list_installments` | `mercadolivre installments` | 0 |
| `list_payment_methods` | `mercadolivre payment-methods` | 0 |
| `get_invoice` | `mercadolivre invoice <orderId>` | 1 |
| `download_invoice` | `mercadolivre download-invoice <orderId>` | 1 |
| `export_invoices` | `mercadolivre export-invoices` | 1 por arquivo |
| `spending_summary` | `mercadolivre spending --by …` | 0 |
| `export` | `mercadolivre export` | 0 |
| `raw_get` | `mercadolivre raw <url>` | 1 |

## Como funciona

1. A lista de compras é uma página server-side (Nordic/Flox) com o JSON
   embutido em `<script id="__NORDIC_RENDERING_CTX__">`; os parsers leem esse
   JSON, nunca o HTML.
2. Uma compra (`purchase_id`) contém pacotes (`pack_id`) que contêm pedidos
   (`order_id`), e cada pedido é um produto. Tudo é agregado por compra: contar
   pedidos como compras infla o número por cerca de 3 vezes. Ver
   [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md).
3. O `sync` percorre as páginas a uma requisição a cada 1,2 a 1,6 segundos,
   busca o detalhe de cada compra uma única vez, as NF-e e as categorias, e
   grava tudo em SQLite com dinheiro em centavos inteiros. As demais tools
   consultam o cache.
4. Quando o site mudar, `doctor` diz qual endpoint quebrou e `raw_get` mostra
   o payload real; o roteiro está em [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md).

## Troubleshooting

| Sintoma | O que fazer |
| --- | --- |
| `Nenhuma sessão do Mercado Livre salva` | `mercadolivre login` ou `mercadolivre login --from-browser chrome` |
| `A sessão do Mercado Livre expirou ou foi recusada` | O site respondeu com a página de login. Faça o login de novo; troca de senha, logout e inatividade longa matam a sessão |
| `HTTP 403 … rate limit ou bloqueio` | Espere alguns minutos. Não rode dois `sync` ao mesmo tempo nem reduza `MERCADOLIVRE_MIN_INTERVAL_MS` |
| `Não foi possível decifrar session.enc` | A chave mudou (`MERCADOLIVRE_SESSION_KEY` ou `session.key`). Apague `session.enc` e faça o login de novo |
| Compra grande com produtos sem preço | O detalhe só traz parte das linhas; o `sync` completa com a NF-e (`priceSource: "invoice"`, valor bruto) |
| `list_categories` vazio | O site não oferece o filtro de categoria para toda conta. Não é erro |
| O navegador padrão não serve para o login | Instale o Chrome, aponte `MERCADOLIVRE_LOGIN_BROWSER` ou use `--from-browser` |
| Layout novo do site | `mercadolivre doctor` diz qual camada quebrou; [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) diz como remapear |

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Camadas, fluxo e as regras que as separam |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Todas as variáveis e os arquivos em disco |
| [`docs/USAGE.md`](docs/USAGE.md) | Do zero à primeira resposta |
| [`docs/CLI.md`](docs/CLI.md) | Todos os comandos |
| [`docs/TOOLS.md`](docs/TOOLS.md) | Referência das tools (gerada) |
| [`docs/LOGIN.md`](docs/LOGIN.md) | Como o login funciona, o que grava, como revogar |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | A hierarquia de ids, o dinheiro, o cache e o que não existe |
| [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) | A superfície interna do site: endpoints, formato Flox, armadilhas |
| [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) | O que fazer quando o Mercado Livre mudar |
| [`docs/PRD.md`](docs/PRD.md) | Os requisitos que o código cita (F-n, NFR-n, AR-n) |
| [`docs/adr/`](docs/adr) | As decisões de projeto e por quê |

## Licença

[MIT](LICENSE). Uso pessoal, na sua própria conta, em volume baixo: sem
revenda de dados, sem compartilhar a sessão, sem coletar dados de terceiros.
