import { Command } from "commander";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { compactObject, runTool } from "../tools/define.js";
import { toolByName } from "../tools/registry.js";

// Commander program (F-17). Every command maps onto a registry tool and calls
// `runTool`, so CLI and MCP share validation and behaviour (AR-1). stdout
// carries only the result; errors and prompts go to stderr.

function formatValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function formatHuman(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  if (Array.isArray(result)) return result.map(formatValue).join("\n");
  return Object.entries(result)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n");
}

async function invoke(
  toolName: string,
  args: Record<string, unknown>,
  json: boolean,
): Promise<void> {
  try {
    const tool = toolByName(toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}`);
    const ctx = createContext(loadConfig());
    const result = await runTool(tool, compactObject(args), ctx);
    console.log(json ? JSON.stringify(result, null, 2) : formatHuman(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function toNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("mercadolivre")
    .description("Mercado Livre purchase history — CLI and MCP server")
    .version(version);

  // Every command accepts --json for structured output.
  const command = (signature: string) =>
    program.command(signature).option("--json", "structured JSON output");

  command("status")
    .description("Show whether a Mercado Livre session is configured")
    .option("--verify", "also request the purchases page to confirm the session")
    .action((options) =>
      invoke("auth_status", { verify: options.verify ?? false }, options.json ?? false),
    );

  command("raw <url>")
    .description("Authenticated GET on an allowed Mercado Livre host (rediscovery)")
    .option("--as <mode>", "html | json | nordic", "html")
    .option("--max-bytes <n>", "cap the returned body")
    .action((url: string, options) =>
      invoke(
        "raw_get",
        { url, as: options.as, maxBytes: toNumber(options.maxBytes) },
        options.json ?? false,
      ),
    );

  program
    .command("mcp")
    .description("Start the MCP server (stdio)")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(createContext(loadConfig()), version);
    });

  await program.parseAsync(argv);
}
