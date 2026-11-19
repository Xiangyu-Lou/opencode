import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"
import { CustomProvider, PROBLEM_KEYS, Protocol } from "./model"

/** A `/models` listing: the IDs, or why the API did not answer with them. */
export const ModelListing = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), models: Schema.Array(Schema.String) }),
  Schema.Struct({ ok: Schema.Literal(false), message: Schema.String }),
])

export type ModelListing = typeof ModelListing.Type

/** A save: done, or the reason main found against the file as it now is (another window may have changed it). */
export const SaveResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({
    ok: Schema.Literal(false),
    problem: Schema.Literals(PROBLEM_KEYS),
    /** The model the problem is about, counted from 0. */
    model: Schema.optional(Schema.Int),
  }),
])

export type SaveResult = typeof SaveResult.Type

/**
 * shiyou: the providers file lives in the desktop's app data, so main reads and writes it. Main also lists an API's
 * models, which a window could not fetch across origins.
 */
export const CustomProviders = Ipc.define({
  id: "custom-providers",
  methods: {
    /** The saved providers, in the order they were added. Rejects when the file cannot be read. */
    list: { output: Schema.Array(CustomProvider) },
    /** Adds a provider, or replaces the saved one with its ID. Rejects when the file cannot be written. */
    save: { input: CustomProvider, output: SaveResult },
    /** Removes the provider with this ID. */
    remove: { input: Schema.String },
    /** Asks the API for its models. */
    models: {
      input: Schema.Struct({ protocol: Protocol, baseURL: Schema.String, apiKey: Schema.String }),
      output: ModelListing,
    },
  },
})
