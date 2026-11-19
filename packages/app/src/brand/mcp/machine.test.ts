import { describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import {
  createMcpEditorState,
  mcpEditorView,
  transitionMcpEditor,
  type McpEditorEffect,
  type McpEditorEvent,
  type McpEditorState,
} from "./machine"

const FILE = "/config/opencode/opencode.jsonc"

const TEXT = `{
  "mcp": {
    "servers": {
      "docs": { "type": "remote", "url": "https://docs.example.com/mcp" },
    },
  },
}
`

function run(state: McpEditorState, events: readonly McpEditorEvent[]) {
  return events.reduce<{ state: McpEditorState; effects: McpEditorEffect[] }>(
    (current, event) => {
      const next = transitionMcpEditor(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const writes = (effects: readonly McpEditorEffect[]) =>
  effects.filter((effect): effect is Extract<McpEditorEffect, { type: "write" }> => effect.type === "write")

const servers = (text: string) => parse(text, [], { allowTrailingComma: true }).mcp.servers

const adding: McpEditorEvent[] = [
  { type: "field.changed", field: "name", value: "files" },
  { type: "field.changed", field: "command", value: "files-mcp --root /data" },
]

describe("MCP editor", () => {
  test("adds a server and finishes once the server wrote it", () => {
    const result = run(createMcpEditorState({ file: FILE, text: null }), [...adding, { type: "save.requested" }])
    const [write] = writes(result.effects)

    expect(result.state.status).toBe("writing")
    expect(write.source).toEqual({ file: FILE, text: null })
    expect(servers(write.text)).toEqual({ files: { type: "local", command: ["files-mcp", "--root", "/data"] } })
    expect(mcpEditorView(result.state)?.busy).toBe(true)

    const done = transitionMcpEditor(result.state, { type: "write.succeeded", attempt: write.attempt })

    expect(done).toEqual({ state: { status: "done" }, effects: [{ type: "finished", action: "save", name: "files" }] })
  })

  test("shows a draft's errors and writes nothing", () => {
    const result = run(createMcpEditorState({ file: FILE, text: TEXT }), [
      { type: "field.changed", field: "name", value: "docs" },
      { type: "save.requested" },
    ])

    expect(writes(result.effects)).toEqual([])
    expect(mcpEditorView(result.state)?.errors).toEqual({ name: "taken", command: "required" })

    // Typing in a field clears its error.
    const typed = transitionMcpEditor(result.state, { type: "field.changed", field: "name", value: "docs2" })

    expect(mcpEditorView(typed.state)?.errors).toEqual({ name: undefined, command: "required" })
  })

  test("applies the change again to a file that changed, keeping what the other writer saved", () => {
    const started = run(createMcpEditorState({ file: FILE, text: TEXT }, "docs"), [
      { type: "enabled.changed", value: false },
      { type: "save.requested" },
    ])

    const first = writes(started.effects)[0]
    // The agent added a server meanwhile.

    const changed = TEXT.replace(
      '"servers": {',
      '"servers": {\n      "fresh": { "type": "remote", "url": "https://y.dev" },',
    )

    const rebased = transitionMcpEditor(started.state, {
      type: "write.conflicted",
      attempt: first.attempt,
      source: { file: FILE, text: changed },
    })

    const second = writes(rebased.effects)[0]

    expect(second.attempt).toBeGreaterThan(first.attempt)
    expect(second.source.text).toBe(changed)
    expect(servers(second.text)).toEqual({
      fresh: { type: "remote", url: "https://y.dev" },
      docs: { type: "remote", url: "https://docs.example.com/mcp", disabled: true },
    })

    // A file that changes again is left to the user, who sees it as it is now.
    const again = transitionMcpEditor(rebased.state, {
      type: "write.conflicted",
      attempt: second.attempt,
      source: { file: FILE, text: TEXT },
    })

    expect(again.effects).toEqual([])
    expect(mcpEditorView(again.state)?.failure).toEqual({ type: "conflict" })
    expect(writes(transitionMcpEditor(again.state, { type: "save.requested" }).effects)[0].source.text).toBe(TEXT)
  })

  test("ignores the answer to an attempt it no longer waits for", () => {
    const started = run(createMcpEditorState({ file: FILE, text: null }), [...adding, { type: "save.requested" }])
    const attempt = writes(started.effects)[0].attempt
    const timedOut = transitionMcpEditor(started.state, { type: "write.timed-out", attempt })

    expect(timedOut.effects).toEqual([{ type: "abort", attempt }])
    expect(mcpEditorView(timedOut.state)?.failure).toEqual({ type: "timeout" })

    for (const event of [
      { type: "write.succeeded", attempt },
      { type: "write.failed", attempt: attempt + 5, message: "late" },
    ] as const)
      expect(transitionMcpEditor(timedOut.state, event).state).toBe(timedOut.state)
  })

  test("ends a write that fails or that the server refuses in the editor, with the reason", () => {
    const started = run(createMcpEditorState({ file: FILE, text: null }), [...adding, { type: "save.requested" }])
    const attempt = writes(started.effects)[0].attempt

    const cases = [
      [{ type: "write.refused", attempt }, { type: "invalid" }],
      [
        { type: "write.failed", attempt, message: "RPC is unavailable" },
        { type: "request", message: "RPC is unavailable" },
      ],
    ] as const

    for (const [event, failure] of cases) {
      const next = transitionMcpEditor(started.state, event)

      expect(next.state.status).toBe("editing")
      expect(mcpEditorView(next.state)?.failure).toEqual(failure)
    }
  })

  test("removes a server only after the user confirms", () => {
    const editor = createMcpEditorState({ file: FILE, text: TEXT }, "docs")
    const asked = run(editor, [{ type: "remove.requested" }])

    expect(asked.effects).toEqual([])
    expect(mcpEditorView(asked.state)?.confirming).toBe(true)
    expect(run(asked.state, [{ type: "remove.cancelled" }]).state).toMatchObject({
      status: "editing",
      confirming: false,
    })

    const confirmed = run(asked.state, [{ type: "remove.confirmed" }])
    const [write] = writes(confirmed.effects)

    expect(servers(write.text)).toEqual({})
    expect(mcpEditorView(confirmed.state)?.removing).toBe(true)
    expect(transitionMcpEditor(confirmed.state, { type: "write.succeeded", attempt: write.attempt }).effects).toEqual([
      { type: "finished", action: "remove", name: "docs" },
    ])
  })

  test("finishes a removal the file already has", () => {
    const started = run(createMcpEditorState({ file: FILE, text: TEXT }, "docs"), [
      { type: "remove.requested" },
      { type: "remove.confirmed" },
    ])

    const attempt = writes(started.effects)[0].attempt

    const gone = transitionMcpEditor(started.state, {
      type: "write.conflicted",
      attempt,
      source: { file: FILE, text: '{ "mcp": { "servers": {} } }\n' },
    })

    expect(gone).toEqual({ state: { status: "done" }, effects: [{ type: "finished", action: "remove", name: "docs" }] })
  })

  test("never writes over a file it can't parse", () => {
    const editor = createMcpEditorState({ file: FILE, text: '{ "mcp": ' })
    const result = run(editor, [...adding, { type: "save.requested" }])

    expect(mcpEditorView(editor)?.failure).toEqual({ type: "broken" })
    expect(writes(result.effects)).toEqual([])
    expect(mcpEditorView(result.state)?.failure).toEqual({ type: "broken" })
  })

  test("aborts the running write when the dialog goes away", () => {
    const started = run(createMcpEditorState({ file: FILE, text: null }), [...adding, { type: "save.requested" }])
    const attempt = writes(started.effects)[0].attempt

    expect(transitionMcpEditor(started.state, { type: "disposed" })).toEqual({
      state: { status: "done" },
      effects: [{ type: "abort", attempt }],
    })
  })
})
