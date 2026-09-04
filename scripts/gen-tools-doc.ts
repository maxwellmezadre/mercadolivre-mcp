#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { allTools } from "../src/tools/registry.js";

// Generates docs/TOOLS.md from the registry, so the reference never drifts
// from the schemas the MCP client actually sees (AR-3).
//
// Usage: bun run scripts/gen-tools-doc.ts

type Property = { type?: string; description?: string; const?: unknown; anyOf?: Property[]; minimum?: number; maximum?: number };
type Schema = { properties?: Record<string, Property>; required?: string[] };

function typeOf(property: Property): string {
  if (property.anyOf) {
    return property.anyOf.map((option) => (option.const !== undefined ? `\`${String(option.const)}\`` : typeOf(option))).join(" \\| ");
  }
  if (property.const !== undefined) return `\`${String(property.const)}\``;
  return property.type ?? "any";
}

const lines: string[] = [
  "# Tools",
  "",
  "Referência das tools MCP, gerada por `bun run scripts/gen-tools-doc.ts` a partir do registry.",
  "Os comandos equivalentes da CLI estão em [CLI.md](CLI.md). Valores monetários saem em BRL (reais);",
  "as datas são `YYYY-MM-DD`.",
  "",
  `Total: ${allTools.length} tools. *Read-only* indica que a tool não escreve nada no disco local`,
  "(a conta do Mercado Livre é somente leitura em todas elas).",
  "",
];

for (const tool of allTools) {
  const schema = tool.input as unknown as Schema;
  const required = new Set(schema.required ?? []);
  lines.push(`## \`${tool.name}\``, "", tool.readOnly ? "*Read-only.*" : "*Escreve no disco (cache ou downloads).*", "", tool.description, "");
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) {
    lines.push("Sem parâmetros.", "");
    continue;
  }
  lines.push("| Parâmetro | Tipo | Obrigatório | Descrição |", "| --- | --- | --- | --- |");
  for (const [name, property] of properties) {
    const range =
      property.minimum !== undefined || property.maximum !== undefined
        ? ` (${[property.minimum !== undefined ? `min ${property.minimum}` : "", property.maximum !== undefined ? `max ${property.maximum}` : ""].filter(Boolean).join(", ")})`
        : "";
    lines.push(`| \`${name}\` | ${typeOf(property)}${range} | ${required.has(name) ? "sim" : "não"} | ${property.description ?? ""} |`);
  }
  lines.push("");
}

writeFileSync(new URL("../docs/TOOLS.md", import.meta.url), `${lines.join("\n").trimEnd()}\n`);
console.error(`docs/TOOLS.md: ${allTools.length} tools`);
