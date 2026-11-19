import type { Rpc } from "@opencode/schema/rpc"
import { Option, Schema } from "effect"
import type { ServerApi } from "@/runtime/server/api"

/**
 * shiyou: the client's copy of the `shiyou.mcp-config` RPC. shiyou's server serves it from the plugin in
 * packages/desktop/src/main/service/shiyou-mcp-config.plugin.js, which validates every call against its own JSON
 * schemas; keep the two in step. Other servers don't have it.
 */

const Source = Schema.Struct({ file: Schema.String, text: Schema.NullOr(Schema.String) })

/** The server's global configuration file and its text, `null` while it does not exist. */
export type McpConfigSource = typeof Source.Type

const definition = {
  id: "shiyou.mcp-config",
  methods: {
    read: { input: Schema.toStandardSchemaV1(Schema.Struct({})), output: Schema.toStandardSchemaV1(Source) },
    write: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({ file: Schema.String, base: Schema.NullOr(Schema.String), text: Schema.String }),
      ),
      output: Schema.toStandardSchemaV1(Schema.Struct({ file: Schema.String })),
      errors: {
        conflict: Schema.toStandardSchemaV1(Source),
        invalid: Schema.toStandardSchemaV1(Schema.Struct({})),
      },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

// RPC failures reach the client as plain `{ type, message, data? }` objects.
const Unavailable = Schema.Struct({ type: Schema.Literals(["rpc.unavailable", "rpc.method_not_found"]) })

const Conflict = Schema.Struct({ type: Schema.Literal("conflict"), data: Source })

const Refused = Schema.Struct({ type: Schema.Literal("invalid") })

/** How a write ended: written, refused because the file changed since `base` (with the file as it is now), or refused. */
export type McpConfigWrite =
  | { readonly type: "written" }
  | { readonly type: "conflict"; readonly source: McpConfigSource }
  | { readonly type: "invalid" }

export function mcpConfigClient(api: Pick<ServerApi, "rpc">) {
  const rpc = api.rpc(definition)

  return {
    /** The file, or `undefined` when the server has no such RPC: it is not shiyou's, or the plugin did not load. */
    read: (signal: AbortSignal) =>
      rpc.read({}, { signal }).then(
        (output) => Schema.decodeUnknownSync(Source)(output),
        (error) => {
          if (Option.isSome(Schema.decodeUnknownOption(Unavailable)(error))) return undefined

          throw error
        },
      ),
    /** Replaces the file's text when it still reads `source.text`. */
    write: (input: { source: McpConfigSource; text: string }, signal: AbortSignal): Promise<McpConfigWrite> =>
      rpc.write({ file: input.source.file, base: input.source.text, text: input.text }, { signal }).then(
        () => ({ type: "written" }),
        (error) => {
          const conflict = Schema.decodeUnknownOption(Conflict)(error)

          if (Option.isSome(conflict)) return { type: "conflict", source: conflict.value.data }

          if (Option.isSome(Schema.decodeUnknownOption(Refused)(error))) return { type: "invalid" }

          throw error
        },
      ),
  }
}
