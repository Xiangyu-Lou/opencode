import { Option, Schema } from "effect"
import { applyEdits, modify, parse, visit, type JSONPath, type ParseError } from "jsonc-parser"

/**
 * shiyou: the MCP servers of a configuration text, and the edits Settings makes to them. Edits go through jsonc-parser,
 * like OpenCode's own config writer, so comments, formatting and every other setting stay as they are. Editing a
 * server changes only the fields the editor owns; fields it doesn't show (`timeout`, `codemode`, `oauth`…) stay.
 */

const SERVERS = ["mcp", "servers"]

const SCHEMA = "https://opencode.ai/config.json"

// Letters, digits, `-` and `_`, as MCP clients name servers. A server already saved under another name keeps it.
const NAME = /^[A-Za-z0-9_-]+$/

type Json = typeof Schema.Json.Type

// A saved server as it is, with the fields the editor doesn't know, so a renamed server takes them along.
const Saved = Schema.Record(Schema.String, Schema.Json)

const Document = Schema.Struct({
  mcp: Schema.optional(Schema.Struct({ servers: Schema.optional(Saved) })),
})

// The fields of a saved server the editor shows.
const Shown = Schema.Struct({
  type: Schema.optional(Schema.String),
  command: Schema.optional(Schema.Array(Schema.String)),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  disabled: Schema.optional(Schema.Boolean),
})

const NOTHING_SHOWN: typeof Shown.Type = {}

/** A server as the editor shows it. Commands, variables and headers are text the user types. */
export type McpDraft = {
  readonly name: string
  readonly type: "local" | "remote"
  /** The command and its arguments, split like a shell line: spaces separate, quotes group. */
  readonly command: string
  /** `NAME=value` per line. */
  readonly environment: string
  readonly url: string
  /** `Name: value` per line. */
  readonly headers: string
  readonly enabled: boolean
}

/** The editor's text fields. */
export type McpDraftField = "name" | "command" | "environment" | "url" | "headers"

/** What a draft that does not validate gets wrong, per field. A line number is 1-based. */
export type McpDraftErrors = {
  readonly name?: "required" | "invalid" | "taken"
  readonly command?: "required" | "unclosed"
  readonly url?: "required" | "invalid"
  readonly environment?: number
  readonly headers?: number
}

/** The fields an edit writes, `undefined` for one it removes. */
export type McpServerFields = Readonly<Record<string, Json | undefined>>

/** The servers a configuration text defines, or `broken` when it does not parse or `mcp.servers` is not an object. */
export type McpDocument =
  | { readonly status: "ready"; readonly servers: ReadonlyMap<string, Json> }
  | { readonly status: "broken" }

export function readDocument(text: string | null): McpDocument {
  if (text === null) return { status: "ready", servers: new Map() }

  const errors: ParseError[] = []
  const document = Schema.decodeUnknownOption(Document)(parse(text, errors, { allowTrailingComma: true }))

  // jsonc-parser reads a non-object root as itself, so the schema refuses it too.
  if (errors.length > 0 || Option.isNone(document)) return { status: "broken" }

  return { status: "ready", servers: new Map(Object.entries(document.value.mcp?.servers ?? {})) }
}

export function emptyDraft(): McpDraft {
  return { name: "", type: "local", command: "", environment: "", url: "", headers: "", enabled: true }
}

/** The editor's view of a saved server. A server whose fields don't have the shapes it shows opens empty. */
export function draftOf(name: string, saved: Json | undefined): McpDraft {
  const shown = Option.getOrElse(Schema.decodeUnknownOption(Shown)(saved), () => NOTHING_SHOWN)

  return {
    name,
    type: shown.type === "remote" ? "remote" : "local",
    command: formatCommand(shown.command ?? []),
    environment: formatPairs(shown.environment ?? {}, "="),
    url: shown.url ?? "",
    headers: formatPairs(shown.headers ?? {}, ": "),
    enabled: shown.disabled !== true,
  }
}

/**
 * The fields to write for a draft, or what is wrong with it. `taken` holds the names other servers use; `original` is
 * the name the edited server is saved under, which may keep a form a new name could not have.
 */
export function validateDraft(
  draft: McpDraft,
  taken: ReadonlySet<string>,
  original?: string,
):
  | { readonly ok: true; readonly name: string; readonly fields: McpServerFields }
  | { readonly ok: false; readonly errors: McpDraftErrors } {
  const name = draft.name.trim()

  const nameError = !name
    ? "required"
    : taken.has(name)
      ? "taken"
      : name !== original && !NAME.test(name)
        ? "invalid"
        : undefined

  const disabled = draft.enabled ? undefined : true

  if (draft.type === "local") {
    const command = parseCommand(draft.command)
    const environment = parsePairs(draft.environment, "=")
    const commandError = command === undefined ? "unclosed" : command.length === 0 ? "required" : undefined

    if (nameError || commandError || !command || !environment.ok)
      return {
        ok: false,
        errors: { name: nameError, command: commandError, environment: environment.ok ? undefined : environment.line },
      }

    return {
      ok: true,
      name,
      fields: {
        type: "local",
        command,
        environment: Object.keys(environment.pairs).length > 0 ? environment.pairs : undefined,
        disabled,
        url: undefined,
        headers: undefined,
        oauth: undefined,
      },
    }
  }

  const url = draft.url.trim()
  const headers = parsePairs(draft.headers, ":")
  const urlError = !url ? "required" : !isHttpUrl(url) ? "invalid" : undefined

  if (nameError || urlError || !headers.ok)
    return { ok: false, errors: { name: nameError, url: urlError, headers: headers.ok ? undefined : headers.line } }

  return {
    ok: true,
    name,
    fields: {
      type: "remote",
      url,
      headers: Object.keys(headers.pairs).length > 0 ? headers.pairs : undefined,
      disabled,
      command: undefined,
      environment: undefined,
      cwd: undefined,
    },
  }
}

