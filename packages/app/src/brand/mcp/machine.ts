import {
  draftOf,
  emptyDraft,
  readDocument,
  removeServer,
  validateDraft,
  writeServer,
  type McpDraft,
  type McpDraftErrors,
  type McpDraftField,
} from "./config"
import type { McpConfigSource } from "./rpc"

/**
 * shiyou: the MCP server editor of Settings › Extensions › MCPs. It edits one server of the server's global
 * configuration file: adds it, saves changes, or removes it. A write carries the text it was computed from, and the
 * server refuses it when the file changed since (the agent or an editor saved it); the editor then applies the same
 * change to the new text once, so a concurrent edit elsewhere in the file is kept rather than overwritten.
 */

export const MCP_EDITOR_WRITE_TIMEOUT_MS = 15_000

/** Why the last save or removal did not happen. */
export type McpEditorFailure =
  /** The file does not parse, so the editor won't touch it. */
  | { readonly type: "broken" }
  /** The file kept changing while the editor wrote it. */
  | { readonly type: "conflict" }
  /** The server refused the text as configuration. */
  | { readonly type: "invalid" }
  | { readonly type: "timeout" }
  | { readonly type: "request"; readonly message: string }

type Target = {
  readonly source: McpConfigSource
  /** The name the edited server is saved under; absent while adding one. */
  readonly original?: string
  readonly draft: McpDraft
}

export type McpEditorState =
  | (Target & {
      readonly status: "editing"
      readonly attempt: number
      readonly errors: McpDraftErrors
      readonly failure?: McpEditorFailure
      /** The user asked to remove the server and has to confirm. */
      readonly confirming: boolean
    })
  | (Target & {
      readonly status: "writing"
      readonly attempt: number
      readonly action: "save" | "remove"
      /** This write already applied the change again after a conflict. */
      readonly rebased: boolean
    })
  | { readonly status: "done" }

