# ADR-0001 — Arquitetura em camadas, pragmática

- **Status:** Aceito
- **Contexto:** um CLI e um servidor MCP sobre o mesmo núcleo, com parsers de uma
  superfície web instável e um cache local. Precisa ser fácil de trocar a fonte de dados
  e de testar sem rede.

## Decisão

Quatro camadas (transporte → tools → domínio → infraestrutura) com um objeto `Ctx`
injetado e nenhum singleton. Parsers são funções puras sobre o JSON dos bricks; o único
funil de rede é `src/core/http.ts`; o SDK do MCP fica confinado ao adapter.

## Consequências

- Testes determinísticos com `fetch`, relógio e `sleep` falsos.
- Trocar a fonte (por exemplo, a API oficial) muda `src/meli/api` e os parsers; tools e
  store ficam.
- Cada arquivo de lógica fica abaixo de ~400 linhas.
