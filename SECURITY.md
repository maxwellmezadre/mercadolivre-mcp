# Política de Segurança

## Modelo de ameaça

- A sessão (`session.json` ou `MERCADOLIVRE_COOKIE`) **é a conta**: quem a tem lê tudo
  que você lê no site. Ela nunca aparece em logs, erros ou saídas de tool, fica em
  arquivo `0600` e só é enviada a `*.mercadolivre.com.br`.
- O cache (`cache.sqlite`) contém endereço, últimos dígitos do cartão e histórico de
  consumo: `0600`, no diretório do usuário, nunca versionado.
- As tools só **leem** a conta. As únicas escritas em disco são o cache e as NF-e,
  estas restritas a `MERCADOLIVRE_DOWNLOAD_DIR` com nomes de arquivo sem caminho.
- `raw_get` só faz GET em dois hosts do Mercado Livre e nunca ecoa headers.

## Versões suportadas

Só a última versão publicada recebe correções.

## Reportar uma vulnerabilidade

Use [GitHub Security Advisories](https://github.com/maxwellmezadre/mercadolivre-mcp/security/advisories/new)
ou escreva para maxwellmezadre@gmail.com. Não abra issue pública para vazamento de
sessão, escrita fora do diretório de downloads, SSRF ou exaustão de recursos.
