# ADR-0006: Sessão cifrada em repouso

## Contexto

O jar de cookies é a conta: quem o tiver entra sem senha e sem segundo fator.
Ele fica no disco de uma máquina de trabalho, ao lado de backups,
sincronizações e ferramentas de busca. Até a versão 0.1 ele era um
`session.json` em claro, protegido só pelo modo 0600.

## Decisão

AES-256-GCM, arquivo `0600`, layout `[0] versão | IV 12B | tag 16B |
ciphertext`. A chave vem de `MERCADOLIVRE_SESSION_KEY` ou de um `session.key`
gerado no primeiro login, para que ninguém precise pensar nisso. Escrita
atômica (`.tmp` + rename): o servidor MCP pode estar gravando a renovação de um
cookie no mesmo instante em que o CLI faz um login novo.

Um `session.json` existente é lido uma vez, regravado cifrado e apagado, com
uma linha no log. `MERCADOLIVRE_COOKIE` continua nunca sendo gravado.

## Consequências

Um `cat` no arquivo não entrega nada. A chave ao lado não protege contra quem
já tem a sua conta de usuário; protege contra o resto: backup, sincronização,
um `grep -r` distraído. Perder a chave custa um login novo, nada mais.
