# Configuração

Toda configuração vem de variáveis de ambiente (AR-9). Nenhuma é obrigatória; valores
malformados falham na hora, listando todos os problemas de uma vez.

## Variáveis

| Variável | Default | Descrição |
| --- | --- | --- |
| `MERCADOLIVRE_HOME` | `~/.config/mercadolivre-mcp` | Diretório dos dados (aceita `~/`) |
| `MERCADOLIVRE_COOKIE` | — | Header `Cookie` completo do site. Vence o `session.json` e **nunca é gravado** |
| `MERCADOLIVRE_DOWNLOAD_DIR` | `~/Downloads/mercadolivre-nfe` | Único diretório em que `download_invoice` / `export_invoices` escrevem |
| `MERCADOLIVRE_REQUEST_INTERVAL_MS` | `1000` | Intervalo mínimo entre requisições; jitter de 200–600 ms é somado |
| `MERCADOLIVRE_HTTP_TIMEOUT_MS` | `30000` | Timeout por requisição (mínimo 1000) |
| `MERCADOLIVRE_USER_AGENT` | o salvo no login | User-Agent enviado ao site (por padrão, o do navegador que fez o login) |
| `MERCADOLIVRE_LOGIN_BROWSER` | navegador padrão | Navegador do `login`: caminho do `.app` (macOS), executável ou bundle id. Precisa expor DevTools (Chrome, Brave, Edge, Vivaldi, Chromium) |
| `MERCADOLIVRE_LOG_FILE` | — | Copia dos logs (que vão sempre para stderr) |

## Arquivos em `MERCADOLIVRE_HOME`

| Arquivo | Permissão | Conteúdo |
| --- | --- | --- |
| `session.json` | `0600` | Cookies de `*.mercadolivre.com.br` (formato storageState do Playwright) + User-Agent |
| `cache.sqlite` (+ `-wal`, `-shm`) | `0600` | Compras, produtos, NF-e, categorias, estado do sync |
| `profile/` | `0700` | Perfil persistente do navegador usado no login |

Apague `session.json` para "deslogar"; apague `cache.sqlite` para recomeçar do zero
(`sync --full` recria).

## Navegador do `login`

O `login` abre o **navegador padrão do sistema** com um perfil próprio (não o seu perfil
do dia a dia). No macOS o padrão vem do handler de `https` do LaunchServices; no Linux,
de `xdg-settings`. Só navegadores Chromium que expõem o DevTools podem ser controlados:
Google Chrome, Brave, Microsoft Edge, Vivaldi, Chromium, Opera. Safari e Firefox são
outros motores; o **Arc** (e o Dia) é Chromium mas não responde nem a
`--remote-debugging-pipe` nem a `--remote-debugging-port`, então também não serve. Nesses
casos (ou com um navegador desconhecido) a ferramenta avisa e usa outro compatível que já
esteja instalado; sem nenhum, ela pede para instalar o Chrome (ou Brave/Edge/Vivaldi) e
defini-lo como padrão. `MERCADOLIVRE_LOGIN_BROWSER` força um navegador específico
(`/Applications/Google Chrome.app`, `/usr/bin/chromium` ou `com.google.Chrome`).

## Obtendo `MERCADOLIVRE_COOKIE` sem o `login`

1. Entre no Mercado Livre no navegador e abra `https://myaccount.mercadolivre.com.br/my_purchases/list`.
2. DevTools → Network → clique em qualquer requisição para `myaccount.mercadolivre.com.br`.
3. Request Headers → `Cookie` → Copy value.
4. `export MERCADOLIVRE_COOKIE="<valor>"`.

Copie o header **inteiro**: o cookie de sessão é HTTP-only e não aparece em
`document.cookie`. Com a variável definida, os cookies renovados pelo site ficam só em
memória; quando ela expirar, repita o processo.

## Registro no cliente MCP

Claude Code: `claude mcp add -s user mercadolivre -- mercadolivre mcp` (acrescente
`-e MERCADOLIVRE_HOME=…` se precisar). Outros clientes: ver
[USAGE.md](USAGE.md).
