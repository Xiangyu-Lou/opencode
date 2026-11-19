import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { usePlugin } from "@opencode/plugin/gui"
import { uuid } from "@opencode/util/uuid"
import type { Client } from "./page"
import type { ModelListing } from "./contract"
import {
  isLevel,
  LEVELS,
  normalize,
  PATHS,
  PROTOCOLS,
  slug,
  validate,
  type CustomProvider,
  type Problem,
  type Protocol,
  type Thinking,
} from "./model"
import type definition from "./index"

/** The thinking choices of a model row. `custom` takes the level typed beside it. */
const CHOICES = ["model", "off", ...LEVELS, "custom"] as const

type Choice = (typeof CHOICES)[number]

/** A model row while it is edited: token limits and a typed level stay text until the form is saved. */
type ModelDraft = {
  key: string
  id: string
  name: string
  thinking: Choice
  /** The level typed for `custom`. */
  level: string
  context: string
  output: string
}

type Draft = {
  name: string
  id: string
  /** The user typed the ID, so it no longer follows the name. */
  idEdited: boolean
  protocol: Protocol
  baseURL: string
  apiKey: string
  models: ModelDraft[]
}

// A new model follows the model's own thinking until the user sets a level.
const emptyModel = (id = ""): ModelDraft => ({
  key: uuid(),
  id,
  name: "",
  thinking: "model",
  level: "",
  context: "",
  output: "",
})

function choiceOf(thinking: Thinking): Pick<ModelDraft, "thinking" | "level"> {
  if (thinking.type !== "level") return { thinking: thinking.type, level: "" }

  return isLevel(thinking.level)
    ? { thinking: thinking.level, level: "" }
    : { thinking: "custom", level: thinking.level }
}

function thinkingOf(model: ModelDraft): Thinking {
  if (model.thinking === "model" || model.thinking === "off") return { type: model.thinking }

  return { type: "level", level: model.thinking === "custom" ? model.level : model.thinking }
}

function draftOf(provider: CustomProvider | undefined): Draft {
  if (!provider)
    return {
      name: "",
      id: "",
      idEdited: false,
      protocol: "openai-chat",
      baseURL: "",
      apiKey: "",
      models: [emptyModel()],
    }

  return {
    name: provider.name,
    id: provider.id,
    idEdited: true,
    protocol: provider.protocol,
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    models: provider.models.map((model) => ({
      key: uuid(),
      id: model.id,
      name: model.name,
      ...choiceOf(model.thinking),
      context: model.context === undefined ? "" : String(model.context),
      output: model.output === undefined ? "" : String(model.output),
    })),
  }
}

// Empty is "use the server's default"; anything else must be a whole number, which `validate` checks.
const tokens = (value: string) => (value.trim() === "" ? undefined : Number(value.trim()))

function providerOf(draft: Draft): CustomProvider {
  return normalize({
    id: draft.id,
    name: draft.name,
    protocol: draft.protocol,
    baseURL: draft.baseURL,
    apiKey: draft.apiKey,
    // A row left completely empty is not a model.
    models: draft.models.flatMap((model) =>
      model.id.trim() || model.name.trim() || model.context.trim() || model.output.trim()
        ? [
            {
              id: model.id,
              name: model.name,
              thinking: thinkingOf(model),
              context: tokens(model.context),
              output: tokens(model.output),
            },
          ]
        : [],
    ),
  })
}

type Listing =
  | { readonly type: "idle" }
  | { readonly type: "busy" }
  | { readonly type: "listed"; readonly models: readonly string[] }
  | { readonly type: "failed"; readonly message: string }

