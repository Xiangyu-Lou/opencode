import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

// shiyou: its own names and ids, so its app data (userData lives under the app id) never mixes with an installed
// OpenCode desktop app's. Keep in sync with electron-builder.config.ts and script/dev-electron.ts.
const appNames: Record<string, string> = {
  dev: "shiyou Dev",
  beta: "shiyou Beta",
  prod: "shiyou",
}

const appIDs: Record<string, string> = {
  dev: "com.shiyou.desktop.dev",
  beta: "com.shiyou.desktop.beta",
  prod: "com.shiyou.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "shiyou Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "com.shiyou.desktop.dev"
