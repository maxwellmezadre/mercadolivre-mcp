import type { Static, TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Ctx } from "../context.js";

// AR-3: one TypeBox schema per tool is the single source of truth — it yields
// the static types (Static<S>), the runtime validation (Value.Check) and the
// JSON Schema advertised to the MCP client (the `input` object itself).
export type ToolDef<S extends TObject = TObject> = {
  name: string;
  description: string;
  /** False only for tools that write to the local disk or cache; the account is always read-only. */
  readOnly: boolean;
  input: S;
  run: (args: Static<S>, ctx: Ctx) => Promise<unknown> | unknown;
};

/**
 * Registers a tool. Erases the generic at the boundary so tools with
 * different schemas can live in one `ToolDef[]`; `run` stays typed inside.
 */
export function defineTool<S extends TObject>(tool: ToolDef<S>): ToolDef {
  return tool as unknown as ToolDef;
}

/** Structured argument validation error — becomes a tool error, not a crash. */
export class ToolInputError extends Error {
  constructor(
    public readonly tool: string,
    public readonly problems: string[],
  ) {
    super(
      `Invalid arguments for ${tool}:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "ToolInputError";
  }
}

/**
 * Validates `rawArgs` against the tool schema and runs it. Invalid input
 * throws {@link ToolInputError} instead of leaking a raw exception (NFR-6).
 */
export async function runTool(
  tool: ToolDef,
  rawArgs: unknown,
  ctx: Ctx,
): Promise<unknown> {
  if (!Value.Check(tool.input, rawArgs)) {
    const problems = [...Value.Errors(tool.input, rawArgs)].map(
      (error) => `${error.path || "/"}: ${error.message}`,
    );
    throw new ToolInputError(tool.name, problems);
  }
  return tool.run(rawArgs, ctx);
}

/** Drops `undefined` values so tool outputs and CLI args stay tidy. */
export function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
