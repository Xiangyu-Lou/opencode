// shiyou: fork-only. The providers the user adds on the Model providers settings page, and the config document the
// bundled server reads them from.
//
// The desktop starts its server with OPENCODE_CONFIG pointing at `shiyou-providers.json` in the server's own config
// folder (see packages/desktop/src/main/service/shiyou-server.ts). The server loads that file like any other config
// and watches it, so a saved change reaches every open project without a restart. The file is written only by this
// plugin, so it holds exactly what `toConfig` makes and `fromConfig` reads back.

import { Option, Schema } from "effect"

/**
 * The API a provider speaks.
 * - `openai-chat`: OpenAI Chat Completions (`/chat/completions`), what most OpenAI-compatible services offer.
 * - `openai-responses`: OpenAI Responses (`/responses`).
 * - `anthropic`: Anthropic Messages (`/messages`).
 */
export const PROTOCOLS = ["openai-chat", "openai-responses", "anthropic"] as const

export const Protocol = Schema.Literals(PROTOCOLS)

export type Protocol = typeof Protocol.Type

/** How hard a model thinks by default. `off` sends no reasoning settings and offers no thinking variants. */
export const THINKING = ["off", "low", "medium", "high"] as const

export const Thinking = Schema.Literals(THINKING)

export type Thinking = typeof Thinking.Type

/** The levels a thinking model offers in the composer's variant picker. */
const EFFORTS = ["low", "medium", "high"] as const

const Effort = Schema.Literals(EFFORTS)

type Effort = typeof Effort.Type

export const CustomModel = Schema.Struct({
  /** The model ID the API expects, such as `deepseek-chat`. */
  id: Schema.String,
  /** The name the model picker shows. Empty shows the ID. */
  name: Schema.String,
  thinking: Thinking,
  /** Context window in tokens. Undefined uses the server's default. */
  context: Schema.optional(Schema.Int),
  /** Most output tokens per reply. Undefined uses the server's default. */
  output: Schema.optional(Schema.Int),
})

export type CustomModel = typeof CustomModel.Type

export const CustomProvider = Schema.Struct({
  /** The provider ID in model references (`<id>/<model>`). Fixed once saved. */
  id: Schema.String,
  name: Schema.String,
  protocol: Protocol,
  /** The API's base URL, usually ending in `/v1`. */
  baseURL: Schema.String,
  /** Sent as `Authorization: Bearer` (OpenAI) or `x-api-key` (Anthropic). Empty sends none. */
  apiKey: Schema.String,
  models: Schema.Array(CustomModel),
})

export type CustomProvider = typeof CustomProvider.Type

/** The server package for each API. */
export const PACKAGES = {
  "openai-chat": "@opencode/ai/providers/openai-compatible",
  "openai-responses": "@opencode/ai/providers/openai-compatible-responses",
  anthropic: "@opencode/ai/providers/anthropic-compatible",
} as const satisfies Record<Protocol, string>

/** The path each API sends a turn to, after the base URL. */
export const PATHS = {
  "openai-chat": "/chat/completions",
  "openai-responses": "/responses",
  anthropic: "/messages",
} as const satisfies Record<Protocol, string>

// Provider IDs the server keeps for OpenCode's own services, which shiyou turns off.
const RESERVED: readonly string[] = ["opencode", "opencode-go"]

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,62}$/

/** Why a provider cannot be saved, as a key of the plugin's copy. */
export type Problem =
  | { readonly key: "error.name" }
  | { readonly key: "error.id" }
  | { readonly key: "error.id.reserved" }
  | { readonly key: "error.id.taken" }
  | { readonly key: "error.baseURL" }
  | { readonly key: "error.models" }
  | { readonly key: "error.model.id"; readonly model: number }
  | { readonly key: "error.model.duplicate"; readonly model: number }
  | { readonly key: "error.model.limit"; readonly model: number }

/** The keys of `Problem`, which main sends back when the file changed under the window's own check. */
export const PROBLEM_KEYS = [
  "error.name",
  "error.id",
  "error.id.reserved",
  "error.id.taken",
  "error.baseURL",
  "error.models",
  "error.model.id",
  "error.model.duplicate",
  "error.model.limit",
] as const satisfies readonly Problem["key"][]

/** A provider ID made from its name: lower case, with runs of other characters turned into one dash. */
export function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 63)
}

