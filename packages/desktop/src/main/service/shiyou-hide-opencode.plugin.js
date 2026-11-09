// shiyou: a plugin for shiyou's bundled server that turns off OpenCode's own services. It removes the OpenCode
// Console sign-in and every provider OpenCode serves: OpenCode Zen with its free models, OpenCode Go, and the
// providers a Console workspace adds. The code behind them stays in place, so upstream syncs stay easy.
//
// The desktop app copies this file into the server's plugins folder each time it starts the server, so edits made
// there are replaced. It imports nothing, so it loads in any server version.

const OPENCODE = new Set(["opencode", "opencode-go"])

/** @param {{ id: string, integrationID?: string }} provider */
const servedByOpenCode = (provider) =>
  OPENCODE.has(provider.id) ||
  provider.id.startsWith("console-") ||
  (provider.integrationID !== undefined && OPENCODE.has(provider.integrationID))

export default {
  id: "shiyou.hide-opencode",
  /** @param {any} ctx */
  setup: async (ctx) => {
    await ctx.integration.transform((/** @type {any} */ editor) => {
      for (const id of OPENCODE) if (editor.get(id)) editor.remove(id)
    })
    await ctx.provider.transform((/** @type {any} */ editor) => {
      for (const record of editor.list()) if (servedByOpenCode(record.provider)) editor.remove(record.provider.id)
    })
  },
}
