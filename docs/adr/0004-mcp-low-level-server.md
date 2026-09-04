# ADR-0004 — Server low-level do MCP SDK

- **Status:** Aceito
- **Contexto:** o `McpServer.registerTool` do SDK exige schemas Zod/Standard Schema;
  aqui o schema é TypeBox (ADR-0003).

## Decisão

Usar o `Server` low-level de `@modelcontextprotocol/sdk` com `setRequestHandler` para
`tools/list` e `tools/call`, anunciando o objeto TypeBox como `inputSchema` e as
anotações `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`. Toda falha
vira `isError: true`; `stdout` carrega só JSON-RPC (logs em stderr).

## Consequências

- Um único arquivo (`src/mcp/server.ts`) conhece o SDK.
- Resources MCP ficaram fora da v0.1 (as tools cobrem os casos).
