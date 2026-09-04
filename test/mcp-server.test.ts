import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// End-to-end over stdio: the real binary entry, a real JSON-RPC handshake,
// and the guarantee that stdout carries nothing but JSON-RPC (NFR-3).

const home = mkdtempSync(join(tmpdir(), "ml-mcp-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

type Rpc = { id?: number; result?: Record<string, unknown>; error?: unknown };

async function talk(messages: object[]): Promise<{ replies: Rpc[]; stdout: string }> {
  const proc = Bun.spawn(["bun", "run", "src/bin.ts", "mcp"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, MERCADOLIVRE_HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(messages.map((message) => `${JSON.stringify(message)}\n`).join(""));
  await proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  proc.kill();
  const replies = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Rpc);
  return { replies, stdout };
}

test("mcp handshake lists the tools and calls auth_status without a session", async () => {
  const { replies } = await talk([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "auth_status", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
  ]);

  const list = replies.find((reply) => reply.id === 2)?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
  expect(list.tools.map((tool) => tool.name)).toEqual(allTools.map((tool) => tool.name));
  expect(list.tools[0]?.annotations.readOnlyHint).toBe(true);

  const status = replies.find((reply) => reply.id === 3)?.result as { isError?: boolean; content: Array<{ text: string }> };
  expect(status.isError).toBeUndefined();
  expect(JSON.parse(status.content[0]!.text).authenticated).toBe(false);

  const unknown = replies.find((reply) => reply.id === 4)?.result as { isError: boolean };
  expect(unknown.isError).toBe(true);
}, 20_000);
