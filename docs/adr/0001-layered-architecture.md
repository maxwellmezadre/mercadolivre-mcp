# ADR-0001: Arquitetura em camadas, pragmática

## Contexto

Um CLI e um servidor MCP sobre o mesmo núcleo, com parsers de uma superfície
web instável e um cache local. Precisa ser fácil de trocar a fonte de dados e
de testar sem rede. Sem separação, uma mudança no site espalha edição por todo
lado; com separação demais, um projeto pessoal vira cerimônia.

## Decisão

Quatro camadas (transporte, tools, domínio, infraestrutura) com um objeto `Ctx`
injetado e nenhum singleton. `createContext(loadConfig())` é a fiação inteira.
Parsers são funções puras sobre o JSON dos bricks; o único funil de rede é
`src/core/http.ts`; o SDK do MCP fica confinado a `src/mcp/`.

## Consequências

Testes determinísticos com `fetch`, relógio e `sleep` falsos. Trocar a fonte
(por exemplo, a API oficial) muda `src/mercadolivre/api` e os parsers; tools e
cache ficam. Cada arquivo de lógica fica abaixo de cerca de 450 linhas.
