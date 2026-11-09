import { describe, expect, test } from "bun:test"
import plugin from "./shiyou-hide-opencode.plugin.js"

type Provider = { id: string; integrationID?: string }

type IntegrationEditor = { get(id: string): { id: string } | undefined; remove(id: string): void }

type ProviderEditor = { list(): { provider: Provider }[]; remove(id: string): void }

function run(integrations: string[], providers: Provider[]) {
  const listed = new Set(integrations)
  const catalog = new Map(providers.map((provider) => [provider.id, provider]))

  const ctx = {
    integration: {
      transform: async (callback: (editor: IntegrationEditor) => void) =>
        callback({
          get: (id: string) => (listed.has(id) ? { id } : undefined),
          remove: (id: string) => listed.delete(id),
        }),
    },
    provider: {
      transform: async (callback: (editor: ProviderEditor) => void) =>
        callback({
          list: () => [...catalog.values()].map((provider) => ({ provider })),
          remove: (id: string) => catalog.delete(id),
        }),
    },
  }

  return plugin.setup(ctx).then(() => ({ integrations: [...listed], providers: [...catalog.keys()] }))
}

describe("shiyou hide-OpenCode plugin", () => {
  test("removes the OpenCode sign-ins and every provider OpenCode serves", async () => {
    const result = await run(
      ["opencode", "opencode-go", "anthropic", "github-copilot"],
      [
        { id: "opencode", integrationID: "opencode" },
        { id: "opencode-go", integrationID: "opencode" },
        { id: "console-acme", integrationID: "opencode" },
        { id: "workspace-models", integrationID: "opencode" },
        { id: "anthropic", integrationID: "anthropic" },
        { id: "openrouter" },
      ],
    )

    expect(result).toEqual({ integrations: ["anthropic", "github-copilot"], providers: ["anthropic", "openrouter"] })
  })

  test("leaves a catalog without OpenCode services alone", async () => {
    const result = await run(["openai"], [{ id: "openai", integrationID: "openai" }])

    expect(result).toEqual({ integrations: ["openai"], providers: ["openai"] })
  })
})
