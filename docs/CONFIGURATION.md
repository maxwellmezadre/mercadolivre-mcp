# Configuração

Tudo vem do ambiente (AR-9). Nenhum arquivo `.env` é lido. Valores malformados
falham no boot, com todos os problemas listados de uma vez; valores ausentes
nunca falham no boot: falham na hora da chamada, com uma mensagem que diz o
que fazer.

## Variáveis

| Variável | Default | O que faz |
| --- | --- | --- |
| `MERCADOLIVRE_CONFIG_DIR` | `~/.config/mercadolivre-mcp` | Raiz de tudo que é gravado. `~/` é expandido à mão, porque config de cliente MCP é JSON, não shell |
| `MERCADOLIVRE_SESSION_KEY` | — | Chave AES em base64 de 32 bytes (`openssl rand -base64 32`). Sem ela, uma é gerada em `session.key` |
| `MERCADOLIVRE_EXPORT_DIR` | `~/Downloads/mercadolivre-export` | Único diretório em que `export`, `download_invoice` e `export_invoices` podem escrever |
| `MERCADOLIVRE_READ_ONLY` | `0` | Não registra `login`, `sync`, `download_invoice`, `export_invoices` e `export` |
| `MERCADOLIVRE_IMPORT_BROWSER` | — | `dia`, `arc`, `chrome`, `chromium`, `brave` ou `edge`: o `login` importa daí em vez de abrir uma janela |
| `MERCADOLIVRE_LOGIN_BROWSER` | navegador padrão | Navegador da janela de login: caminho do `.app` (macOS), executável ou bundle id. Precisa expor DevTools |
| `MERCADOLIVRE_COOKIE` | — | Header `Cookie` completo do site. Vence a sessão salva e nunca é gravado |
| `MERCADOLIVRE_USER_AGENT` | o salvo no login | User-Agent enviado ao site |
| `MERCADOLIVRE_MIN_INTERVAL_MS` | `1200` | Intervalo mínimo entre duas requisições |
| `MERCADOLIVRE_JITTER_MS` | `400` | Variação aleatória somada ao intervalo |
| `MERCADOLIVRE_HTTP_TIMEOUT_MS` | `30000` | Timeout de cada requisição (mínimo 1000) |
| `MERCADOLIVRE_LOG_FILE` | — | Espelha os logs num arquivo. Eles sempre vão para o stderr também |
| `MERCADOLIVRE_LIVE` | — | `=1` destrava `test/integration` |

Aceita como booleano: `1/0`, `true/false`, `yes/no`, `on/off`. Qualquer outra
coisa é erro, não um default silencioso.

Nomes antigos, ainda aceitos com um aviso no stderr: `MERCADOLIVRE_HOME`
(`_CONFIG_DIR`), `MERCADOLIVRE_DOWNLOAD_DIR` (`_EXPORT_DIR`),
`MERCADOLIVRE_REQUEST_INTERVAL_MS` (`_MIN_INTERVAL_MS`) e `MERCADOLIVRE_REAL`
(`_LIVE`). Quando os dois estão definidos, o novo vence.

## Arquivos em disco

| Arquivo | Modo | Conteúdo |
| --- | --- | --- |
| `session.enc` | `0600` | Cookies + User-Agent + data do login, cifrados com AES-256-GCM |
| `session.key` | `0600` | Chave gerada no primeiro login, se `MERCADOLIVRE_SESSION_KEY` não existir |
| `cache.db` (+ `-wal`, `-shm`) | `0600` | Compras, produtos, NF-e, categorias, estado do sync |
| `browser-profile/` | `0700` | Perfil persistente do navegador usado na janela de login |

O diretório é criado com `0700` e o `umask` é forçado na criação do banco,
para que nenhum deles fique legível por outros usuários da máquina. Apague
`session.enc` para "deslogar"; apague `cache.db` para recomeçar do zero
(`sync --full` recria).

Arquivos de versões anteriores são migrados na primeira execução:
`session.json` vira `session.enc`, `cache.sqlite` vira `cache.db` e `profile/`
vira `browser-profile/`.

## Registro no Claude Code

```sh
claude mcp add -s user mercadolivre -- /Users/você/.local/bin/mercadolivre mcp
```

Sempre com caminho absoluto: clientes MCP não herdam o `PATH` do shell. Uma
entrada com o mesmo nome no escopo do projeto tem precedência sobre a de
usuário; `scripts/install.ts` remove essas entradas justamente por isso.

Variante somente leitura, para um agente menos confiável:

```sh
claude mcp add -s user mercadolivre -e MERCADOLIVRE_READ_ONLY=1 -- /Users/você/.local/bin/mercadolivre mcp
```

Claude Desktop ou qualquer cliente que leia `mcpServers`:

```json
{
  "mcpServers": {
    "mercadolivre": {
      "command": "/Users/você/.local/bin/mercadolivre",
      "args": ["mcp"],
      "env": { "MERCADOLIVRE_IMPORT_BROWSER": "chrome" }
    }
  }
}
```

## Ritmo e anti-bot

O default é uma requisição a cada 1,2 a 1,6 segundos, sempre serial, com
backoff de 2 e 8 segundos em 403 e 429 (três tentativas). Um `sync` completo de
cerca de 70 compras custa entre 140 e 180 requisições, uns 3 minutos. O site
não publica quota; esse ritmo rodou a captura inteira da conta de referência
sem nunca ver um 403. Não rode dois `sync` ao mesmo tempo.
