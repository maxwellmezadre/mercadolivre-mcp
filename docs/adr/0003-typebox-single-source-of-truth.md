# ADR-0003 — TypeBox como fonte única de verdade

- **Status:** Aceito
- **Contexto:** a especificação sugeria Zod. O padrão de referência (trello-cli) usa
  TypeBox desde o primeiro commit, sem nada a migrar.

## Decisão

Um `Type.Object(...)` por tool produz os tipos estáticos (`Static<S>`), a validação em
runtime (`Value.Check`) e o JSON Schema anunciado ao cliente MCP como `inputSchema`. A
configuração também é um schema TypeBox.

## Consequências

- Zero duplicação de schema; `docs/TOOLS.md` é gerado do registry.
- O servidor MCP usa o `Server` low-level (ADR-0004), porque o `registerTool` de alto
  nível espera schemas Zod/Standard.
