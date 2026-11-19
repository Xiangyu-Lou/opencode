// shiyou: a plugin for shiyou's bundled server that points the agent and the client at the configuration file the
// server really reads. shiyou's server keeps its global configuration under shiyou's own app data (see
// shiyou-server.ts), but OpenCode's built-in "opencode" skill tells the agent it lives in ~/.config/opencode and to add
// MCP servers with `opencode mcp add`, which from the agent's shell writes the user's own OpenCode configuration, a
// file shiyou never reads. This plugin:
//
// - rewrites that skill with shiyou's paths and an MCP section that edits the right file,
// - adds the `shiyou_mcp_status` tool, so the agent can check what it configured without the OpenCode CLI,
// - registers the `shiyou.mcp-config` RPC, which Settings › Extensions › MCPs uses to read and write the file.
//
// The desktop app copies this file into the server's plugins folder each time it starts the server, so edits made
// there are replaced. It imports only Node built-ins, so it loads in any server version. The client keeps a copy of
// the RPC contract in packages/app/src/brand/mcp/rpc.ts; keep the two in step.

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The RPC the client edits the global configuration through. Errors carry the file as it is now. */
const McpConfigRpc = {
  id: "shiyou.mcp-config",
  methods: {
    read: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { file: { type: "string" }, text: { anyOf: [{ type: "string" }, { type: "null" }] } },
        required: ["file", "text"],
        additionalProperties: false,
      },
    },
    write: {
      input: {
        type: "object",
        properties: {
          file: { type: "string" },
          base: { anyOf: [{ type: "string" }, { type: "null" }] },
          text: { type: "string", maxLength: 1_000_000 },
        },
        required: ["file", "base", "text"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { file: { type: "string" } },
        required: ["file"],
        additionalProperties: false,
      },
      errors: {
        conflict: {
          type: "object",
          properties: { file: { type: "string" }, text: { anyOf: [{ type: "string" }, { type: "null" }] } },
          required: ["file", "text"],
          additionalProperties: false,
        },
        invalid: { type: "object", additionalProperties: false },
      },
    },
  },
  events: {},
}

// The global configuration folder. The server loads global plugins from its `plugins` folder, where the desktop
// installs this file.
const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export default {
  id: "shiyou.mcp-config",
  /** @param {any} ctx */
  setup: async (ctx) => {
    const paths = { directory, file: await configFile(directory), log: logFile(directory) }

    await ctx.skill.transform((/** @type {any} */ editor) => {
      editor.update("opencode", (/** @type {{ description: string, content: string }} */ skill) => {
        skill.description = describe(skill.description)
        skill.content = guide(skill.content, paths)
      })
    })

    await ctx.tool.transform((/** @type {any} */ editor) => {
      editor.namespace({
        name: "shiyou",
        description: "Tools for shiyou (识油), the desktop app this agent runs in.",
      })
      editor.add({
        name: "mcp_status",
        description:
          "List the MCP servers shiyou's server knows, with each one's connection status and error, and which of them shiyou's global configuration file defines. Use it to check MCP servers after editing the configuration; never run `opencode mcp list`.",
        input: { type: "object", additionalProperties: false },
        options: { namespace: "shiyou", codemode: true },
        execute: async () => {
          const file = await configFile(directory)
          const configured = Object.keys(servers(await readText(file)))

          const listed = (await ctx.mcp.list()).data.map((/** @type {any} */ server) => ({
            name: server.name,
            status: server.status.status,
            // JSON leaves out an absent error.
            error: server.status.error,
            inGlobalConfig: configured.includes(server.name),
          }))

          const missing = configured
            .filter((name) => !listed.some((server) => server.name === name))
            .map((name) => ({ name, status: "not loaded yet", inGlobalConfig: true }))

          return { content: JSON.stringify({ configFile: file, servers: [...listed, ...missing] }, null, 2) }
        },
      })
    })

    await ctx.rpc.register(McpConfigRpc, {
      read: async () => {
        const file = await configFile(directory)

        return { file, text: await readText(file) }
      },
      write: async (/** @type {{ file: string, base: string | null, text: string }} */ input, context) => {
        const file = await configFile(directory)
        const text = await readText(file)

        // Someone else (the agent, an editor, another window) changed the file since the client read it.
        if (file !== input.file || text !== input.base)
          return context.error("conflict", "The configuration file changed since it was read", { file, text })

        if (!isDocument(input.text))
          return context.error("invalid", "The configuration is not a JSON or JSONC object", {})
        await mkdir(path.dirname(file), { recursive: true })
        // Write beside the file, then rename over it, so the server's watcher never reads half a file.
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
        await writeFile(temporary, input.text)
        await rename(temporary, file)

        return { file }
      },
    })
  },
}

/**
 * The global configuration file the server reads last, which OpenCode's own config writer edits too:
 * `opencode.jsonc`, or `opencode.json` when only that one exists.
 *
 * @param {string} directory
 */
async function configFile(directory) {
  const jsonc = path.join(directory, "opencode.jsonc")
  const json = path.join(directory, "opencode.json")

  if (await isFile(jsonc)) return jsonc

  if (await isFile(json)) return json

  return jsonc
}

/**
 * The server's log, under the data root shiyou starts it with beside the config root (`<server>/{config,data}`).
 *
 * @param {string} directory
 */
function logFile(directory) {
  return path.join(path.dirname(path.dirname(directory)), "data", "opencode", "log", "opencode.log")
}

/** @param {string} description */
function describe(description) {
  if (description.includes("OpenCode itself"))
    return description.replace(
      "OpenCode itself",
      "shiyou (识油), the desktop app built on OpenCode, or OpenCode itself",
    )

  return `Use this skill for any question about shiyou (识油), the desktop app built on OpenCode. ${description}`
}

