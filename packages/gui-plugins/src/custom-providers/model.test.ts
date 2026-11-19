import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import {
  budget,
  fromConfig,
  modelIDs,
  ModelsReply,
  modelsRequest,
  normalize,
  slug,
  toConfig,
  upsert,
  validate,
  type CustomProvider,
  type Problem,
} from "./model"

const chat: CustomProvider = {
  id: "gateway",
  name: "Company gateway",
  protocol: "openai-chat",
  baseURL: "https://llm.example.com/v1",
  apiKey: "sk-chat",
  models: [
    { id: "qwen3-coder", name: "Qwen3 Coder", thinking: "off" },
    { id: "deepseek-r1", name: "", thinking: "high", context: 128_000 },
  ],
}

const anthropic: CustomProvider = {
  id: "claude-proxy",
  name: "Claude proxy",
  protocol: "anthropic",
  baseURL: "https://proxy.example.com/v1",
  apiKey: "",
  models: [{ id: "glm-4.6", name: "GLM", thinking: "medium", output: 16_000 }],
}

describe("custom providers config", () => {
  test("OpenAI models carry the default effort and let the server spell the variants", () => {
    const config = toConfig([chat])

    expect(config).toEqual({
      providers: {
        gateway: {
          name: "Company gateway",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: "https://llm.example.com/v1", apiKey: "sk-chat" },
          models: {
            "qwen3-coder": { name: "Qwen3 Coder", capabilities: { reasoning: { supported: false } } },
            "deepseek-r1": {
              limit: { context: 128_000 },
              capabilities: { reasoning: { supported: true, effort: ["low", "medium", "high"] } },
              settings: { reasoningEffort: "high" },
            },
          },
        },
      },
    })
  })

  test("Responses models keep encrypted reasoning and summaries, as the server spells them", () => {
    const config = toConfig([{ ...chat, protocol: "openai-responses", models: [chat.models[1]!] }])

    expect(config.providers).toMatchObject({
      gateway: {
        package: "@opencode/ai/providers/openai-compatible-responses",
        models: {
          "deepseek-r1": {
            settings: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
          },
        },
      },
    })
  })

  test("Anthropic models get budgeted variants under their output limit and no key when none is set", () => {
    expect(toConfig([anthropic])).toEqual({
      providers: {
        "claude-proxy": {
          name: "Claude proxy",
          package: "@opencode/ai/providers/anthropic-compatible",
          settings: { baseURL: "https://proxy.example.com/v1" },
          models: {
            "glm-4.6": {
              name: "GLM",
              limit: { output: 16_000 },
              capabilities: { reasoning: { supported: false } },
              settings: { thinking: { type: "enabled", budgetTokens: 8_192 } },
              variants: [
                { id: "low", settings: { thinking: { type: "enabled", budgetTokens: 2_048 } } },
                { id: "medium", settings: { thinking: { type: "enabled", budgetTokens: 8_192 } } },
                { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 15_999 } } },
              ],
            },
          },
        },
      },
    })
  })

  test("budgets stay above the API minimum and below the output limit", () => {
    expect(budget("high")).toBe(24_576)
    expect(budget("high", 10_000)).toBe(9_999)
    expect(budget("low", 1_000)).toBe(1_024)
  })

  test("reads back every provider it writes", () => {
    const providers = [
      chat,
      anthropic,
      { ...anthropic, id: "a2", models: [{ ...anthropic.models[0]!, thinking: "high" as const }] },
    ]

    // An empty name or key is written as none and read back empty.
    expect(fromConfig(JSON.stringify(toConfig(providers)))).toEqual(providers)
  })

  test("writes no empty or undefined fields", () => {
    const text = JSON.stringify(toConfig([anthropic]))

    expect(text).not.toContain("apiKey")
    expect(text).not.toContain("null")
    expect(JSON.parse(text).providers["claude-proxy"].models["glm-4.6"].limit).toEqual({ output: 16_000 })
  })

  test("skips providers of another package and rejects a file that is not a providers file", () => {
    expect(
      fromConfig(
        JSON.stringify({
          providers: { other: { name: "x", package: "@ai-sdk/other", settings: { baseURL: "" }, models: {} } },
        }),
      ),
    ).toEqual([])
    expect(() => fromConfig("{")).toThrow()
    expect(() => fromConfig(JSON.stringify({ providers: { x: { package: 1 } } }))).toThrow()
  })
})

