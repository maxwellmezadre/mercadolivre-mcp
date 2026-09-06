#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Installs the tool on this machine so it works from any directory and does
// not depend on this checkout:
//
// 1. installs the published package globally with Bun (`bun install -g`), which
//    puts `mercadolivre` and `mercadolivre-mcp` in the Bun bin directory and
//    brings `playwright-core` along, so `login` works from the global install
//    (the compiled binary cannot do that);
// 2. registers the MCP server in the USER scope of Claude Code, writing the
//    absolute path of the installed bin (clients such as Claude Desktop do not
//    inherit the shell PATH). Written straight into ~/.claude.json so the run is
//    idempotent, and per-project entries of the same server are removed since
//    they would shadow the user-scope one;
// 3. installs the Skill in ~/.claude/skills/mercadolivre-mcp/, which is what
//    teaches the agent when and how to use the tools;
// 4. checks that the installed bin answers outside the repository.
//
// Usage: bun run setup [--link]
//   --link  build this checkout and `bun link` it instead of installing the
//           npm package (development; the global bin then follows the clone).

export const PACKAGE = "@maxwellmezadre/mercadolivre-mcp";
export const SERVER_NAME = "mercadolivre";
export const SKILL_NAME = "mercadolivre-mcp";
export const BIN_NAME = "mercadolivre";

export type Runner = (cmd: string[], cwd?: string) => Promise<string>;

export type SetupOptions = {
  home: string;
  repo: string;
  run: Runner;
  link?: boolean;
  /** PATH to check for the bin directory; defaults to the process PATH. */
  path?: string;
  log?: (line: string) => void;
};

export type SetupReport = { bin: string; version: string; steps: string[]; warnings: string[] };

type McpServer = { type: "stdio"; command: string; args: string[]; env: Record<string, string> };
type ClaudeJson = {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
  [key: string]: unknown;
};

export async function setup(options: SetupOptions): Promise<SetupReport> {
  const { home, repo, run } = options;
  const log = options.log ?? (() => {});
  const steps: string[] = [];
  const warnings: string[] = [];
  const done = (text: string) => {
    steps.push(text);
    log(`OK   ${text}`);
  };
  const warn = (text: string) => {
    warnings.push(text);
    log(`WARN ${text}`);
  };

  // 1. the package
  if (options.link) {
    await run(["bun", "run", "build:dist"], repo);
    await run(["bun", "link"], repo);
    done("checkout built and linked globally (--link)");
  } else {
    // A previous --link leaves a symlink to a checkout in the global
    // node_modules and `bun install -g` treats it as satisfied: remove first.
    await run(["bun", "remove", "-g", PACKAGE]).catch(() => "");
    await run(["bun", "install", "-g", `${PACKAGE}@latest`]);
    done(`${PACKAGE}@latest installed globally`);
  }
  const binDir = (await run(["bun", "pm", "bin", "-g"])).trim();
  const bin = join(binDir, BIN_NAME);
  if (!(options.path ?? process.env.PATH ?? "").split(":").includes(binDir)) {
    warn(`${binDir} is not in PATH; add it to your shell: export PATH="${binDir}:$PATH"`);
  }

  // 2. MCP server in the user scope of Claude Code
  const claudeJson = join(home, ".claude.json");
  if (existsSync(claudeJson)) {
    const conf = JSON.parse(readFileSync(claudeJson, "utf8")) as ClaudeJson;
    const server: McpServer = { type: "stdio", command: bin, args: ["mcp"], env: {} };
    conf.mcpServers = { ...(conf.mcpServers ?? {}), [SERVER_NAME]: server };
    let removed = 0;
    for (const project of Object.values(conf.projects ?? {})) {
      if (project.mcpServers && SERVER_NAME in project.mcpServers) {
        delete project.mcpServers[SERVER_NAME];
        removed += 1;
      }
    }
    writeFileSync(claudeJson, `${JSON.stringify(conf, null, 2)}\n`);
    done(`MCP server registered in the user scope${removed > 0 ? ` (${removed} per-project entries removed)` : ""}`);
  } else {
    warn(`${claudeJson} does not exist; register by hand: claude mcp add -s user ${SERVER_NAME} -- ${bin} mcp`);
  }

  // 3. the Skill
  const skillDir = join(home, ".claude", "skills", SKILL_NAME);
  mkdirSync(skillDir, { recursive: true });
  copyFileSync(join(repo, "SKILL.md"), join(skillDir, "SKILL.md"));
  copyFileSync(join(repo, "docs", "TOOLS.md"), join(skillDir, "TOOLS.md"));
  done(`skill installed in ${skillDir}`);

  // 4. the installed bin answers outside the repository
  const version = (await run([bin, "--version"], home)).trim();
  done(`${bin} answers outside the repo: ${version}`);

  return { bin, version, steps, warnings };
}

async function spawn(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed (${code}):\n${err || out}`);
  return out;
}

if (import.meta.main) {
  const report = await setup({
    home: homedir(),
    repo: join(import.meta.dir, ".."),
    run: spawn,
    link: process.argv.includes("--link"),
    log: (line) => console.log(line),
  });
  console.log(`\n${report.steps.length} steps done. Restart Claude Code to reload the MCP server.`);
  console.log(`Next: \`${BIN_NAME} login\`, then \`${BIN_NAME} sync --full\`.`);
}