const MCP_SECTION = /^## \[MCP servers\]\([^)]*\)\n[\s\S]*?(?=^## )/m

/**
 * The skill's guide with shiyou's paths: a first section that names them, OpenCode's paths replaced where the guide
 * spells them out, and an MCP section that edits shiyou's file. When an upstream change moves the text these
 * replacements look for, the first section still names the right paths, and the MCP section follows it.
 *
 * @param {string} content
 * @param {{ directory: string, file: string, log: string }} paths
 */
function guide(content, paths) {
  const replaced = content
    .replaceAll("`~/.config/opencode/opencode.json(c)`", `\`${paths.file}\``)
    .replaceAll("`~/.local/share/opencode/log/opencode.log`", `\`${paths.log}\``)

  const found = MCP_SECTION.test(replaced)
  const body = found ? replaced.replace(MCP_SECTION, mcpSection(paths)) : replaced
  const intro = introSection(paths) + (found ? "" : mcpSection(paths))
  // Before the first section, so the guide's opening paragraphs stay under its title.
  const first = body.search(/^## /m)

  if (first === -1) return `${body.trimEnd()}\n\n${intro}`

  return body.slice(0, first) + intro + body.slice(first)
}

/** @param {{ directory: string, file: string, log: string }} paths */
function introSection(paths) {
  return `## shiyou (识油)

You are running in shiyou (识油), a desktop app built on OpenCode. shiyou runs its own OpenCode server, which keeps
its configuration, sessions, sign-ins and logs apart from any OpenCode installed on this computer. Wherever this guide
or the OpenCode documentation names OpenCode's own folders, use shiyou's instead:

- Global configuration: \`${paths.file}\`. It replaces \`~/.config/opencode/opencode.json(c)\` (and
  \`$XDG_CONFIG_HOME/opencode/\`) and applies to every project in shiyou. Edit \`opencode.json\` in the same folder
  instead only when that file exists and \`opencode.jsonc\` does not.
- Server log: \`${paths.log}\`.
- Project configuration works as in OpenCode: \`opencode.json(c)\` or \`.opencode/opencode.json(c)\` in the project.

Never change \`~/.config/opencode/\` for shiyou: it holds the user's own OpenCode configuration, which shiyou does not
read. \`opencode\` commands run from the shell (\`opencode mcp\`, \`opencode service\`, \`opencode api\` and the rest)
reach that OpenCode installation, not shiyou's server, so do not use them to inspect or change shiyou.

`
}

/** @param {{ directory: string, file: string, log: string }} paths */
function mcpSection(paths) {
  return `## MCP servers

Configure MCP servers under \`mcp.servers\` in shiyou's global configuration file, \`${paths.file}\`, so they are
available in every project. Only when the user explicitly wants a server limited to one project, put it in that
project's \`opencode.json(c)\` or \`.opencode/opencode.json(c)\` instead. The user can also add, edit and remove the
global ones in shiyou under Settings › Extensions › MCPs, which writes the same file.

Edit the file directly with your file tools. Read it first and keep every unrelated setting; create it when it is
missing. Each server is keyed by its name. A local server runs a command; a remote server is a URL:

\`\`\`jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"],
        "environment": { "EXAMPLE_VARIABLE": "value" },
      },
      "docs": {
        "type": "remote",
        "url": "https://mcp.example.com/mcp",
      },
    },
  },
}
\`\`\`

Set \`"disabled": true\` on a server to keep it configured but not connected. Never use the V1 shape, with servers
directly under \`mcp\`. Do not run \`opencode mcp add\`, \`opencode mcp list\` or \`opencode mcp auth\`: from the shell
they read and write the user's own OpenCode configuration, not shiyou's.

The server reloads the file when it is saved, so don't tell the user to restart shiyou. Then check the result with the
\`shiyou_mcp_status\` tool (in Code Mode, \`tools.shiyou.mcp_status\` inside \`execute\`): it lists every MCP server
with its status and error, and which ones the global configuration file defines. A server can take a few seconds to
connect.

Remote servers use OAuth by default. If a server needs authentication, tell the user to sign in from Settings ›
Extensions › MCPs, or from the MCPs dialog (\`/mcp\` in the composer). Report the server as configured but awaiting
sign-in until its status says it is connected.

OAuth credentials are stored outside the configuration. Do not ask for or store an API key when the server supports
OAuth. Use header-based credentials only when OAuth is unavailable or the user explicitly requires them, and use an
environment substitution such as \`{env:MCP_API_KEY}\` instead of writing a secret into the configuration.

`
}

/**
 * The servers a configuration text defines under `mcp.servers`, or none when it is missing or does not parse.
 *
 * @param {string | null} text
 * @returns {Record<string, unknown>}
 */
function servers(text) {
  const document = text === null ? undefined : parse(text)
  const mcp = document?.mcp
  const configured = isObject(mcp) ? mcp.servers : undefined

  return isObject(configured) ? configured : {}
}

/** @param {string} text */
function isDocument(text) {
  // Bun's JSONC parser reads empty text as `{}`; an empty write would wipe the configuration.
  return text.trim() !== "" && isObject(parse(text))
}

/**
 * @param {string} text
 * @returns {Record<string, unknown> | undefined}
 */
function parse(text) {
  try {
    const value = Bun.JSONC.parse(text)

    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  // SAFETY: this is the plugin's parse boundary for what Bun.JSONC.parse returns; the plugin imports no schema library.
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** @param {string} file */
async function readText(file) {
  return readFile(file, "utf8").catch((/** @type {NodeJS.ErrnoException} */ error) => {
    if (error.code === "ENOENT") return null
    throw error
  })
}

/** @param {string} file */
async function isFile(file) {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  )
}
