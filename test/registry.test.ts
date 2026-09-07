import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import type { Ctx } from "../src/context.js";
import { defineTool, runTool, ToolInputError } from "../src/tools/define.js";
import { activeTools, allTools, toolByName } from "../src/tools/registry.js";

const echo = defineTool({
  name: "echo",
  description: "test tool",
  readOnly: true,
  input: Type.Object({ value: Type.String() }),
  run: async (args) => ({ echoed: args.value }),
});

describe("runTool", () => {
  test("rejects missing and wrong-typed args with a structured error", async () => {
    const ctx = {} as Ctx;

    await expect(runTool(echo, {}, ctx)).rejects.toBeInstanceOf(ToolInputError);
    await expect(runTool(echo, { value: 1 }, ctx)).rejects.toBeInstanceOf(ToolInputError);
  });

  test("lists every problem with its path", async () => {
    let problems: string[] = [];
    try {
      await runTool(echo, { value: 1 }, {} as Ctx);
    } catch (error) {
      problems = (error as ToolInputError).problems;
    }
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("/value");
  });

  test("valid args reach the tool", async () => {
    expect(await runTool(echo, { value: "x" }, {} as Ctx)).toEqual({ echoed: "x" });
  });
});

describe("registry", () => {
  test("has unique names and json-schema object inputs", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) {
      const schema = JSON.parse(JSON.stringify(tool.input)) as { type?: string };
      expect(schema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  test("read-only mode drops exactly the tools that persist something", () => {
    const names = activeTools({ readOnly: true }).map((tool) => tool.name);
    expect(names).not.toContain("login");
    expect(names).not.toContain("sync");
    expect(names).not.toContain("export");
    expect(names).not.toContain("download_invoice");
    expect(names).not.toContain("export_invoices");
    expect(names).toContain("auth_status");
    expect(names).toContain("list_purchases");
    expect(activeTools({ readOnly: false })).toBe(allTools);
  });

  test("toolByName finds registered tools only", () => {
    expect(toolByName("auth_status")?.name).toBe("auth_status");
    expect(toolByName("raw_get")?.readOnly).toBe(true);
    expect(toolByName("nope")).toBeUndefined();
  });
});
