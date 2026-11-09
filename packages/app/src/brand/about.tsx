import { createEffect, createMemo, createSignal, For, onCleanup, untrack } from "solid-js"
import { writeClipboard } from "@opencode/session-ui/copy"
import { useDialog } from "@opencode/ui/context/dialog"
import { Logo } from "@opencode/ui/logo"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import {
  INITIAL_ABOUT_COPY_STATE,
  selectAboutCopyView,
  transitionAboutCopy,
  type AboutCopyEffect,
  type AboutCopyEvent,
} from "@/settings/about/machine"
import license from "../../../../LICENSE?raw"
import { BRAND_DISPLAY_NAME } from "./name"

// The attribution line in the languages this fork is used in; others read it in English.
const BASED_ON = {
  en: "Based on OpenCode, the open source coding agent by Anomaly Innovations, Inc.",
  zh: "基于 Anomaly Innovations, Inc. 的开源编码代理 OpenCode 构建。",
  zht: "基於 Anomaly Innovations, Inc. 的開源編碼代理 OpenCode 建構。",
}

const basedOn = (locale: string) => (locale === "zh" || locale === "zht" ? BASED_ON[locale] : BASED_ON.en)

// The repository's MIT License, reflowed into paragraphs for the page's width.
const paragraphs = license
  .trim()
  .split(/\n\s*\n/)
  .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " "))

/**
 * shiyou: the About page. It names the client and carries the attribution the MIT License asks for: OpenCode, its
 * copyright holder, the license text, and the trademark notice. The third-party notices stay one click away.
 */
export function BrandAbout(props: { active: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [copyState, setCopyState] = createSignal(INITIAL_ABOUT_COPY_STATE)
  const copy = createMemo(() => selectAboutCopyView(copyState()))
  const version = () => platform.version ?? language.t("settings.about.devVersion")
  const versionLabel = () => language.t("settings.about.version", { version: version() })
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  const dispatchCopy = (event: AboutCopyEvent) =>
    untrack(() => {
      const previous = copyState()
      const next = transitionAboutCopy(previous, event)

      if (next.state !== previous) setCopyState(next.state)
      next.effects.forEach(runCopyEffect)
    })

  function runCopyEffect(effect: AboutCopyEffect) {
    if (effect.type === "timer.clear") return clearTimeout(copyTimer)

    if (effect.type === "timer.schedule") {
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => dispatchCopy({ type: effect.event, attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "toast.failed")
      return showToast({ variant: "error", title: language.t("settings.about.copyVersionFailed") })

    const attempt = effect.attempt
    void Promise.try(() =>
      platform.writeClipboardText
        ? platform.writeClipboardText(effect.text).then(() => true)
        : writeClipboard(effect.text),
    ).then(
      (written) => dispatchCopy({ type: written ? "copy.succeeded" : "copy.failed", attempt }),
      () => dispatchCopy({ type: "copy.failed", attempt }),
    )
  }

  createEffect(() => {
    if (!props.active) dispatchCopy({ type: "hidden" })
  })
  onCleanup(() => dispatchCopy({ type: "disposed" }))

  const showNotices = async () => {
    const loaded = await import("@/settings/about/notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    void dialog.show(() => <loaded.default />)
  }

  return (
    <div class="settings-about-content">
      <Logo class="h-auto w-[200px] shrink-0" />

      <div class="settings-about-intro">
        <p class="text-v2-text-text-base">{BRAND_DISPLAY_NAME}</p>
        <div class="settings-about-version-line">
          <Tooltip
            value={language.t(copy().copied ? "common.copied" : "ui.message.copy")}
            placement="top"
            forceOpen={copy().forceOpen}
          >
            <button
              type="button"
              class="settings-about-version"
              disabled={copy().disabled}
              aria-label={language.t(copy().copied ? "common.copied" : "ui.message.copy")}
              onClick={() => dispatchCopy({ type: "copy.requested", text: versionLabel() })}
            >
              <span>
                {language.rich("settings.about.version", {
                  version: <bdi dir="ltr">{version()}</bdi>,
                })}
              </span>
            </button>
          </Tooltip>
        </div>
      </div>

      <div data-component="brand-attribution" class="settings-about-details">
        <p>{basedOn(language.locale())}</p>
        <p>{language.t("settings.about.trademark")}</p>
        <details class="w-full">
          <summary class="settings-about-link">{language.t("settings.about.license")}</summary>
          <div class="mt-3 flex flex-col gap-2 text-start text-12-regular text-v2-text-text-faint">
            <For each={paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>
          </div>
        </details>
        <p>
          <button type="button" class="settings-about-link" onClick={() => void showNotices()}>
            {language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>
    </div>
  )
}
