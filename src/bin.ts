#!/usr/bin/env bun
// Static JSON import: the bundler inlines the version, so this also works in
// the compiled binary (`bun build --compile`), where no package.json sits next
// to the executable.
import pkg from "../package.json" with { type: "json" };

// Lazy import per mode keeps the cold start low (NFR-1): the MCP server never
// loads commander and vice versa. Everything goes to the CLI for now; the `mcp`
// fast path lands together with the server.
const { runCli } = await import("./cli/index.js");
await runCli(process.argv, pkg.version);
