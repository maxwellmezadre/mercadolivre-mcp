# Uso

## Setup (uma vez)

```sh
bun install
bun run src/bin.ts login          # abre o navegador padrão (Chromium-based); sessão em ~/.config/mercadolivre-mcp
bun run src/bin.ts status --verify
bun run src/bin.ts sync --full    # carga inicial: ~3 min para ~70 compras
```

Com `bun link` (ou o pacote npm) os exemplos abaixo usam `mercadolivre` direto.

## Cache e site

Por padrão as tools leem o cache SQLite (`~/.config/mercadolivre-mcp/cache.sqlite`).
O site só é consultado:

- por `sync` (incremental por padrão: página 1 até uma página já conhecida, detalhes
  das compras novas e das que ainda não chegaram);
- por `list_purchases` com `fromCache=false` (`--live`), `search_purchases` com
  `scope=live` (`--live`) e `get_purchase` (sempre busca o detalhe no site);
- enquanto o cache está vazio (`list_purchases` avisa com `note`).

Rode `mercadolivre sync` de vez em quando (ou peça ao agente). O status de entrega e
a NF-e de compras recentes mudam com o tempo; compras entregues ou canceladas nunca
são refeitas.

## Receitas

**Quanto gastei por mês este ano?**

```sh
mercadolivre spending --date Y --json
```

**Quanto gastei em uma categoria?**

```sh
mercadolivre categories
mercadolivre spending --group-by category --date 1Y
```

**Recompras e evolução de preço de um produto**

```sh
mercadolivre product-history --title "café torrado"
mercadolivre product-history --item MLB2086446083
```

**Parcelas ainda em aberto (estimativa)**

```sh
mercadolivre installments
```

A ferramenta não vê o cronograma real: assume cobranças mensais a partir da data do
pagamento. Confira na fatura do cartão.

**Todas as NF-e de um período para a contabilidade**

```sh
mercadolivre export-invoices --date 1Y --format both
```

Os arquivos vão para `MERCADOLIVRE_DOWNLOAD_DIR` (default `~/Downloads/mercadolivre-nfe`),
como `nfe-<orderId>.pdf` e `.xml`. Uma nota por pedido (= por produto).

**Detalhe de uma compra**

```sh
mercadolivre purchases --search "garrafa"          # pega purchaseId e detailRef
mercadolivre purchase 2000000000000001 --pack 2000000000000001 --order 2000000000000001
```

Sem `--pack/--order`, a ferramenta procura o par no cache e, se preciso, varre a lista
(uma requisição por página).

## Claude Code

A partir do checkout, `bun run setup` instala o pacote global, registra o servidor no
escopo de usuário e copia a Skill para `~/.claude/skills/mercadolivre-mcp/`. À mão:

```sh
claude mcp add -s user mercadolivre -- mercadolivre mcp
```

Ou, a partir do checkout:

```sh
claude mcp add -s user mercadolivre -- bun run /caminho/para/mercadolivre-mcp/src/bin.ts mcp
```

Em uma sessão nova: "rode auth_status", "faça um sync", "quanto gastei em agosto?".
O `sync --full` cabe no timeout do Claude Code (30 min para stdio), mas é mais
confortável no terminal.

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mercadolivre": {
      "command": "/caminho/para/mercadolivre",
      "args": ["mcp"],
      "env": { "MERCADOLIVRE_HOME": "/Users/voce/.config/mercadolivre-mcp" }
    }
  }
}
```

O Claude Desktop tem timeout curto para tools: faça a carga inicial pelo terminal
(`mercadolivre sync --full`) e deixe o agente com os `sync` incrementais.

## Sem navegador

```sh
export MERCADOLIVRE_COOKIE="$(pbpaste)"   # header Cookie copiado do DevTools
mercadolivre status --verify
```

Como copiar: DevTools → Network → qualquer requisição para `myaccount.mercadolivre.com.br`
→ Request Headers → `Cookie` → Copy value. Os cookies HTTP-only só aparecem aí, nunca em
`document.cookie`.
