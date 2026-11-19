import { createSignal, For, Match, Switch, type Accessor } from "solid-js"
import { createLatest, usePlugin, type IpcClient, type Live } from "@opencode/plugin/gui"
import type { CustomProviders } from "./contract"
import { ProviderEditor } from "./editor"
import type { CustomProvider } from "./model"
import type definition from "./index"

export type Client = IpcClient<typeof CustomProviders.spec>

export default function ProvidersPage(props: { providers: Accessor<Live<Client>> }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  // Every save or removal reads the list again, so the page shows what the file now holds.
  const [revision, setRevision] = createSignal(0)
  const reload = () => setRevision((value) => value + 1)

  const client = () => {
    const live = props.providers()

    return live.status === "active" ? live.value : undefined
  }

  const listing = createLatest(
    () => {
      const value = client()

      return value ? { client: value, revision: revision() } : undefined
    },
    (input, signal) => input.client.list({ signal }),
  )

  const providers = () => listing.latest ?? []

  const edit = (provider?: CustomProvider) => {
    const value = client()

    if (!value) return
    ctx.dialogs.open((dialog) => (
      <ProviderEditor
        client={value}
        provider={provider}
        taken={providers()
          .map((item) => item.id)
          .filter((id) => id !== provider?.id)}
        onSaved={() => {
          reload()
          ctx.toast.show({ title: ctx.t("saved"), variant: "success" })
        }}
        close={dialog.close}
      />
    ))
  }

  const remove = async (provider: CustomProvider) => {
    const value = client()

    if (!value) return

    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("remove", { name: provider.name }),
      description: ctx.t("remove.confirm", { name: provider.name }),
      confirm: ctx.t("remove.action"),
      danger: true,
    })

    if (!confirmed || ctx.signal.aborted) return
    await value
      .remove(provider.id, { signal: ctx.signal })
      .then(reload, () => ctx.toast.show({ title: ctx.t("save.error"), variant: "error" }))
  }

  const summary = (provider: CustomProvider) =>
    [
      ctx.t(`protocol.${provider.protocol}`),
      provider.baseURL,
      ctx.plural("summary.models", provider.models.length),
    ].join(" · ")

  return (
    <ui.SettingsLayout
      title={ctx.t("title")}
      description={ctx.t("description")}
      actions={
        <ui.Button icon="plus" disabled={!client()} onClick={() => edit()}>
          {ctx.t("add")}
        </ui.Button>
      }
    >
      <ui.SettingsSection footer={<p class="text-12-regular text-v2-text-text-muted px-1 pt-2">{ctx.t("storage")}</p>}>
        <Switch>
          <Match when={props.providers().status === "inactive"}>
            <ui.SettingsRow id="custom-providers" title={ctx.t("unavailable")} />
          </Match>
          <Match when={listing.error !== undefined}>
            <ui.SettingsRow id="custom-providers" title={ctx.t("load.error")}>
              <ui.Button size="small" icon="refresh" onClick={reload}>
                {ctx.t("retry")}
              </ui.Button>
            </ui.SettingsRow>
          </Match>
          <Match when={listing.latest === undefined}>
            <ui.SettingsRow id="custom-providers" title={ctx.t("loading")} />
          </Match>
          <Match when={providers().length === 0}>
            <ui.SettingsRow id="custom-providers" title={ctx.t("empty")} />
          </Match>
          <Match when={true}>
            <For each={providers()}>
              {(provider, index) => (
                <ui.SettingsRow
                  id={index() === 0 ? "custom-providers" : undefined}
                  title={
                    <span>
                      {provider.name} <span class="text-v2-text-text-faint">({provider.id})</span>
                    </span>
                  }
                  description={summary(provider)}
                >
                  <div class="flex items-center gap-1">
                    <ui.Button size="small" icon="edit" onClick={() => edit(provider)}>
                      {ctx.t("edit")}
                    </ui.Button>
                    <ui.IconButton
                      icon="trash"
                      size="small"
                      label={ctx.t("remove", { name: provider.name })}
                      onClick={() => void remove(provider)}
                    />
                  </div>
                </ui.SettingsRow>
              )}
            </For>
          </Match>
        </Switch>
      </ui.SettingsSection>
    </ui.SettingsLayout>
  )
}
