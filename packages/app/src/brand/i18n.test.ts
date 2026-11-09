import { describe, expect, test } from "bun:test"
import { rebrandMessages, rebrandPluginMessages } from "./i18n"

describe("brand i18n", () => {
  test("names the client shiyou only in copy about the client", () => {
    expect(
      rebrandMessages({
        "settings.general.row.language.description": "Change the display language for OpenCode",
        "usage.section.go": "OpenCode Go",
      }),
    ).toEqual({
      "settings.general.row.language.description": "Change the display language for shiyou",
      "usage.section.go": "OpenCode Go",
    })
  })

  test("empties copy that advertises OpenCode's own services", () => {
    expect(
      rebrandMessages({
        "command.provider.connect.description": "Sign in to OpenCode Go, OpenCode Console, or another",
      }),
    ).toEqual({ "command.provider.connect.description": "" })
  })

  test("leaves plugin catalogs it has no keys for alone", () => {
    expect(rebrandPluginMessages("unknown", { title: "OpenCode" })).toEqual({ title: "OpenCode" })
  })
})
