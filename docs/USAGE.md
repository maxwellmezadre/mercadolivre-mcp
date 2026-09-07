# Do zero à primeira resposta

## 1. Instalar

```sh
git clone https://github.com/maxwellmezadre/mercadolivre-mcp.git
cd mercadolivre-mcp
bun install
bun run setup
```

Binário em `~/.local/bin/mercadolivre`, servidor MCP registrado no Claude Code e
Skill em `~/.claude/skills/mercadolivre-mcp/`. Ou `npm i -g
@maxwellmezadre/mercadolivre-mcp`, com o Bun instalado.

## 2. Entrar na conta

```sh
mercadolivre login                        # abre o navegador padrão
mercadolivre login --from-browser chrome  # ou importa de um navegador já logado (macOS)
mercadolivre status --verify
```

```
loggedIn: true
verified: true
source: file
nickname: SEUNICK
cookieCount: 19
soonestExpiry: 2026-10-01T12:00:00.000Z
```

## 3. Baixar o histórico

```sh
mercadolivre sync --full
```

Cerca de 3 minutos para 70 compras: uma requisição por página da lista, uma por
compra (o detalhe), o overview das NF-e em lotes e, se houver, uma por
categoria. O progresso sai no stderr. Depois disso, `mercadolivre sync`
incremental para na primeira página sem novidade.

## 4. Perguntar

```sh
mercadolivre purchases --date 3M
mercadolivre spending --by month --date Y
mercadolivre spending --by category --date 1Y     # se o site oferecer o filtro
mercadolivre product-history --title "café torrado"
mercadolivre products --seller "gallo"
mercadolivre installments                          # estimativa, confira na fatura
mercadolivre export-invoices --date 1Y --format both
mercadolivre export --format csv --scope products
```

Os arquivos de `export` e das NF-e vão para `MERCADOLIVRE_EXPORT_DIR`
(default `~/Downloads/mercadolivre-export`), as notas como `nfe-<orderId>.pdf`
e `.xml`, uma por pedido.

Detalhe de uma compra:

```sh
mercadolivre purchases --search "garrafa"          # pega purchaseId e detailRef
mercadolivre purchase 2000000000000001 --pack 2000000000000001 --order 2000000000000001
```

Sem `--pack/--order`, a ferramenta procura o par no cache e, se preciso, varre
a lista, uma requisição por página.

## 5. Pelo Claude

Reinicie o Claude Code e pergunte em português:

- "quanto gastei no Mercado Livre este ano?"
- "quantas vezes comprei esse café e a que preço?"
- "quais compras eu parcelei e quanto ainda falta?"
- "me manda as notas fiscais de 2025"

O Claude usa `auth_status`, depois `sync` se o cache estiver vazio, depois a
tool certa. A Skill já ensina as regras que evitam resposta errada, sobretudo
que compra não é pedido e que parcelas são estimativa. No Claude Desktop, faça
a carga inicial pelo terminal: o timeout de tools lá é curto.

## Manutenção

```sh
mercadolivre sync              # incremental
mercadolivre sync --full       # percorre todo o histórico de novo
mercadolivre sync --reparse    # reprocessa o cache sem rede, depois de atualizar
mercadolivre doctor            # quando algo falhar de um jeito estranho
```

O status de entrega e a NF-e de compras recentes mudam com o tempo; compras
entregues ou canceladas nunca são refeitas.
