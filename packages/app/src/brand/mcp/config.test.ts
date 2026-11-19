import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import {
  draftOf,
  emptyDraft,
  formatCommand,
  parseCommand,
  readDocument,
  removeServer,
  validateDraft,
  writeServer,
} from "./config"

const FILE = `{
  // Picked in Settings › General.
  "shell": "/bin/zsh",
  "mcp": {
    "servers": {
      // Team docs.
      "docs": {
        "type": "remote",
        "url": "https://docs.example.com/mcp",
        "oauth": { "scope": "read" },
        "timeout": { "startup": 5000 },
      },
    },
  },
}
`

const servers = (text: string) => parse(text, [], { allowTrailingComma: true }).mcp.servers

function valid(draft: Parameters<typeof validateDraft>[0], taken = new Set<string>(), original?: string) {
  const result = validateDraft(draft, taken, original)

  if (!result.ok) throw new Error(`invalid draft: ${JSON.stringify(result.errors)}`)

  return result
}

describe("MCP config edits", () => {
  test("adds a server without touching comments or other settings", () => {
    const draft = { ...emptyDraft(), name: "files", command: "npx -y @modelcontextprotocol/server-filesystem /tmp" }
    const text = writeServer(FILE, valid(draft))

    expect(text).toContain("// Picked in Settings › General.")
    expect(text).toContain("// Team docs.")
    expect(parse(text, [], { allowTrailingComma: true }).shell).toBe("/bin/zsh")
    expect(servers(text).files).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    })
  })

  test("starts a missing file as a document with OpenCode's schema", () => {
    const text = writeServer(null, valid({ ...emptyDraft(), name: "docs", type: "remote", url: "https://x.dev/mcp" }))

    expect(parse(text)).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: { docs: { type: "remote", url: "https://x.dev/mcp" } } },
    })
    expect(text.endsWith("\n")).toBe(true)
  })

  test("edits the fields the editor owns and keeps the rest", () => {
    const draft = {
      ...draftOf("docs", servers(FILE).docs),
      headers: "Authorization: Bearer {env:DOCS_TOKEN}",
      enabled: false,
    }

    const text = writeServer(FILE, { original: "docs", ...valid(draft, new Set(), "docs") })

    expect(text).toContain("// Team docs.")
    expect(servers(text).docs).toEqual({
      type: "remote",
      url: "https://docs.example.com/mcp",
      oauth: { scope: "read" },
      timeout: { startup: 5000 },
      headers: { Authorization: "Bearer {env:DOCS_TOKEN}" },
      disabled: true,
    })
  })

  test("moves a renamed server with the fields the editor doesn't own", () => {
    const draft = { ...draftOf("docs", servers(FILE).docs), name: "handbook" }
    const text = writeServer(FILE, { original: "docs", ...valid(draft, new Set(), "docs") })

    expect(Object.keys(servers(text))).toEqual(["handbook"])
    expect(servers(text).handbook).toMatchObject({ oauth: { scope: "read" }, timeout: { startup: 5000 } })
  })

  test("drops the other type's fields when a server changes type", () => {
    const draft = { ...draftOf("docs", servers(FILE).docs), type: "local" as const, command: "docs-mcp --stdio" }
    const text = writeServer(FILE, { original: "docs", ...valid(draft, new Set(), "docs") })

    expect(servers(text).docs).toEqual({ type: "local", timeout: { startup: 5000 }, command: ["docs-mcp", "--stdio"] })
  })

  test("keeps a file with trailing commas parseable through every edit", () => {
    const docs = draftOf("docs", servers(FILE).docs)

    const texts = [
      writeServer(FILE, valid({ ...emptyDraft(), name: "files", command: "files-mcp" }, new Set(["docs"]))),
      writeServer(FILE, { original: "docs", ...valid({ ...docs, enabled: false }, new Set(), "docs") }),
      writeServer(FILE, { original: "docs", ...valid({ ...docs, name: "handbook" }, new Set(), "docs") }),
      removeServer(FILE, "docs"),
    ]

    for (const text of texts) expect(readDocument(text).status).toBe("ready")
  })

  test("removes a server and nothing else", () => {
    const text = removeServer(FILE, "docs")

    expect(servers(text)).toEqual({})
    expect(text).toContain("// Picked in Settings › General.")
  })
})

describe("MCP config documents", () => {
  test("lists the servers under mcp.servers", () => {
    expect(readDocument(FILE)).toEqual({ status: "ready", servers: new Map([["docs", servers(FILE).docs]]) })
    expect(readDocument(null)).toEqual({ status: "ready", servers: new Map() })
    expect(readDocument('{ "shell": "bash" }')).toEqual({ status: "ready", servers: new Map() })
  })

  test("refuses to edit text it can't edit safely", () => {
    for (const text of ['{ "mcp": ', "[]", '{ "mcp": [] }', '{ "mcp": { "servers": "none" } }'])
      expect(readDocument(text)).toEqual({ status: "broken" })
  })
})

describe("MCP drafts", () => {
  test("shows a saved server and writes it back unchanged", () => {
    const saved = {
      type: "local",
      command: ["node", "C:\\Program Files\\mcp\\server.js", "--name", 'it\'s "quoted"', ""],
      environment: { API_URL: "https://x.dev/a=b" },
      disabled: true,
    }

    const draft = draftOf("tools", saved)

    expect(draft).toMatchObject({
      name: "tools",
      type: "local",
      environment: "API_URL=https://x.dev/a=b",
      enabled: false,
    })
    expect(valid(draft, new Set(), "tools").fields).toMatchObject(saved)
  })

  test("splits a command like a shell line, without escapes", () => {
    expect(parseCommand('  npx  -y "@scope/server name"  ')).toEqual(["npx", "-y", "@scope/server name"])
    expect(parseCommand("C:\\tools\\mcp.exe --root 'D:\\My Data'")).toEqual([
      "C:\\tools\\mcp.exe",
      "--root",
      "D:\\My Data",
    ])
    expect(parseCommand('say "unclosed')).toBeUndefined()

    for (const parts of [["a b", "", "it's", 'say "hi"', "plain"], ["\"'\"'"]])
      expect(parseCommand(formatCommand(parts))).toEqual(parts)
  })

  test("names what is wrong with a draft", () => {
    const taken = new Set(["docs"])

    const cases = [
      [{ name: " " }, { name: "required", command: "required" }],
      [{ name: "docs", command: "x" }, { name: "taken" }],
      [{ name: "my server", command: "x" }, { name: "invalid" }],
      [{ name: "a", command: 'x "y' }, { command: "unclosed" }],
      [{ name: "a", command: "x", environment: "OK=1\n\nnot a pair" }, { environment: 3 }],
      [{ name: "a", type: "remote" as const }, { url: "required" }],
      [{ name: "a", type: "remote" as const, url: "ftp://x" }, { url: "invalid" }],
      [{ name: "a", type: "remote" as const, url: "https://x", headers: "Authorization Bearer" }, { headers: 1 }],
    ] as const

    for (const [draft, errors] of cases)
      expect(validateDraft({ ...emptyDraft(), ...draft }, taken)).toEqual({ ok: false, errors })
  })

  test("keeps a saved name that a new server could not have", () => {
    expect(valid({ ...emptyDraft(), name: "my.server", command: "x" }, new Set(), "my.server").name).toBe("my.server")
  })
})
