/**
 * shiyou: the shiyou desktop client starts its bundled server with XDG_* pointed at shiyou's own folders, so the
 * server keeps its sessions, sign-ins, config and cache apart from an installed OpenCode's. It passes the user's own
 * values in SHIYOU_USER_XDG (JSON, null for unset). Once the server has read its roots, this hands the user's values
 * back, so the terminals, shells and tools the server starts keep the user's own folders.
 *
 * Values are emptied, never deleted: terminals start from the process's native environment, which deleting from
 * `process.env` does not reach under Bun, and the XDG spec reads an empty value as unset.
 * Keep in sync with packages/desktop/src/main/service/shiyou-server.ts.
 */

const USER_XDG = "SHIYOU_USER_XDG"

const KEYS = ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const

export function restoreUserXdg(env: Record<string, string | undefined> = process.env) {
  const saved = env[USER_XDG]

  if (!saved) return
  env[USER_XDG] = ""
  const values = parse(saved)

  // Unreadable values keep shiyou's folders: a terminal then misses the user's folders, but nothing reaches OpenCode's.
  if (values === undefined) return

  for (const key of KEYS) {
    const value = values.get(key)

    env[key] = typeof value === "string" ? value : ""
  }
}

function parse(text: string) {
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === "object" && value !== null ? new Map(Object.entries(value)) : undefined
  } catch {
    return undefined
  }
}

const USER_CONFIG = "SHIYOU_USER_CONFIG"

/**
 * shiyou: the desktop also points OPENCODE_CONFIG at the providers file its Model providers settings page writes, and
 * passes the user's own value in SHIYOU_USER_CONFIG (JSON, null for unset). The server reads OPENCODE_CONFIG when it
 * starts, after the XDG roots, so it calls this once it has: the terminals and tools it starts then see the user's
 * value, or an empty one, which OpenCode reads as unset.
 */
export function restoreUserConfig(env: Record<string, string | undefined> = process.env) {
  const saved = env[USER_CONFIG]

  if (!saved) return
  env[USER_CONFIG] = ""
  const value = (() => {
    try {
      return JSON.parse(saved)
    } catch {
      return undefined
    }
  })()

  env.OPENCODE_CONFIG = typeof value === "string" ? value : ""
}
