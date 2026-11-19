import { afterEach, describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// The skill OpenCode ships and the plugin rewrites, so an upstream sync that moves its text fails here.
const SKILL = path.join(import.meta.dir, "../../../../core/src/plugin/skill/opencode.md")

type Skill = { description: string; content: string }

type Tool = { name: string; execute: (input: Record<string, never>) => Promise<{ content: string }> }

type Source = { file: string; text: string | null }

type Failure = { type: string; message: string; data: Source | Record<string, never> }

type Handlers = {
  read: (input: Record<string, never>) => Promise<Source>
  write: (
    input: { file: string; base: string | null; text: string },
    context: { error: (type: string, message: string, data: Failure["data"]) => Failure },
  ) => Promise<{ file: string } | Failure>
}

type Server = { name: string; status: { status: string; error?: string } }

const roots: string[] = []

afterEach(() => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

// Installs the plugin where the desktop does, `<server>/config/opencode/plugins`, and sets it up against a host that
// records what it registers.
async function install(input: { skill?: Skill; servers?: Server[] } = {}) {
  // Resolved, as the plugin finds its folder through its own resolved module URL (macOS links /var to /private/var).
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "shiyou-mcp-config-")))
  roots.push(root)
  const config = path.join(root, "server", "config", "opencode")
  const target = path.join(config, "plugins", "shiyou-mcp-config.js")
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(import.meta.dir, "shiyou-mcp-config.plugin.js"), target)

  const skill = input.skill
  const tools: Tool[] = []
  const registered: Handlers[] = []
  const plugin = (await import(target)).default

  await plugin.setup({
    skill: {
      transform: async (callback: (editor: { update: (id: string, update: (skill: Skill) => void) => void }) => void) =>
        callback({ update: (id, update) => (id === "opencode" && skill ? update(skill) : undefined) }),
    },
    tool: {
      transform: async (callback: (editor: { namespace: () => void; add: (tool: Tool) => void }) => void) =>
        callback({ namespace: () => undefined, add: (tool) => tools.push(tool) }),
    },
    mcp: { list: async () => ({ location: { directory: root }, data: input.servers ?? [] }) },
    rpc: { register: async (_definition: { id: string }, handlers: Handlers) => void registered.push(handlers) },
  })

  const rpc = registered[0]

  if (!rpc) throw new Error("the plugin registered no RPC")

  return { root, config, tools, rpc }
}

const context = { error: (type: string, message: string, data: Failure["data"]) => ({ type, message, data }) }

describe("shiyou MCP config plugin", () => {
  test("points the OpenCode skill at shiyou's configuration and its MCP setup", async () => {
    const skill = {
      description: "Use this skill for any question about OpenCode itself, including MCP servers.",
      content: await readFile(SKILL, "utf8"),
    }

    const installed = await install({ skill })
    const file = path.join(installed.config, "opencode.jsonc")

    expect(skill.description).toContain("shiyou (识油)")
    expect(skill.content).toContain(`Global configuration: \`${file}\``)
    expect(skill.content).toContain(path.join(installed.root, "server", "data", "opencode", "log", "opencode.log"))
    // shiyou's section opens the guide, ahead of OpenCode's first section.
    expect(skill.content.indexOf("## shiyou (识油)")).toBeLessThan(skill.content.indexOf("## Version policy"))
    expect(skill.content).toContain(`Global configuration lives at \`${file}\``)
    expect(skill.content).not.toContain("~/.local/share/opencode/log")
    // One MCP section, shiyou's, which edits the file instead of running the OpenCode CLI.
    expect(skill.content.match(/^## .*MCP servers/gm)).toEqual(["## MCP servers"])
    expect(skill.content).not.toContain("opencode mcp add <name>")
    expect(skill.content).toContain("`shiyou_mcp_status`")
  })

  test("still names shiyou's paths and MCP setup when OpenCode's guide moves the text it rewrites", async () => {
    const skill = { description: "Answers questions.", content: "# OpenCode\n\nAn index of core concepts.\n" }
    const installed = await install({ skill })

    expect(skill.description).toStartWith("Use this skill for any question about shiyou (识油)")
    expect(skill.content).toStartWith("# OpenCode\n\nAn index of core concepts.\n\n## shiyou (识油)")
    expect(skill.content).toContain(path.join(installed.config, "opencode.jsonc"))
    expect(skill.content).toContain("## MCP servers")
  })

  test("reads and writes the global configuration the server reads", async () => {
    const installed = await install()
    const file = path.join(installed.config, "opencode.jsonc")
    const text = '{\n  // MCP\n  "mcp": { "servers": {} },\n}\n'

    expect(await installed.rpc.read({})).toEqual({ file, text: null })
    expect(await installed.rpc.write({ file, base: null, text }, context)).toEqual({ file })
    expect(await installed.rpc.read({})).toEqual({ file, text })
    // Nothing is left beside the file.
    expect((await readdir(installed.config)).toSorted()).toEqual(["opencode.jsonc", "plugins"])
  })

  test("refuses a write over a file that changed since the client read it", async () => {
    const installed = await install()
    const file = path.join(installed.config, "opencode.jsonc")
    await writeFile(file, '{ "shell": "zsh" }\n')

    const cases = [
      { base: null, file },
      { base: "{}\n", file },
      { base: '{ "shell": "zsh" }\n', file: path.join(installed.config, "opencode.json") },
    ]

    for (const input of cases)
      expect(await installed.rpc.write({ ...input, text: "{}\n" }, context)).toMatchObject({
        type: "conflict",
        data: { file, text: '{ "shell": "zsh" }\n' },
      })
    expect(await readFile(file, "utf8")).toBe('{ "shell": "zsh" }\n')
  })

  test("refuses text that is not a configuration object", async () => {
    const installed = await install()
    const file = path.join(installed.config, "opencode.jsonc")

    for (const text of ["", " \n", "[]", '{ "mcp": ', "null"])
      expect(await installed.rpc.write({ file, base: null, text }, context)).toMatchObject({ type: "invalid" })
    expect(await installed.rpc.read({})).toEqual({ file, text: null })
  })

  test("edits opencode.json when it is the only configuration file", async () => {
    const installed = await install()
    const file = path.join(installed.config, "opencode.json")
    await writeFile(file, "{}\n")

    expect(await installed.rpc.read({})).toEqual({ file, text: "{}\n" })
  })

  test("tells the agent each server's status and whether the global configuration defines it", async () => {
    const installed = await install({
      servers: [
        { name: "docs", status: { status: "connected" } },
        { name: "project-db", status: { status: "failed", error: "spawn ENOENT" } },
      ],
    })

    const file = path.join(installed.config, "opencode.jsonc")
    await writeFile(
      file,
      '{\n  // servers\n  "mcp": { "servers": { "docs": { "type": "remote", "url": "https://x" }, "fresh": { "type": "remote", "url": "https://y" }, }, },\n}\n',
    )
    const tool = installed.tools.find((item) => item.name === "mcp_status")

    expect(JSON.parse((await tool!.execute({})).content)).toEqual({
      configFile: file,
      servers: [
        { name: "docs", status: "connected", inGlobalConfig: true },
        { name: "project-db", status: "failed", error: "spawn ENOENT", inGlobalConfig: false },
        { name: "fresh", status: "not loaded yet", inGlobalConfig: true },
      ],
    })
  })
})
