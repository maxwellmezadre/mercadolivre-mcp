# Segurança

## O modelo de ameaça

O jar de cookies é a conta inteira. Quem tiver `session.enc` e a chave ao lado
dele lê tudo que você lê no site: endereço, últimos dígitos do cartão e o
histórico de consumo. O mesmo vale para `MERCADOLIVRE_COOKIE` e para
`browser-profile/`, o perfil do navegador que guarda a sessão logada em claro.
Todo o resto deste documento decorre disso.

| Proteção | Como |
| --- | --- |
| Sessão cifrada em repouso | AES-256-GCM, arquivo 0600, escrita atômica |
| Chave separada | `MERCADOLIVRE_SESSION_KEY` ou `session.key` (0600), gerada no primeiro login |
| Sessão em log | Todo valor de cookie é redigido em toda linha de log |
| Sessão em resposta de tool | `auth_status` devolve contagens e validade, nunca um valor de cookie |
| Cache 0600 | O `cache.db` guarda o histórico; nasce com `umask 0o077` |
| Escrita em disco | Só `export`, `download_invoice` e `export_invoices`, e só dentro de `MERCADOLIVRE_EXPORT_DIR`. O nome é reduzido ao basename e o caminho resolvido é conferido contra o diretório |
| Escrita na conta | Não existe. Nenhuma tool submete formulário |
| Superfície de leitura | `raw_get` só faz GET em `myaccount.mercadolivre.com.br` e `www.mercadolivre.com.br` e nunca ecoa headers |
| Envio de cookies | Só para hosts sob `mercadolivre.com.br` |
| Fixtures públicos | Anonimização determinística, com falha se sobrar dado original |

## Nunca faça

- Não cole `session.enc`, `session.key`, `cache.db`, o header `Cookie` nem ids
  reais de compra numa issue. Eles são a sua conta.
- Não commite nada de `task/`. É onde ficam as capturas cruas.
- Não zere `MERCADOLIVRE_MIN_INTERVAL_MS`. O ritmo é o que evita o bloqueio.

## Revogando uma sessão

```sh
rm ~/.config/mercadolivre-mcp/session.enc
```

Para invalidar também do lado do Mercado Livre, saia da conta no navegador
(isso derruba uma sessão importada também).

## Reportando

Não abra uma issue pública para uma vulnerabilidade. Reporte por
[GitHub Security Advisories](https://github.com/maxwellmezadre/mercadolivre-mcp/security/advisories/new).
