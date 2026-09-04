import { Command } from "commander";

// Commander program. Each command maps to a tool from the registry and calls
// `runTool`, so CLI and MCP share validation and behaviour (AR-1). Commands
// land with their tools; the skeleton only knows its name and version.
export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("mercadolivre")
    .description("Mercado Livre purchase history — CLI and MCP server")
    .version(version);

  await program.parseAsync(argv);
}