describe("custom providers validation", () => {
  test("accepts a complete provider", () => {
    expect(validate(normalize(chat), [])).toBeUndefined()
  })

  test("normalizes text and the base URL", () => {
    expect(
      normalize({
        ...chat,
        name: " Gateway ",
        baseURL: " https://llm.example.com/v1/// ",
        models: [{ id: " m ", name: " M ", thinking: "low" }],
      }),
    ).toMatchObject({ name: "Gateway", baseURL: "https://llm.example.com/v1", models: [{ id: "m", name: "M" }] })
  })

  test.each<[CustomProvider, Problem]>([
    [{ ...chat, name: "" }, { key: "error.name" }],
    [{ ...chat, id: "Gate Way" }, { key: "error.id" }],
    [{ ...chat, id: "opencode" }, { key: "error.id.reserved" }],
    [{ ...chat, id: "console-acme" }, { key: "error.id.reserved" }],
    [{ ...chat, baseURL: "llm.example.com" }, { key: "error.baseURL" }],
    [{ ...chat, baseURL: "file:///etc" }, { key: "error.baseURL" }],
    [{ ...chat, models: [] }, { key: "error.models" }],
    [
      { ...chat, models: [{ id: "a#b", name: "", thinking: "off" as const }] },
      { key: "error.model.id", model: 0 },
    ],
    [
      { ...chat, models: [chat.models[0]!, { ...chat.models[0]!, name: "again" }] },
      { key: "error.model.duplicate", model: 1 },
    ],
    [
      { ...chat, models: [{ ...chat.models[0]!, context: 0 }] },
      { key: "error.model.limit", model: 0 },
    ],
  ])("rejects %#", (provider, problem) => {
    expect(validate(provider, [])).toEqual(problem)
  })

  test("rejects an ID another provider has", () => {
    expect(validate(chat, ["gateway"])).toEqual({ key: "error.id.taken" })
  })

  test("makes an ID from a name", () => {
    expect(slug("My Company API!")).toBe("my-company-api")
    expect(slug("识油 网关")).toBe("")
  })

  test("upsert replaces in place and appends new providers", () => {
    expect(upsert([chat, anthropic], { ...chat, name: "Renamed" }).map((item) => item.name)).toEqual([
      "Renamed",
      "Claude proxy",
    ])
    expect(upsert([chat], anthropic).map((item) => item.id)).toEqual(["gateway", "claude-proxy"])
  })
})

describe("model listing", () => {
  test("asks each API with its own headers", () => {
    expect(modelsRequest({ protocol: "openai-chat", baseURL: "https://a.example/v1/", apiKey: "k" })).toEqual({
      url: "https://a.example/v1/models",
      headers: { authorization: "Bearer k" },
    })
    expect(modelsRequest({ protocol: "anthropic", baseURL: "https://b.example/v1", apiKey: "" })).toEqual({
      url: "https://b.example/v1/models",
      headers: { "anthropic-version": "2023-06-01" },
    })
  })

  test("reads model IDs from a listing", () => {
    const decode = Schema.decodeUnknownOption(ModelsReply)
    const reply = decode({ object: "list", data: [{ id: "b", owned_by: "x" }, { id: "a" }, { id: "b" }, { id: "" }] })

    expect(Option.map(reply, modelIDs)).toEqual(Option.some(["a", "b"]))
    expect(Option.isNone(decode({ models: [] }))).toBe(true)
  })
})
