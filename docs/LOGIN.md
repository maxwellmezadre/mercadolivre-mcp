# Login

## Por que precisa de um navegador

Não existe OAuth de comprador no Mercado Livre. A sessão são cookies, e o que
autentica de verdade é `HttpOnly`: `document.cookie` não o enxerga. Só o
navegador (via `storageState` do Playwright) ou o banco de cookies dele
entregam a sessão completa. Copiar `document.cookie` à mão produz um jar que
não autentica nada.

## O caminho normal

```sh
mercadolivre login
```

1. Descobre o seu navegador padrão. Ele precisa ser o Google Chrome ou outro
   Chromium que exponha o DevTools: Brave, Microsoft Edge, Vivaldi, Chromium,
   Opera. Safari e Firefox são outros motores; o Arc e o Dia são Chromium, mas
   não respondem a `--remote-debugging-pipe` nem a `--remote-debugging-port`.
   Nesses casos a ferramenta avisa e usa outro navegador compatível que já
   esteja instalado, ou pede para instalar um.
2. Abre esse navegador com um perfil próprio (`browser-profile/`, não o seu
   perfil do dia a dia) na página de compras.
3. Você faz o login: senha, 2FA, captcha, o que o site pedir. A ferramenta
   nunca vê credencial.
4. Quando a lista de compras renderiza (até 5 minutos), a sessão do navegador
   vira a sua sessão: os cookies de `*.mercadolivre.com.br` e o User-Agent.
5. Grava tudo cifrado e confirma com uma requisição real.

`MERCADOLIVRE_LOGIN_BROWSER` força um navegador específico
(`/Applications/Google Chrome.app`, `/usr/bin/chromium` ou `com.google.Chrome`).
`--fresh` apaga o perfil antes e começa do zero.

## Importando de um navegador já logado (macOS)

```sh
mercadolivre login --from-browser chrome    # dia | arc | chrome | chromium | brave | edge
```

O Chromium no macOS cifra os cookies com uma chave guardada no Keychain
("Chrome Safe Storage"). O comando pede essa chave ao sistema (o macOS mostra o
diálogo de permissão uma vez), decifra os cookies do Mercado Livre e salva o
jar. Nenhuma janela é aberta e nenhuma senha é lida. É o caminho que serve
para o Arc, que a janela de login não consegue automatizar.

Ressalva: a sessão passa a ser compartilhada com aquele navegador. Se o site
rotacionar um cookie de um lado, o outro pode cair; reimportar resolve.
`MERCADOLIVRE_IMPORT_BROWSER=chrome` torna isso o padrão do `login`, inclusive
pela tool MCP.

## Sem navegador

```sh
export MERCADOLIVRE_COOKIE="_d2id=…; ssid=…; orgnickp=…"
mercadolivre status --verify
```

Como copiar: DevTools, aba Network, qualquer requisição para
`myaccount.mercadolivre.com.br`, Request Headers, `Cookie`, Copy value. Copie
o header inteiro: o cookie de sessão só aparece aí. Com a variável definida,
os cookies renovados pelo site ficam só em memória, e ela nunca é gravada.

## O que é gravado, e onde

| Arquivo | Conteúdo |
| --- | --- |
| `~/.config/mercadolivre-mcp/session.enc` | Cookies, User-Agent e data do login, cifrados com AES-256-GCM, modo 0600 |
| `~/.config/mercadolivre-mcp/session.key` | A chave, se você não definiu `MERCADOLIVRE_SESSION_KEY` (0600) |
| `~/.config/mercadolivre-mcp/browser-profile/` | Perfil do navegador usado na janela de login (0700) |

Formato do arquivo: `[0] versão | IV 12B | tag GCM 16B | ciphertext`. A
escrita é atômica (`.tmp` + rename), porque o servidor MCP pode estar gravando
a renovação de um cookie no exato momento em que você refaz o login.

Um `session.json` de versões anteriores é lido uma vez, regravado cifrado e
apagado.

## Ciclo de vida

| Evento | O que acontece |
| --- | --- |
| Cookies renovados | Cada `Set-Cookie` recebido é absorvido e regravado |
| Você refaz o login | O servidor MCP em execução percebe o arquivo novo pela data de modificação e recarrega a sessão sozinho, sem reiniciar |
| Sessão cai | O site responde com a página de login ou redireciona para ela. Erro acionável: refaça o login |
| Troca de senha, logout, inatividade longa | Matam a sessão do lado do site |

Não há renovação programática: a sessão dura enquanto o Mercado Livre a
mantiver viva, o que na prática são semanas.

## Revogando

```sh
rm ~/.config/mercadolivre-mcp/session.enc
```

E, para invalidar de verdade do lado do Mercado Livre, saia da conta no
navegador. Apagar o arquivo local só remove a cópia.
