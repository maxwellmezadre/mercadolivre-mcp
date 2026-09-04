# ADR-0008 — Fixtures reais anonimizados em repositório público

- **Status:** Aceito
- **Contexto:** os parsers só são confiáveis testados contra payloads reais, mas o
  repositório é público e as capturas contêm endereço, cartão, nomes de produto e ids
  da conta.

## Decisão

Capturas cruas ficam em `task/captures/` (gitignored) e alimentam `test/local`.
`scripts/anonymize-fixture.ts` gera os fixtures públicos com mapeamento determinístico
(ids por hash mantendo tamanho e prefixo; palavras de título por pseudo-palavras;
endereço, cartão, nonce e parâmetros de rastreio reescritos; contexto podado) e falha
se sobrar qualquer dado original. Valores, quantidades e datas ficam intactos para que
as identidades financeiras continuem verificáveis.

## Consequências

- Testes de regressão sobre a forma real do site sem expor o usuário.
- Ao mudar o anonimizador, regenerar os fixtures a partir das capturas.
