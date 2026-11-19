import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Divider } from "@opencode/ui/divider"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import type { McpDraftErrors, McpDraftField } from "./config"
import {
  createMcpEditorState,
  mcpEditorView,
  transitionMcpEditor,
  type McpEditorEffect,
  type McpEditorEvent,
  type McpEditorFailure,
  type McpEditorState,
  type McpEditorView,
} from "./machine"
import { mcpConfigClient, type McpConfigSource } from "./rpc"
import "@/settings/settings.css"
import "./dialog.css"

/**
 * shiyou: adds, edits or removes one MCP server in the server's global configuration file. `source` is the file as
 * Settings last read it; a write over a newer file is applied again to it (see machine.ts).
 */
export function DialogMcpServer(props: { source: McpConfigSource; original?: string; onFinished: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const client = mcpConfigClient(useServerSDK().api)
  const initial = createMcpEditorState(props.source, props.original)
  const [editor, setEditor] = createSignal<McpEditorState>(initial)
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  // A finished editor keeps showing its last view while the dialog closes.
  const view = createMemo((previous: McpEditorView) => mcpEditorView(editor()) ?? previous, mcpEditorView(initial))

  const dispatch = (event: McpEditorEvent) => {
    const previous = untrack(editor)
    const next = transitionMcpEditor(previous, event)

    if (next.state !== previous) setEditor(next.state)
    next.effects.forEach(run)
  }

  const settle = (attempt: number) => {
    clearTimeout(runs.get(attempt)?.timer)
    runs.delete(attempt)
  }

  const run = (effect: McpEditorEffect) => {
    if (effect.type === "abort") {
      runs.get(effect.attempt)?.controller.abort()
      settle(effect.attempt)

      return
    }

    if (effect.type === "finished") {
      dialog.close()
      props.onFinished()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(effect.action === "remove" ? "shiyou.mcp.removed" : "shiyou.mcp.saved", {
          name: effect.name,
        }),
      })

      return
    }

    const attempt = effect.attempt
    const controller = new AbortController()
    runs.set(attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "write.timed-out", attempt }), effect.timeoutMs),
    })
    // The machine ignores an answer for an attempt it no longer waits for, an aborted one included.
    void client.write({ source: effect.source, text: effect.text }, controller.signal).then(
      (result) => {
        settle(attempt)

        if (result.type === "written") return dispatch({ type: "write.succeeded", attempt })

        if (result.type === "conflict") return dispatch({ type: "write.conflicted", attempt, source: result.source })

        dispatch({ type: "write.refused", attempt })
      },
      (error) => {
        settle(attempt)
        dispatch({ type: "write.failed", attempt, message: formatServerError(error, language.t) })
      },
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const change = (field: McpDraftField, value: string) => dispatch({ type: "field.changed", field, value })

  const line = (value: number | undefined) =>
    value === undefined ? undefined : language.t("shiyou.mcp.error.line", { line: value })

  const errorText = (errors: McpDraftErrors) => ({
    name: errors.name && language.t(`shiyou.mcp.error.name.${errors.name}`),
    command: errors.command && language.t(`shiyou.mcp.error.command.${errors.command}`),
    url: errors.url && language.t(`shiyou.mcp.error.url.${errors.url}`),
    environment: line(errors.environment),
    headers: line(errors.headers),
  })

  const failure = (value: McpEditorFailure, file: string) => {
    if (value.type === "broken") return language.t("shiyou.mcp.failure.broken", { file })

    if (value.type === "request") return language.t("shiyou.mcp.failure.request", { error: value.message })

    return language.t(`shiyou.mcp.failure.${value.type}`)
  }

  const submitLabel = (busy: boolean, adding: boolean) => {
    if (busy) return language.t("shiyou.mcp.saving")

    if (adding) return language.t("shiyou.mcp.add")

    return language.t("common.save")
  }

  const errors = createMemo(() => errorText(view().errors))

  return (
    <Dialog fit class="settings-server-dialog shiyou-mcp-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>
          {view().adding
            ? language.t("shiyou.mcp.add.title")
            : language.t("shiyou.mcp.edit.title", { name: props.original ?? "" })}
        </DialogTitle>
      </DialogHeader>
      <Divider />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <form
          class="flex w-full min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            dispatch({ type: "save.requested" })
          }}
        >
          <Field id="shiyou-mcp-name" label={language.t("shiyou.mcp.field.name")} error={errors().name}>
            <TextInput
              id="shiyou-mcp-name"
              appearance="large"
              class="!w-full"
              dir="ltr"
              spellcheck={false}
              autocapitalize="off"
              autocomplete="off"
              autofocus={view().adding}
              value={view().draft.name}
              invalid={view().errors.name !== undefined}
              disabled={view().busy}
              onInput={(event) => change("name", event.currentTarget.value)}
            />
          </Field>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <span class="settings-server-dialog-label">{language.t("shiyou.mcp.field.type")}</span>
            <SegmentedControl
              class="segmented-control-v2--full-width"
              value={view().draft.type}
              disabled={view().busy}
              aria-label={language.t("shiyou.mcp.field.type")}
              onChange={(value) => {
                if (value === "local" || value === "remote") dispatch({ type: "type.changed", value })
              }}
            >
              <SegmentedControlItem value="local">{language.t("shiyou.mcp.type.local")}</SegmentedControlItem>
              <SegmentedControlItem value="remote">{language.t("shiyou.mcp.type.remote")}</SegmentedControlItem>
            </SegmentedControl>
          </div>

          <Show
            when={view().draft.type === "local"}
            fallback={
              <>
                <Field id="shiyou-mcp-url" label={language.t("shiyou.mcp.field.url")} error={errors().url}>
                  <TextInput
                    id="shiyou-mcp-url"
                    appearance="large"
                    class="!w-full"
                    dir="ltr"
                    type="url"
                    spellcheck={false}
                    autocapitalize="off"
                    autocomplete="off"
                    placeholder={language.t("shiyou.mcp.field.url.placeholder")}
                    value={view().draft.url}
                    invalid={view().errors.url !== undefined}
                    disabled={view().busy}
                    onInput={(event) => change("url", event.currentTarget.value)}
                  />
                </Field>
                <Field
                  id="shiyou-mcp-headers"
                  label={language.t("shiyou.mcp.field.headers")}
                  hint={language.t("shiyou.mcp.field.headers.hint")}
                  error={errors().headers}
                >
                  <Textarea
                    id="shiyou-mcp-headers"
                    class="!w-full shiyou-mcp-dialog-code"
                    dir="ltr"
                    rows={3}
                    spellcheck={false}
                    value={view().draft.headers}
                    invalid={view().errors.headers !== undefined}
                    disabled={view().busy}
                    onInput={(event) => change("headers", event.currentTarget.value)}
                  />
                </Field>
              </>
            }
          >
            <Field
              id="shiyou-mcp-command"
              label={language.t("shiyou.mcp.field.command")}
              hint={language.t("shiyou.mcp.field.command.hint")}
              error={errors().command}
            >
              <TextInput
                id="shiyou-mcp-command"
                appearance="large"
                class="!w-full shiyou-mcp-dialog-code"
                dir="ltr"
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                placeholder={language.t("shiyou.mcp.field.command.placeholder")}
                value={view().draft.command}
                invalid={view().errors.command !== undefined}
                disabled={view().busy}
                onInput={(event) => change("command", event.currentTarget.value)}
              />
            </Field>
            <Field
              id="shiyou-mcp-environment"
              label={language.t("shiyou.mcp.field.environment")}
              hint={language.t("shiyou.mcp.field.environment.hint")}
              error={errors().environment}
            >
              <Textarea
                id="shiyou-mcp-environment"
                class="!w-full shiyou-mcp-dialog-code"
                dir="ltr"
                rows={3}
                spellcheck={false}
                value={view().draft.environment}
                invalid={view().errors.environment !== undefined}
                disabled={view().busy}
                onInput={(event) => change("environment", event.currentTarget.value)}
              />
            </Field>
          </Show>

          <Switch
            checked={view().draft.enabled}
            disabled={view().busy}
            onChange={(value) => dispatch({ type: "enabled.changed", value })}
          >
            {language.t("shiyou.mcp.field.enabled")}
          </Switch>

          <span class="settings-server-dialog-hint shiyou-mcp-dialog-file">
            {language.t("shiyou.mcp.file", { file: view().file })}
          </span>

          <Show when={view().failure}>
            {(value) => (
              <span class="settings-server-dialog-error" role="alert">
                {failure(value(), view().file)}
              </span>
            )}
          </Show>

          {/* Lets Enter in a text field save the form. */}
          <button type="submit" hidden />
        </form>
      </DialogBody>
      <DialogFooter>
        <div class="shiyou-mcp-dialog-footer">
          <Show
            when={view().confirming}
            fallback={
              <>
                <Show when={!view().adding}>
                  <Button
                    variant="ghost-danger"
                    disabled={view().busy}
                    aria-busy={view().removing}
                    onClick={() => dispatch({ type: "remove.requested" })}
                  >
                    {language.t(view().removing ? "shiyou.mcp.removing" : "shiyou.mcp.remove")}
                  </Button>
                </Show>
                <span class="shiyou-mcp-dialog-spacer" />
                <Button variant="neutral" disabled={view().busy} onClick={() => dialog.close()}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  variant="contrast"
                  disabled={view().busy}
                  aria-busy={view().busy && !view().removing}
                  onClick={() => dispatch({ type: "save.requested" })}
                >
                  {submitLabel(view().busy && !view().removing, view().adding)}
                </Button>
              </>
            }
          >
            <span class="shiyou-mcp-dialog-confirm" role="alert">
              {language.t("shiyou.mcp.remove.confirm", { name: props.original ?? "" })}
            </span>
            <Button variant="neutral" onClick={() => dispatch({ type: "remove.cancelled" })}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => dispatch({ type: "remove.confirmed" })}>
              {language.t("shiyou.mcp.remove")}
            </Button>
          </Show>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

function Field(props: { id: string; label: string; hint?: string; error?: string; children: JSX.Element }) {
  return (
    <div class="flex w-full min-w-0 flex-col gap-2">
      <label for={props.id} class="settings-server-dialog-label">
        {props.label}
      </label>
      {props.children}
      <Show
        when={props.error}
        fallback={<Show when={props.hint}>{(hint) => <span class="settings-server-dialog-hint">{hint()}</span>}</Show>}
      >
        {(error) => (
          <span class="settings-server-dialog-error" role="alert">
            {error()}
          </span>
        )}
      </Show>
    </div>
  )
}
