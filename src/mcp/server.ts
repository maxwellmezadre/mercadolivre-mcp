import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../context.js";
import { runTool } from "../tools/define.js";
import { allTools } from "../tools/registry.js";

// MCP transport adapter (AR-2): every use of the SDK is confined here. The
// LOW-LEVEL Server is deliberate — `registerTool` expects Zod/Standard
// schemas, while we advertise the TypeBox JSON Schema directly as
// `inputSchema` (AR-3, ADR-0004).

export async function startMcpServer(ctx: Ctx, version: string): Promise<void> {
  const tools = allTools;
  const server = new Server(
    { name: "mercadolivre-mcp", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // The TypeBox object IS a valid JSON Schema object.
      inputSchema: tool.input as { type: "object" },
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: false,
        idempotentHint: tool.readOnly,
        openWorldHint: true,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name);
    if (!tool) return toolError(`Unknown tool: ${request.params.name}`);

    // Validation and execution failures become tool errors, never a crash (NFR-6).
    try {
      const result = await runTool(tool, request.params.arguments ?? {}, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });

  await server.connect(new StdioServerTransport());
  // stderr only: stdout stays 100% JSON-RPC (NFR-3).
  ctx.log.info(`mercadolivre-mcp ready (${tools.length} tools)`);
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