export type McpEditorEvent =
  | { readonly type: "field.changed"; readonly field: McpDraftField; readonly value: string }
  | { readonly type: "type.changed"; readonly value: McpDraft["type"] }
  | { readonly type: "enabled.changed"; readonly value: boolean }
  | { readonly type: "save.requested" }
  | { readonly type: "remove.requested" }
  | { readonly type: "remove.cancelled" }
  | { readonly type: "remove.confirmed" }
  | { readonly type: "write.succeeded"; readonly attempt: number }
  | { readonly type: "write.conflicted"; readonly attempt: number; readonly source: McpConfigSource }
  | { readonly type: "write.refused"; readonly attempt: number }
  | { readonly type: "write.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "write.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type McpEditorEffect =
  | {
      readonly type: "write"
      readonly attempt: number
      readonly source: McpConfigSource
      readonly text: string
      readonly timeoutMs: number
    }
  | { readonly type: "abort"; readonly attempt: number }
  /** The file now holds the change; the editor closes. */
  | { readonly type: "finished"; readonly action: "save" | "remove"; readonly name: string }

export type McpEditorTransition = { readonly state: McpEditorState; readonly effects: readonly McpEditorEffect[] }

type OpenState = Exclude<McpEditorState, { status: "done" }>

const NO_ERRORS: McpDraftErrors = {}

/** An editor for `original` in `source`, or for a new server. */
export function createMcpEditorState(
  source: McpConfigSource,
  original?: string,
): Extract<McpEditorState, { status: "editing" }> {
  const document = readDocument(source.text)

  const draft =
    original === undefined
      ? emptyDraft()
      : draftOf(original, document.status === "ready" ? document.servers.get(original) : undefined)

  return {
    status: "editing",
    source,
    original,
    draft,
    attempt: 0,
    errors: {},
    failure: document.status === "broken" ? { type: "broken" } : undefined,
    confirming: false,
  }
}

export function transitionMcpEditor(state: McpEditorState, event: McpEditorEvent): McpEditorTransition {
  const same = { state, effects: [] }

  if (state.status === "done") return same

  if (event.type === "disposed")
    return {
      state: { status: "done" },
      effects: state.status === "writing" ? [{ type: "abort", attempt: state.attempt }] : [],
    }

  if (state.status === "editing") return edit(state, event) ?? same

  if (!("attempt" in event) || event.attempt !== state.attempt) return same

  if (event.type === "write.succeeded")
    return {
      state: { status: "done" },
      effects: [{ type: "finished", action: state.action, name: state.original ?? state.draft.name.trim() }],
    }

  if (event.type === "write.conflicted") {
    // Once: a file that changes again while the editor writes is left for the user to look at.
    if (state.rebased) return { state: stopped(state, { type: "conflict" }, event.source), effects: [] }

    return write({ ...state, source: event.source }, state.action, state.attempt, true)
  }

  if (event.type === "write.refused") return { state: stopped(state, { type: "invalid" }), effects: [] }

  if (event.type === "write.timed-out")
    return {
      state: stopped(state, { type: "timeout" }),
      effects: [{ type: "abort", attempt: state.attempt }],
    }

  if (event.type === "write.failed")
    return { state: stopped(state, { type: "request", message: event.message }), effects: [] }

  return same
}

export type McpEditorView = ReturnType<typeof openView>

/** What the dialog shows; nothing once the editor is done. */
export function mcpEditorView(state: OpenState): McpEditorView
export function mcpEditorView(state: McpEditorState): McpEditorView | undefined
export function mcpEditorView(state: McpEditorState) {
  return state.status === "done" ? undefined : openView(state)
}

function openView(state: OpenState) {
  return {
    draft: state.draft,
    adding: state.original === undefined,
    file: state.source.file,
    errors: state.status === "editing" ? state.errors : NO_ERRORS,
    failure: state.status === "editing" ? state.failure : undefined,
    confirming: state.status === "editing" && state.confirming,
    /** A write runs; every control waits. */
    busy: state.status === "writing",
    removing: state.status === "writing" && state.action === "remove",
  }
}

function edit(
  state: Extract<McpEditorState, { status: "editing" }>,
  event: McpEditorEvent,
): McpEditorTransition | undefined {
  if (event.type === "field.changed")
    return {
      state: {
        ...state,
        draft: { ...state.draft, [event.field]: event.value },
        errors: { ...state.errors, [event.field]: undefined },
        failure: state.failure?.type === "broken" ? state.failure : undefined,
        confirming: false,
      },
      effects: [],
    }

  if (event.type === "type.changed" && event.value !== state.draft.type)
    return { state: { ...state, draft: { ...state.draft, type: event.value }, confirming: false }, effects: [] }

  if (event.type === "enabled.changed" && event.value !== state.draft.enabled)
    return { state: { ...state, draft: { ...state.draft, enabled: event.value }, confirming: false }, effects: [] }

  if (event.type === "save.requested") return write(state, "save", state.attempt, false)

  if (event.type === "remove.requested" && state.original !== undefined && !state.confirming)
    return { state: { ...state, confirming: true }, effects: [] }

  if (event.type === "remove.cancelled" && state.confirming)
    return { state: { ...state, confirming: false }, effects: [] }

  if (event.type === "remove.confirmed" && state.confirming) return write(state, "remove", state.attempt, false)

  return undefined
}

// Computes the change against the target's text and starts writing it, or says why it can't.
function write(
  state: Target & { readonly attempt: number },
  action: "save" | "remove",
  attempt: number,
  rebased: boolean,
): McpEditorTransition {
  const document = readDocument(state.source.text)

  if (document.status === "broken") return { state: stopped(state, { type: "broken" }), effects: [] }

  const change = action === "remove" ? removed(state, document.servers) : saved(state, document.servers)

  // Someone else already removed it: the file is as the user wants it.
  if (change.type === "unchanged")
    return { state: { status: "done" }, effects: [{ type: "finished", action, name: state.original ?? "" }] }

  if (change.type === "invalid") return { state: { ...stopped(state), errors: change.errors }, effects: [] }

  // An edit that would leave the file unreadable is never sent.
  if (readDocument(change.text).status === "broken") return { state: stopped(state, { type: "broken" }), effects: [] }

  const next = attempt + 1

  return {
    state: {
      status: "writing",
      source: state.source,
      original: state.original,
      draft: state.draft,
      attempt: next,
      action,
      rebased,
    },
    effects: [
      { type: "write", attempt: next, source: state.source, text: change.text, timeoutMs: MCP_EDITOR_WRITE_TIMEOUT_MS },
    ],
  }
}

type Change =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "invalid"; readonly errors: McpDraftErrors }
  | { readonly type: "unchanged" }

// The text with the draft written, or the draft's errors.
function saved(state: Target, servers: ReadonlyMap<string, unknown>): Change {
  const taken = new Set([...servers.keys()].filter((name) => name !== state.original))
  const result = validateDraft(state.draft, taken, state.original)

  if (!result.ok) return { type: "invalid", errors: result.errors }

  return {
    type: "text",
    text: writeServer(state.source.text, { original: state.original, name: result.name, fields: result.fields }),
  }
}

// The text without the server; unchanged when the file no longer has it.
function removed(state: Target, servers: ReadonlyMap<string, unknown>): Change {
  if (state.original === undefined || state.source.text === null || !servers.has(state.original))
    return { type: "unchanged" }

  return { type: "text", text: removeServer(state.source.text, state.original) }
}

function stopped(
  state: Target & { readonly attempt: number },
  failure?: McpEditorFailure,
  source = state.source,
): Extract<McpEditorState, { status: "editing" }> {
  return {
    status: "editing",
    source,
    original: state.original,
    draft: state.draft,
    attempt: state.attempt,
    errors: {},
    failure,
    confirming: false,
  }
}
