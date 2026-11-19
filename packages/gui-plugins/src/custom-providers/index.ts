import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"

/**
 * shiyou: fork-only. A settings page where the user adds model providers with their own API, key, models and
 * thinking levels. Main saves them as a config file the bundled server loads and watches.
 */
export default Plugin.define({
  i18n: builtinCatalog({
    en,
    zh: () => import("./i18n/zh"),
    zht: () => import("./i18n/zht"),
  }),
})
