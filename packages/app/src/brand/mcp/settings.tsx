import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { createMemo, onCleanup, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { createExtensionLoad } from "@/settings/extension-load"
import { readDocument } from "./config"
import { DialogMcpServer } from "./dialog"
import { mcpConfigClient } from "./rpc"

/**
 * shiyou: the MCP servers Settings › Extensions › MCPs can add, edit and remove: those of the server's global
 * configuration file, read through the `shiyou.mcp-config` RPC. A server without that RPC (not shiyou's, or its plugin
 * did not load) keeps the read-only list. The file is read again when the server reloads its configuration, which the
 * agent's edits trigger too.
 */
export function createMcpConfig() {
  const server = useServerSDK()
  const dialog = useDialog()

  const load = createExtensionLoad({
    key: () => server.scope,
    task: (_, signal) => mcpConfigClient(server.api).read(signal),
  })

  onCleanup(server.event.on("config.updated", () => load.invalidate()))
  // The plugin can load after Settings opened, when the server just started.
  onCleanup(server.event.on("plugin.updated", () => load.invalidate()))

  const source = () => {
    const view = load.view()

    return view.status === "ready" ? view.value : undefined
  }

  const servers = createMemo(() => {
    const current = source()
    const document = current && readDocument(current.text)

    return document?.status === "ready" ? document.servers : undefined
  })

  return {
    /** The file can be edited here. */
    available: () => source() !== undefined,
    /** The global configuration file defines `name`, so it can be edited here. */
    configured: (name: string) => servers()?.has(name) ?? false,
    /** Opens the editor for `name`, or for a new server. */
    open: (name?: string) => {
      const current = source()

      if (!current) return
      dialog.show(() => <DialogMcpServer source={current} original={name} onFinished={() => load.invalidate()} />)
    },
  }
}

export type McpConfig = ReturnType<typeof createMcpConfig>

/** "Add server" where the file can be edited, else `fallback`. */
export function McpConfigAdd(props: { config: McpConfig; fallback: JSX.Element }) {
  const language = useLanguage()

  return (
    <Show when={props.config.available()} fallback={props.fallback}>
      <Button size="small" variant="ghost-muted" icon="plus" onClick={() => props.config.open()}>
        {language.t("shiyou.mcp.add")}
      </Button>
    </Show>
  )
}

/** Edit for a server the global configuration file defines. */
export function McpConfigEdit(props: { config: McpConfig; name: string }) {
  const language = useLanguage()

  return (
    <Show when={props.config.configured(props.name)}>
      <IconButton
        size="small"
        variant="ghost-muted"
        icon={<Icon name="edit" size="small" />}
        aria-label={language.t("shiyou.mcp.edit.label", { name: props.name })}
        title={language.t("shiyou.mcp.edit.label", { name: props.name })}
        onClick={() => props.config.open(props.name)}
      />
    </Show>
  )
}
