import { describe, expect, test } from "bun:test"
import path from "node:path"
import { serverEnv, serverPort, serverRoot, serviceFile } from "./shiyou-server"

const userData = path.join("/apps", "com.shiyou.desktop")

const root = path.join(userData, "server")

describe("shiyou server", () => {
  test("keeps every root under shiyou's app data", () => {
    expect(serverRoot(userData)).toBe(root)
    expect(serverEnv(userData, {})).toMatchObject({
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
    })
  })

  test("passes the user's own XDG values, null where unset", () => {
    const env = serverEnv(userData, { XDG_CONFIG_HOME: "/home/me/dotfiles", XDG_DATA_HOME: "", PATH: "/bin" })

    expect(JSON.parse(env.SHIYOU_USER_XDG)).toEqual({
      XDG_DATA_HOME: "",
      XDG_CONFIG_HOME: "/home/me/dotfiles",
      XDG_CACHE_HOME: null,
      XDG_STATE_HOME: null,
    })
  })

  test("registers where the CLI writes under its state root", () => {
    expect(serviceFile(userData, undefined)).toBe(path.join(root, "state", "opencode", "service.json"))
    expect(serviceFile(userData, "local")).toBe(path.join(root, "state", "opencode", "service-local.json"))
  })

  test("gives each channel its own port, apart from OpenCode's", () => {
    const ports = ["com.shiyou.desktop", "com.shiyou.desktop.beta", "com.shiyou.desktop.dev"].map(serverPort)

    expect(new Set(ports).size).toBe(3)

    for (const port of ports) {
      expect([0xc0de, 0xc0df, 0x70de, 0x70df]).not.toContain(port)
      expect(port).toBeLessThan(0x8000)
    }

    expect(serverPort("unknown")).toBe(serverPort("com.shiyou.desktop.dev"))
  })
})
