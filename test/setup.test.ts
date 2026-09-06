import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE, setup, SKILL_NAME } from "../scripts/setup.js";

// The setup script is glue around external commands (bun, the installed bin),
// so the commands are recorded by a fake runner and the files it writes are
// checked in a temporary home directory.

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(options: { claudeJson?: unknown } = {}) {
  const home = mkdtempSync(join(tmpdir(), "ml-setup-home-"));
  const repo = mkdtempSync(join(tmpdir(), "ml-setup-repo-"));
  temps.push(home, repo);
  writeFileSync(join(repo, "SKILL.md"), "---\nname: mercadolivre-mcp\n---\nskill body\n");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "TOOLS.md"), "# Tools\n");
  if (options.claudeJson !== undefined) {
    writeFileSync(join(home, ".claude.json"), JSON.stringify(options.claudeJson));
  }
  const binDir = join(home, ".bun", "bin");
  const calls: Array<{ cmd: string[]; cwd?: string }> = [];
  const run = async (cmd: string[], cwd?: string) => {
    calls.push({ cmd, cwd });
    if (cmd.join(" ") === "bun pm bin -g") return `${binDir}\n`;
    if (cmd[1] === "--version") return "0.1.0\n";
    return "";
  };
  return { home, repo, binDir, calls, run };
}

const claudeJson = {
  mcpServers: { trello: { type: "stdio", command: "trello", args: ["mcp"], env: {} } },
  projects: {
    "/Users/me/old-project": {
      mcpServers: { mercadolivre: { type: "stdio", command: "bun", args: ["run", "old/src/bin.ts", "mcp"] } },
    },
    "/Users/me/other": { allowedTools: [] },
  },
};

describe("setup", () => {
  test("installs the published package, registers the MCP server and the skill", async () => {
    const f = fixture({ claudeJson });

    const report = await setup({ home: f.home, repo: f.repo, run: f.run, path: `/usr/bin:${f.binDir}` });

    const bin = join(f.binDir, "mercadolivre");
    expect(f.calls.map((c) => c.cmd.join(" "))).toEqual([
      `bun remove -g ${PACKAGE}`,
      `bun install -g ${PACKAGE}@latest`,
      "bun pm bin -g",
      `${bin} --version`,
    ]);
    expect(f.calls[3]?.cwd).toBe(f.home);
    expect(report.bin).toBe(bin);
    expect(report.version).toBe("0.1.0");
    expect(report.warnings).toEqual([]);

    const conf = JSON.parse(readFileSync(join(f.home, ".claude.json"), "utf8"));
    expect(conf.mcpServers.mercadolivre).toEqual({ type: "stdio", command: bin, args: ["mcp"], env: {} });
    expect(conf.mcpServers.trello.command).toBe("trello");
    expect(conf.projects["/Users/me/old-project"].mcpServers).toEqual({});
    expect(conf.projects["/Users/me/other"]).toEqual({ allowedTools: [] });

    const skillDir = join(f.home, ".claude", "skills", SKILL_NAME);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toContain("skill body");
    expect(readFileSync(join(skillDir, "TOOLS.md"), "utf8")).toBe("# Tools\n");
  });

  test("keeps going when there was no global package to remove", async () => {
    const f = fixture({ claudeJson });
    const run = async (cmd: string[], cwd?: string) => {
      if (cmd[1] === "remove") throw new Error("error: package not found");
      return f.run(cmd, cwd);
    };

    const report = await setup({ home: f.home, repo: f.repo, run, path: f.binDir });

    expect(f.calls.map((c) => c.cmd.join(" "))).toContain(`bun install -g ${PACKAGE}@latest`);
    expect(report.version).toBe("0.1.0");
  });

  test("warns when the bin directory is not in PATH", async () => {
    const f = fixture({ claudeJson });

    const report = await setup({ home: f.home, repo: f.repo, run: f.run, path: "/usr/bin" });

    expect(report.warnings.join("\n")).toContain(`export PATH="${f.binDir}:$PATH"`);
  });

  test("--link builds and links the checkout instead of installing from npm", async () => {
    const f = fixture({ claudeJson });

    await setup({ home: f.home, repo: f.repo, run: f.run, link: true });

    expect(f.calls.slice(0, 2)).toEqual([
      { cmd: ["bun", "run", "build:dist"], cwd: f.repo },
      { cmd: ["bun", "link"], cwd: f.repo },
    ]);
    expect(f.calls.some((c) => c.cmd.includes("-g") && c.cmd.includes("install"))).toBe(false);
  });

  test("warns instead of creating ~/.claude.json when Claude Code was never run", async () => {
    const f = fixture();

    const report = await setup({ home: f.home, repo: f.repo, run: f.run });

    expect(existsSync(join(f.home, ".claude.json"))).toBe(false);
    expect(report.warnings.join("\n")).toContain("claude mcp add -s user mercadolivre");
    expect(existsSync(join(f.home, ".claude", "skills", SKILL_NAME, "SKILL.md"))).toBe(true);
  });

  test("is idempotent: running twice leaves one entry with the same shape", async () => {
    const f = fixture({ claudeJson });

    await setup({ home: f.home, repo: f.repo, run: f.run });
    const first = readFileSync(join(f.home, ".claude.json"), "utf8");
    await setup({ home: f.home, repo: f.repo, run: f.run });

    expect(readFileSync(join(f.home, ".claude.json"), "utf8")).toBe(first);
  });
});