export function ProviderEditor(props: {
  client: Client
  /** The provider to edit; undefined adds one. */
  provider?: CustomProvider
  /** IDs other providers use. */
  taken: readonly string[]
  onSaved: () => void
  close: () => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const editing = props.provider !== undefined
  const [draft, setDraft] = createStore<Draft>(draftOf(props.provider))
  // Problems show once the user tries to save, then follow every edit.
  const [attempted, setAttempted] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string>()
  const [listing, setListing] = createSignal<Listing>({ type: "idle" })

  const problem = createMemo(() => validate(providerOf(draft), props.taken))

  const message = (value: Problem) =>
    "model" in value ? ctx.t(value.key, { index: value.model + 1 }) : ctx.t(value.key)

  const shown = () => {
    const value = problem()

    return attempted() && value ? message(value) : saveError()
  }

  const invalid = (...keys: Problem["key"][]) => {
    const value = problem()

    return attempted() && value !== undefined && keys.includes(value.key)
  }

  const modelInvalid = (index: number, ...keys: Problem["key"][]) => {
    const value = problem()

    return attempted() && value !== undefined && "model" in value && value.model === index && keys.includes(value.key)
  }

  const setName = (name: string) =>
    setDraft(
      produce((value) => {
        value.name = name

        if (!value.idEdited && !editing) value.id = slug(name)
      }),
    )

  const setModel = <K extends keyof ModelDraft>(key: string, field: K, value: ModelDraft[K]) =>
    setDraft("models", (model) => model.key === key, field, value)

  const addModels = (ids: readonly string[]) =>
    setDraft(
      produce((value) => {
        // A lone empty row is a placeholder: listed models replace it.
        const blank = value.models.length === 1 && !value.models[0]!.id.trim()
        const kept = blank ? [] : value.models
        const present = new Set(kept.map((model) => model.id.trim()))
        value.models = [...kept, ...ids.flatMap((id) => (present.has(id) ? [] : [emptyModel(id)]))]
      }),
    )

  const listed = () => {
    const value = listing()

    return value.type === "listed" ? value.models : undefined
  }

  const listFailure = () => {
    const value = listing()

    return value.type === "failed" ? value.message : undefined
  }

  const fetchModels = async () => {
    setListing({ type: "busy" })

    // Main answers every listing; a rejection means main itself is gone.
    const result = await props.client
      .models({ protocol: draft.protocol, baseURL: draft.baseURL, apiKey: draft.apiKey }, { signal: ctx.signal })
      .catch((): ModelListing => ({ ok: false, message: ctx.t("unavailable") }))

    if (ctx.signal.aborted) return
    setListing(result.ok ? { type: "listed", models: result.models } : { type: "failed", message: result.message })
  }

  const pickListed = async (models: readonly string[]) => {
    const present = new Set(draft.models.map((model) => model.id.trim()))

    const picked = await ctx.dialogs.select({
      title: ctx.t("model.fetch.pick"),
      options: models.flatMap((id) => (present.has(id) ? [] : [{ title: id, value: id }])),
    })

    if (picked !== undefined && !ctx.signal.aborted) addModels([picked])
  }

  const save = async () => {
    setAttempted(true)
    setSaveError(undefined)

    if (problem()) return
    setSaving(true)

    // Main checks the provider again against the file as it now is, in case another window changed it.
    const result = await props.client.save(providerOf(draft), { signal: ctx.signal }).catch((): undefined => undefined)

    if (ctx.signal.aborted) return

    setSaving(false)

    if (result === undefined) return void setSaveError(ctx.t("save.error"))

    if (!result.ok) return void setSaveError(ctx.t(result.problem, { index: (result.model ?? 0) + 1 }))

    props.onSaved()
    props.close()
  }

  const protocolOptions = () => PROTOCOLS.map((value) => ({ value, label: ctx.t(`protocol.${value}`) }))
  const thinkingOptions = () => CHOICES.map((value) => ({ value, label: ctx.t(`thinking.${value}`) }))
  const exampleRef = () => `${draft.id || "my-api"}/${draft.models[0]?.id.trim() || "model"}`

  const exampleURL = () => {
    const base = draft.baseURL.trim().replace(/\/+$/, "") || "https://api.example.com/v1"

    return `${base}${PATHS[draft.protocol]}`
  }

  const label = "text-12-medium text-v2-text-text-base"
  const hint = "text-12-regular text-v2-text-text-muted"
  // The app's fields are 280px wide on their own; here each one fills its cell.
  const field = "w-full min-w-0"
  // Selects are 24px tall and fields 28px: a 28px box keeps them on one line.
  const line = "flex h-7 min-w-0 items-center"

  const columns =
    "grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(8.5rem,0.8fr)_6.5rem_6.5rem_1.75rem] items-start gap-2"

  return (
    <ui.Dialog
      title={editing ? ctx.t("dialog.edit", { name: props.provider?.name ?? "" }) : ctx.t("dialog.add")}
      size="x-large"
      footer={
        <div class="flex items-center gap-2">
          <ui.Button onClick={props.close}>{ctx.t("cancel")}</ui.Button>
          <ui.Button variant="contrast" busy={saving()} onClick={() => void save()}>
            {ctx.t("save")}
          </ui.Button>
        </div>
      }
    >
      <form
        class="flex w-full min-w-0 flex-col gap-5 pb-2"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div class="grid grid-cols-2 gap-4">
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class={label}>{ctx.t("field.name")}</span>
            <ui.TextInput
              label={ctx.t("field.name")}
              value={draft.name}
              onInput={setName}
              placeholder={ctx.t("field.name.placeholder")}
              invalid={invalid("error.name")}
              class={field}
              autofocus={!editing}
            />
          </label>
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class={label}>{ctx.t("field.id")}</span>
            <ui.TextInput
              label={ctx.t("field.id")}
              value={draft.id}
              onInput={(value) => setDraft({ id: value, idEdited: true })}
              placeholder="my-api"
              disabled={editing}
              class={field}
              invalid={invalid("error.id", "error.id.reserved", "error.id.taken")}
            />
            <span class={hint}>{ctx.t("field.id.hint", { example: exampleRef() })}</span>
          </label>
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class={label}>{ctx.t("field.protocol")}</span>
            <div class={line}>
              <ui.Select
                label={ctx.t("field.protocol")}
                options={protocolOptions()}
                value={draft.protocol}
                onChange={(value) => {
                  setDraft({ protocol: value })
                  setListing({ type: "idle" })
                }}
                placement="bottom-start"
              />
            </div>
          </label>
          <label class="flex min-w-0 flex-col gap-1.5">
            <span class={label}>{ctx.t("field.apiKey")}</span>
            <ui.TextInput
              label={ctx.t("field.apiKey")}
              type="password"
              value={draft.apiKey}
              onInput={(value) => setDraft({ apiKey: value })}
              placeholder={ctx.t("field.apiKey.placeholder")}
              class={field}
            />
          </label>
          <label class="col-span-2 flex min-w-0 flex-col gap-1.5">
            <span class={label}>{ctx.t("field.baseURL")}</span>
            <ui.TextInput
              label={ctx.t("field.baseURL")}
              type="url"
              value={draft.baseURL}
              onInput={(value) => setDraft({ baseURL: value })}
              placeholder="https://api.example.com/v1"
              invalid={invalid("error.baseURL")}
              class={field}
            />
            <span class={hint}>{ctx.t("field.baseURL.hint", { example: exampleURL() })}</span>
          </label>
        </div>

        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class={label}>{ctx.t("field.models")}</span>
            <div class="flex items-center gap-2">
              <ui.Button
                size="small"
                icon="download"
                busy={listing().type === "busy"}
                disabled={!draft.baseURL.trim()}
                onClick={() => void fetchModels()}
              >
                {ctx.t("model.fetch")}
              </ui.Button>
              <ui.Button
                size="small"
                icon="plus"
                onClick={() => setDraft("models", (models) => [...models, emptyModel()])}
              >
                {ctx.t("model.add")}
              </ui.Button>
            </div>
          </div>
          <Show when={listed()}>
            {(models) => (
              <div class="flex items-center gap-2" role="status" aria-live="polite">
                <span class={hint}>{ctx.plural("model.fetch.count", models().length)}</span>
                <ui.Button size="small" variant="ghost" icon="plus" onClick={() => void pickListed(models())}>
                  {ctx.t("model.fetch.pick")}
                </ui.Button>
              </div>
            )}
          </Show>
          <Show when={listFailure()}>
            {(text) => (
              <span class="text-12-regular text-v2-state-fg-danger" role="alert">
                {ctx.t("model.fetch.error", { message: text() })}
              </span>
            )}
          </Show>

          <div class={`${columns} ${hint}`}>
            <span>{ctx.t("field.model.id")}</span>
            <span>{ctx.t("field.model.name")}</span>
            <span>{ctx.t("field.model.thinking")}</span>
            <span>{ctx.t("field.model.context")}</span>
            <span>{ctx.t("field.model.output")}</span>
            <span />
          </div>
          <For each={draft.models}>
            {(model, index) => (
              <div class={columns}>
                <ui.TextInput
                  label={ctx.t("field.model.id")}
                  value={model.id}
                  onInput={(value) => setModel(model.key, "id", value)}
                  placeholder="model-id"
                  invalid={modelInvalid(index(), "error.model.id", "error.model.duplicate")}
                  class={field}
                />
                <ui.TextInput
                  label={ctx.t("field.model.name")}
                  value={model.name}
                  onInput={(value) => setModel(model.key, "name", value)}
                  placeholder={ctx.t("field.model.name.placeholder")}
                  class={field}
                />
                <div class="flex min-w-0 flex-col gap-1">
                  <div class={line}>
                    <ui.Select
                      label={ctx.t("field.model.thinking")}
                      options={thinkingOptions()}
                      value={model.thinking}
                      onChange={(value) => setModel(model.key, "thinking", value)}
                      placement="bottom-start"
                    />
                  </div>
                  <Show when={model.thinking === "custom"}>
                    <ui.TextInput
                      label={ctx.t("field.model.level")}
                      value={model.level}
                      onInput={(value) => setModel(model.key, "level", value)}
                      placeholder={ctx.t(
                        draft.protocol === "anthropic" ? "thinking.custom.budget" : "thinking.custom.effort",
                      )}
                      invalid={modelInvalid(index(), "error.model.effort", "error.model.budget")}
                      class={field}
                    />
                  </Show>
                </div>
                <ui.TextInput
                  label={ctx.t("field.model.context")}
                  value={model.context}
                  onInput={(value) => setModel(model.key, "context", value)}
                  placeholder={ctx.t("field.model.default")}
                  invalid={modelInvalid(index(), "error.model.limit")}
                  class={field}
                />
                <ui.TextInput
                  label={ctx.t("field.model.output")}
                  value={model.output}
                  onInput={(value) => setModel(model.key, "output", value)}
                  placeholder={ctx.t("field.model.default")}
                  invalid={modelInvalid(index(), "error.model.limit", "error.model.budget")}
                  class={field}
                />
                <div class={line}>
                  <ui.IconButton
                    icon="trash"
                    size="small"
                    label={ctx.t("field.model.remove", { name: model.id || String(index() + 1) })}
                    onClick={() => setDraft("models", (models) => models.filter((item) => item.key !== model.key))}
                  />
                </div>
              </div>
            )}
          </For>
          <span class={hint}>{ctx.t("thinking.hint")}</span>
        </div>

        <Show when={shown()}>
          {(text) => (
            <span class="text-12-regular text-v2-state-fg-danger" role="alert">
              {text()}
            </span>
          )}
        </Show>
        {/* Enter in a field submits the form. */}
        <button type="submit" hidden />
      </form>
    </ui.Dialog>
  )
}
