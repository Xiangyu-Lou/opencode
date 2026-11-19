import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { CustomProviders } from "./contract"
import type definition from "./index"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // The providers file lives in the desktop's app data; the web has no main process to write it.
  if (!ctx.desktop) return
  const providers = ctx.use(CustomProviders)
  const layout = ctx.layout
  const Page = lazy(() => import("./page"))
  // Load the page while idle so opening settings never shows a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "custom-providers",
    icon: "providers",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        {
          id: "custom-providers",
          title: ctx.t("title"),
          description: ctx.t("description"),
          keywords: "provider api key model base url endpoint openai anthropic thinking reasoning 提供商 模型 密钥",
        },
      ]
    },
    render: () => (
      <Suspense>
        <Page providers={providers} />
      </Suspense>
    ),
  })

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.category"),
    run: () => layout.settings("custom-providers"),
  }))
}

export default setup
