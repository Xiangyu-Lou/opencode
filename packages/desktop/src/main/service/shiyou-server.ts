import path from "node:path"

/**
 * shiyou: where the bundled server keeps its files, and the port it listens on.
 *
 * An installed OpenCode keeps its server's sessions, sign-ins, config, cache and registration under
 * ~/.local/share/opencode, ~/.config/opencode, ~/.cache/opencode and ~/.local/state/opencode, and listens on 0xC0DE.
 * shiyou's server keeps them under shiyou's own app data and listens on a port of its own, so shiyou never reads
 * OpenCode's sessions, and never adopts, restarts or replaces an OpenCode server.
 */

const ROOTS = [
  ["XDG_DATA_HOME", "data"],
  ["XDG_CONFIG_HOME", "config"],
  ["XDG_CACHE_HOME", "cache"],
  ["XDG_STATE_HOME", "state"],
] as const

// The user's own XDG values, which the server gives back to the terminals and tools it starts.
// Keep in sync with packages/util/src/shiyou-user-env.ts.
const USER_XDG = "SHIYOU_USER_XDG"

// Below 0x8000, which Windows hands out and reserves in blocks, and apart from OpenCode's 0xC0DE and 0xC0DF
// (0x70DE and 0x70DF on Windows). Each channel runs its own server, so each has its own port.
const PORTS = new Map([
  ["com.shiyou.desktop", 0x51c0],
  ["com.shiyou.desktop.beta", 0x51c1],
  ["com.shiyou.desktop.dev", 0x51c2],
])

/** The folder that holds the server's files, inside shiyou's app data. */
export function serverRoot(userData: string) {
  return path.join(userData, "server")
}

/** The variables the server starts with: its own XDG roots, and the user's values to hand back. */
export function serverEnv(userData: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const root = serverRoot(userData)

  return {
    ...Object.fromEntries(ROOTS.map(([key, folder]) => [key, path.join(root, folder)])),
    [USER_XDG]: JSON.stringify(Object.fromEntries(ROOTS.map(([key]) => [key, env[key] ?? null]))),
  }
}

/**
 * Where the server registers itself: the CLI writes `opencode/service.json`, or `opencode/service-local.json` for a
 * local CLI, under its state root.
 */
export function serviceFile(userData: string, channel = process.env.OPENCODE_DESKTOP_SERVER_CHANNEL) {
  return path.join(
    serverRoot(userData),
    "state",
    "opencode",
    channel === "local" ? "service-local.json" : "service.json",
  )
}

/** The fixed port for an app id; an unknown id gets the dev port. */
export function serverPort(appID: string) {
  return PORTS.get(appID) ?? 0x51c2
}

/** Where the plugin that turns off OpenCode's own services lives: the plugins folder of the server's global config. */
export function hideOpenCodePluginFile(userData: string) {
  return path.join(serverRoot(userData), "config", "opencode", "plugins", "shiyou-hide-opencode.js")
}
