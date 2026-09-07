# ADR-0005: Sessão por cookie do navegador, sem OAuth

## Contexto

A área "Minhas compras" não é uma API pública. A API oficial (OAuth) é
desenhada para vendedores e o endpoint público de itens responde 403. Não
existe token nem refresh token nessa superfície.

## Decisão

Autenticar com os cookies da própria sessão do usuário, obtidos de três
formas: a janela de login (o navegador padrão do sistema, headed, com perfil
persistente próprio; o usuário digita senha e 2FA e a ferramenta só persiste
os cookies de `*.mercadolivre.com.br` e o User-Agent), a importação do banco
de cookies de um navegador já logado pelo Keychain do macOS, ou
`MERCADOLIVRE_COOKIE` com o header copiado do DevTools. Cada `Set-Cookie`
recebido é absorvido e persistido; a expiração é detectada pelo redirect para
`/jms/.../lgz/login` ou pela página de login com HTTP 200.

Safari, Firefox e Arc não servem para a janela de login (outros motores, ou
Chromium sem DevTools); a ferramenta avisa e usa outro navegador compatível
instalado, e o Arc entra pela importação.

## Consequências

Não há renovação programática: a sessão morre em troca de senha, logout,
inatividade longa ou antifraude; a mensagem de erro diz como refazer o login.
Cookies são segredos: nunca em logs, erros ou saídas de tool, e cifrados em
repouso (ADR-0006).
