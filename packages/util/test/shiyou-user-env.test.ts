import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { restoreUserXdg } from "../src/shiyou-user-env.js"

const module = pathToFileURL(path.join(import.meta.dir, "../src/global-roots.ts")).href
const root = path.join(os.tmpdir(), "shiyou-server")
const shiyou = {
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_STATE_HOME: path.join(root, "state"),
}

describe("shiyou user XDG", () => {
  test("gives back the user's values and empties the rest", () => {
    const env: Record<string, string | undefined> = {
      ...shiyou,
      PATH: "/bin",
      SHIYOU_USER_XDG: JSON.stringify({ XDG_CONFIG_HOME: "/home/me/dotfiles", XDG_DATA_HOME: null, PATH: "/evil" }),
    }

    restoreUserXdg(env)

    expect(env).toEqual({
      XDG_DATA_HOME: "",
      XDG_CONFIG_HOME: "/home/me/dotfiles",
      XDG_CACHE_HOME: "",
      XDG_STATE_HOME: "",
      PATH: "/bin",
      SHIYOU_USER_XDG: "",
    })
  })

  test("leaves a process without the variable, or with an emptied one, alone", () => {
    const env = { ...shiyou }
    restoreUserXdg(env)
    expect(env).toEqual(shiyou)

    const emptied = { ...shiyou, SHIYOU_USER_XDG: "" }
    restoreUserXdg(emptied)
    expect(emptied).toEqual({ ...shiyou, SHIYOU_USER_XDG: "" })
  })

  test("keeps shiyou's folders when the saved values are unreadable", () => {
    const env: Record<string, string | undefined> = { ...shiyou, SHIYOU_USER_XDG: "not json" }

    restoreUserXdg(env)

    expect(env).toEqual({ ...shiyou, SHIYOU_USER_XDG: "" })
  })

  test("the server's roots use shiyou's folders while its children get the user's", () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `const { roots } = await import(${JSON.stringify(module)});
         const { XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_CACHE_HOME, XDG_STATE_HOME, SHIYOU_USER_XDG } = process.env;
         console.log(JSON.stringify({ roots: roots("opencode"), env: { XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_CACHE_HOME, XDG_STATE_HOME, SHIYOU_USER_XDG } }))`,
      ],
      env: {
        ...process.env,
        ...shiyou,
        SHIYOU_USER_XDG: JSON.stringify({ XDG_CONFIG_HOME: "/home/me/dotfiles", XDG_DATA_HOME: null }),
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const output = JSON.parse(result.stdout.toString())
    expect(output.roots).toMatchObject({
      data: path.join(shiyou.XDG_DATA_HOME, "opencode"),
      config: path.join(shiyou.XDG_CONFIG_HOME, "opencode"),
      cache: path.join(shiyou.XDG_CACHE_HOME, "opencode"),
      state: path.join(shiyou.XDG_STATE_HOME, "opencode"),
    })
    expect(output.env).toEqual({
      XDG_DATA_HOME: "",
      XDG_CONFIG_HOME: "/home/me/dotfiles",
      XDG_CACHE_HOME: "",
      XDG_STATE_HOME: "",
      SHIYOU_USER_XDG: "",
    })
  })
})