/** The provider as it is saved: trimmed text, and a base URL without trailing slashes. */
export function normalize(provider: CustomProvider): CustomProvider {
  return {
    id: provider.id.trim(),
    name: provider.name.trim(),
    protocol: provider.protocol,
    baseURL: provider.baseURL.trim().replace(/\/+$/, ""),
    apiKey: provider.apiKey.trim(),
    models: provider.models.map((model) => ({
      id: model.id.trim(),
      name: model.name.trim(),
      thinking: model.thinking,
      context: model.context,
      output: model.output,
    })),
  }
}

/**
 * The first reason a normalized provider cannot be saved, or undefined when it can.
 *
 * @param others - The IDs of the other saved providers.
 */
export function validate(provider: CustomProvider, others: readonly string[]): Problem | undefined {
  if (!provider.name) return { key: "error.name" }

  if (!PROVIDER_ID.test(provider.id)) return { key: "error.id" }

  if (RESERVED.includes(provider.id) || provider.id.startsWith("console-")) return { key: "error.id.reserved" }

  if (others.includes(provider.id)) return { key: "error.id.taken" }

  if (!isHttpURL(provider.baseURL)) return { key: "error.baseURL" }

  if (provider.models.length === 0) return { key: "error.models" }

  const seen = new Set<string>()

  for (const [model, item] of provider.models.entries()) {
    // `#` starts a variant in a model reference, and whitespace never reaches an API intact.
    if (!item.id || /[#\s]/.test(item.id)) return { key: "error.model.id", model }

    if (seen.has(item.id)) return { key: "error.model.duplicate", model }

    seen.add(item.id)

    if (!positive(item.context) || !positive(item.output)) return { key: "error.model.limit", model }
  }

  return undefined
}

const positive = (value: number | undefined) => value === undefined || (Number.isSafeInteger(value) && value > 0)

function isHttpURL(value: string) {
  const url = URL.parse(value)

  return url !== null && (url.protocol === "http:" || url.protocol === "https:")
}

// The server's own default output limit for a model without one (Model.Info.default).
const DEFAULT_OUTPUT = 32_000

const BUDGETS = { low: 2_048, medium: 8_192, high: 24_576 } as const satisfies Record<Effort, number>

/** Anthropic thinking budget for an effort: below the output limit, and never under the API's 1024 minimum. */
export function budget(effort: Effort, output = DEFAULT_OUTPUT) {
  return Math.max(1_024, Math.min(BUDGETS[effort], output - 1))
}

// The config document, as far as this plugin writes it. Every other key is the server's to read; none is written.
const ModelSettings = Schema.Struct({
  reasoningEffort: Schema.optional(Effort),
  reasoningSummary: Schema.optional(Schema.Literal("auto")),
  include: Schema.optional(Schema.Array(Schema.String)),
  thinking: Schema.optional(Schema.Struct({ type: Schema.Literal("enabled"), budgetTokens: Schema.Int })),
})

type ModelSettings = typeof ModelSettings.Type

const ModelConfig = Schema.Struct({
  name: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Struct({ context: Schema.optional(Schema.Int), output: Schema.optional(Schema.Int) })),
  capabilities: Schema.Struct({
    reasoning: Schema.Union([
      Schema.Struct({ supported: Schema.Literal(false) }),
      Schema.Struct({ supported: Schema.Literal(true), effort: Schema.Array(Effort) }),
    ]),
  }),
  settings: Schema.optional(ModelSettings),
  variants: Schema.optional(Schema.Array(Schema.Struct({ id: Effort, settings: ModelSettings }))),
})

type ModelConfig = typeof ModelConfig.Type

const ProviderConfig = Schema.Struct({
  name: Schema.String,
  package: Schema.String,
  settings: Schema.Struct({ baseURL: Schema.String, apiKey: Schema.optional(Schema.String) }),
  models: Schema.Record(Schema.String, ModelConfig),
})

/** The providers file: a config document of the server's `providers` format. */
export const ConfigDocument = Schema.Struct({ providers: Schema.Record(Schema.String, ProviderConfig) })

export type ConfigDocument = typeof ConfigDocument.Type

/** Request settings that make a model think at `effort`, spelled for the provider's API. */
function effortSettings(protocol: Protocol, effort: Effort, output: number | undefined): ModelSettings {
  if (protocol === "openai-chat") return { reasoningEffort: effort }

  // As the server spells Responses reasoning: summaries on, and encrypted reasoning kept for the next turn.
  if (protocol === "openai-responses")
    return { reasoningEffort: effort, reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }

  return { thinking: { type: "enabled", budgetTokens: budget(effort, output) } }
}

// Undefined fields are left out when the document is written as JSON.
function modelConfig(protocol: Protocol, model: CustomModel): ModelConfig {
  const thinking = model.thinking === "off" ? undefined : model.thinking
  const limited = model.context !== undefined || model.output !== undefined

  return {
    name: model.name || undefined,
    limit: limited ? { context: model.context, output: model.output } : undefined,
    // OpenAI APIs: the server spells the low/medium/high variants itself. Anthropic: its variants assume Claude, so
    // budgeted variants are spelled here and the server's are turned off. Off: no variants at all.
    capabilities: {
      reasoning:
        thinking === undefined || protocol === "anthropic"
          ? { supported: false }
          : { supported: true, effort: [...EFFORTS] },
    },
    // The model's own settings are the composer's Default variant, so the default effort lives here.
    settings: thinking === undefined ? undefined : effortSettings(protocol, thinking, model.output),
    variants:
      thinking !== undefined && protocol === "anthropic"
        ? EFFORTS.map((effort) => ({ id: effort, settings: effortSettings(protocol, effort, model.output) }))
        : undefined,
  }
}

/** The config document for the saved providers. */
export function toConfig(providers: readonly CustomProvider[]): ConfigDocument {
  return {
    providers: Object.fromEntries(
      providers.map((provider) => [
        provider.id,
        {
          name: provider.name,
          package: PACKAGES[provider.protocol],
          settings: { baseURL: provider.baseURL, apiKey: provider.apiKey || undefined },
          models: Object.fromEntries(provider.models.map((model) => [model.id, modelConfig(provider.protocol, model)])),
        },
      ]),
    ),
  }
}

function readThinking(protocol: Protocol, config: ModelConfig): Thinking {
  if (protocol !== "anthropic") return config.settings?.reasoningEffort ?? "off"

  const tokens = config.settings?.thinking?.budgetTokens

  if (tokens === undefined) return "off"

  return EFFORTS.find((effort) => budget(effort, config.limit?.output) === tokens) ?? "medium"
}

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(ConfigDocument))

