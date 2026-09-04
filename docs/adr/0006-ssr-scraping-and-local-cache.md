# ADR-0006 — SSR Nordic/Flox como fonte, cache SQLite como superfície de consulta

- **Status:** Aceito
- **Contexto:** o JSON da página (`__NORDIC_RENDERING_CTX__`) é a única fonte
  acessível; o middleend interno é inalcançável e o endpoint JSON da lista ignora
  `page`. A origem é lenta e sensível a rate limit.

## Decisão

Parsear o JSON embutido no HTML (scanner de chaves balanceadas, nunca regex até
`</script>`) e persistir tudo num SQLite local com dinheiro em centavos, `raw_detail`
por compra e FTS5. A rede entra por `sync` (full, incremental com regra de parada e
guard de sync interrompido, reparse sem rede quando `PARSER_VERSION` muda), por
`get_purchase` ou quando pedido explicitamente. Uma requisição por vez, 1 s + jitter,
backoff em 403/429.

## Consequências

- Perguntas analíticas são instantâneas e não custam requisições.
- A fragilidade da fonte é tratada com `doctor`, `raw_get`, fixtures e
  `docs/REDISCOVERY.md`.
- O cache contém dados pessoais: arquivo 0600, nunca versionado.
