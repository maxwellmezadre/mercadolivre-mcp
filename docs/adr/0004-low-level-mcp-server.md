# ADR-0004: Server low-level do MCP SDK

## Contexto

O `McpServer.registerTool` do SDK exige schemas Zod/Standard Schema; aqui o
schema é TypeBox (ADR-0003).

## Decisão

Usar o `Server` low-level de `@modelcontextprotocol/sdk` com
`setRequestHandler` para `tools/list` e `tools/call`, anunciando o objeto
TypeBox como `inputSchema` e as anotações `readOnlyHint`, `destructiveHint`,
`idempotentHint` e `openWorldHint`. Toda falha vira `isError: true`; `stdout`
carrega só JSON-RPC (logs em stderr).

## Consequências

Um único arquivo (`src/mcp/server.ts`) conhece o SDK. Resources MCP ficaram
fora (as tools cobrem os casos).
