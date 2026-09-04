# ADR-0005 — Sessão por cookie do navegador, sem OAuth

- **Status:** Aceito
- **Contexto:** a área "Minhas compras" não é uma API pública. A API oficial (OAuth)
  é desenhada para vendedores e o endpoint público de itens responde 403. Não existe
  token nem refresh token nessa superfície.

## Decisão

Autenticar com os cookies da própria sessão do usuário: `login` abre o navegador padrão
do sistema (Chromium-based — Chrome, Arc, Brave, Edge, Vivaldi; Safari e Firefox
recebem aviso e instrução de instalação) headed, com perfil persistente próprio (o usuário digita senha/2FA; a ferramenta só persiste o
`storageState` filtrado para `*.mercadolivre.com.br`, com permissão 0600 e o
User-Agent do navegador) ou `MERCADOLIVRE_COOKIE` com o header copiado do DevTools.
Cada `Set-Cookie` recebido é absorvido e persistido; a expiração é detectada pelo
redirect para `/jms/.../lgz/login` ou pela página de login com HTTP 200.

## Consequências

- Não há renovação programática: a sessão morre em troca de senha, logout, inatividade
  longa ou antifraude; a mensagem de erro diz como refazer o login.
- `playwright-core` é dependência opcional, importada só pelo `login`.
- Cookies são segredos: nunca em logs, erros ou saídas de tool.
