import { BRAND_NAME } from "./name"

/**
 * Copy whose "OpenCode" means this desktop client, in every locale. Copy about the OpenCode server and CLI it runs
 * (`opencode pair`, "Update OpenCode on this server"), the OpenCode Go, Console and Zen services, and the trademark
 * notice keeps the name, because there it names someone else's software or service.
 */
const APP_KEYS: ReadonlySet<string> = new Set([
  "voice.assistant",
  "dialog.provider.description",
  "provider.connect.chatgptWelcome.description",
  "provider.connect.apiKey.description",
  "dialog.mcp.signIn.description",
  "error.chain.mcpFailed",
  "settings.about.notices.description",
  "project.settings.name.description",
  "project.settings.extensions.empty.mcps.description",
  "project.settings.extensions.empty.plugins.description",
  "project.settings.extensions.empty.skills.description",
  "settings.general.row.language.description",
  "settings.general.row.colorScheme.description",
  "settings.general.row.theme.description",
  "settings.workspaces.empty.description",
  "desktop.microphoneUsage",
  "desktop.documentsFolderUsage",
  "desktop.desktopFolderUsage",
  "desktop.downloadsFolderUsage",
  "desktop.networkVolumesUsage",
  "desktop.removableVolumesUsage",
  "desktop.menu.app",
  "desktop.menu.ariaLabel",
  "desktop.recovery.loadFailed",
  "desktop.recovery.terminated",
  "desktop.recovery.unresponsive",
])

/** Copy that advertises OpenCode's own services, which shiyou turns off (see brand/README.md), is left empty. */
const SERVICE_KEYS: ReadonlySet<string> = new Set(["command.provider.connect.description"])

/** The same, for built-in GUI plugins' catalogs, by plugin id. */
const PLUGIN_KEYS = new Map([
  ["pairing", new Set(["screenActive.description"])],
  ["details", new Set(["setup.mcp", "setup.plugins", "setup.skills"])],
])

const NO_KEYS: ReadonlySet<string> = new Set()

function rebrand<T extends Record<string, string>>(
  messages: T,
  keys: ReadonlySet<string>,
  emptied: ReadonlySet<string> = NO_KEYS,
): { [K in keyof T]: string } {
  // SAFETY: the entries keep every key of `messages` and map each to a string.
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      emptied.has(key) ? "" : keys.has(key) ? value.replaceAll("OpenCode", BRAND_NAME) : value,
    ]),
  ) as { [K in keyof T]: string }
}

/** An app, UI or desktop-native dictionary, in any locale, with the client's own name. */
export function rebrandMessages<T extends Record<string, string>>(messages: T) {
  return rebrand(messages, APP_KEYS, SERVICE_KEYS)
}

/** A built-in GUI plugin's catalog with the client's own name. */
export function rebrandPluginMessages<T extends Record<string, string>>(plugin: string, messages: T) {
  return rebrand(messages, PLUGIN_KEYS.get(plugin) ?? NO_KEYS)
}