/**
 * The text with one server written: added under `name`, or, with `original`, edited in place or moved to a new name
 * with the fields the editor doesn't own. A missing file starts as a document with OpenCode's `$schema`.
 */
export function writeServer(
  text: string | null,
  edit: { readonly original?: string; readonly name: string; readonly fields: McpServerFields },
) {
  const base = withoutTrailingCommas(text ?? `{\n  "$schema": "${SCHEMA}"\n}\n`)

  if (edit.original === undefined)
    return finish(
      change(
        base,
        [...SERVERS, edit.name],
        Object.fromEntries(
          Object.entries(edit.fields).filter((entry): entry is [string, Json] => entry[1] !== undefined),
        ),
      ),
    )

  const document = readDocument(base)

  const kept = Schema.decodeUnknownOption(Saved)(
    document.status === "ready" ? document.servers.get(edit.original) : undefined,
  )

  const moved =
    edit.original === edit.name
      ? base
      : change(
          change(base, [...SERVERS, edit.original], undefined),
          [...SERVERS, edit.name],
          Option.getOrElse(kept, () => ({})),
        )

  return finish(
    Object.entries(edit.fields).reduce(
      (current, [key, value]) => change(current, [...SERVERS, edit.name, key], value),
      moved,
    ),
  )
}

/** The text without the server `name`. */
export function removeServer(text: string, name: string) {
  return finish(change(withoutTrailingCommas(text), [...SERVERS, name], undefined))
}

/** A command line split into its arguments; `undefined` when a quote is left open. No escapes, so Windows paths stay. */
export function parseCommand(text: string) {
  const parts: string[] = []
  const current = { value: "", started: false, quote: "" }

  for (const char of text) {
    if (current.quote) {
      if (char === current.quote) current.quote = ""
      else current.value += char

      continue
    }

    if (char === '"' || char === "'") {
      current.quote = char
      current.started = true

      continue
    }

    if (/\s/.test(char)) {
      if (current.started) parts.push(current.value)

      current.value = ""
      current.started = false

      continue
    }

    current.value += char
    current.started = true
  }

  if (current.quote) return undefined

  if (current.started) parts.push(current.value)

  return parts
}

/** Arguments as one command line that `parseCommand` splits back into the same arguments. */
export function formatCommand(parts: readonly string[]) {
  return parts.map(quote).join(" ")
}

function quote(part: string) {
  if (/^[^\s"']+$/.test(part)) return part

  // Quote runs without `"` in double quotes and runs of `"` in single quotes; adjacent quoted runs join into one part.
  return (part.match(/"+|[^"]+/g) ?? [""]).map((run) => (run.startsWith('"') ? `'${run}'` : `"${run}"`)).join("")
}

/** `name<separator>value` lines as a record, or the 1-based number of the first line that isn't one. */
function parsePairs(text: string, separator: "=" | ":") {
  const pairs: Record<string, string> = {}
  const lines = text.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue

    const at = line.indexOf(separator)
    const key = line.slice(0, at).trim()

    if (at <= 0 || !key || /\s/.test(key)) return { ok: false, line: index + 1 } as const

    pairs[key] = line.slice(at + 1).trim()
  }

  return { ok: true, pairs } as const
}

function formatPairs(pairs: Readonly<Record<string, string>>, separator: "=" | ": ") {
  return Object.entries(pairs)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n")
}

// jsonc-parser's `modify` leaves a stray comma when it removes or appends next to a trailing comma, which JSONC allows
// and editors add. Edits run on the text without its trailing commas; comments and everything else stay.
function withoutTrailingCommas(text: string) {
  const commas: number[] = []
  const pending = { comma: -1 }
  const clear = () => void (pending.comma = -1)

  const close = () => {
    if (pending.comma !== -1) commas.push(pending.comma)

    clear()
  }

  visit(
    text,
    {
      onObjectBegin: clear,
      onArrayBegin: clear,
      onObjectProperty: clear,
      onLiteralValue: clear,
      onSeparator: (character, offset) => void (pending.comma = character === "," ? offset : -1),
      onObjectEnd: close,
      onArrayEnd: close,
    },
    { allowTrailingComma: true },
  )

  return commas.toReversed().reduce((current, offset) => current.slice(0, offset) + current.slice(offset + 1), text)
}

function change(text: string, path: JSONPath, value: Json | undefined) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"

  return applyEdits(text, modify(text, path, value, { formattingOptions: { tabSize: 2, insertSpaces: true, eol } }))
}

function finish(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`
}

function isHttpUrl(text: string) {
  if (!URL.canParse(text)) return false

  const protocol = new URL(text).protocol

  return protocol === "http:" || protocol === "https:"
}