/**
 * The providers a providers file holds, from its text. Providers of another package are skipped.
 *
 * @throws When the text is not a providers file, for example after a hand edit broke it.
 */
export function fromConfig(text: string): CustomProvider[] {
  const document = Option.getOrThrowWith(decodeDocument(text), () => new Error("Not a providers file"))

  return Object.entries(document.providers).flatMap(([id, config]) => {
    const protocol = PROTOCOLS.find((item) => PACKAGES[item] === config.package)

    if (!protocol) return []

    return [
      {
        id,
        name: config.name,
        protocol,
        baseURL: config.settings.baseURL,
        apiKey: config.settings.apiKey ?? "",
        models: Object.entries(config.models).map(([modelID, model]) => ({
          id: modelID,
          name: model.name ?? "",
          thinking: readThinking(protocol, model),
          context: model.limit?.context,
          output: model.limit?.output,
        })),
      },
    ]
  })
}

/** The saved list with `provider` added, or replacing the provider of the same ID in place. */
export function upsert(providers: readonly CustomProvider[], provider: CustomProvider) {
  const index = providers.findIndex((item) => item.id === provider.id)

  if (index === -1) return [...providers, provider]

  return providers.map((item, position) => (position === index ? provider : item))
}

/** A request for an API's model list. */
export interface ModelsRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/** The URL that lists the API's models, and the headers it needs. */
export function modelsRequest(input: { protocol: Protocol; baseURL: string; apiKey: string }): ModelsRequest {
  const url = `${input.baseURL.trim().replace(/\/+$/, "")}/models`
  const key = input.apiKey.trim()
  const headers = new Map<string, string>()

  if (input.protocol === "anthropic") headers.set("anthropic-version", "2023-06-01")

  if (key && input.protocol === "anthropic") headers.set("x-api-key", key)

  if (key && input.protocol !== "anthropic") headers.set("authorization", `Bearer ${key}`)

  return { url, headers: Object.fromEntries(headers) }
}

/** A `/models` reply, as OpenAI and Anthropic both answer: `{ data: [{ id }] }`. */
export const ModelsReply = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

export type ModelsReply = typeof ModelsReply.Type

/** The model IDs of a reply, without duplicates, sorted. */
export function modelIDs(reply: ModelsReply): string[] {
  return [...new Set(reply.data.map((item) => item.id).filter((id) => id.length > 0))].toSorted((a, b) =>
    a.localeCompare(b),
  )
}
