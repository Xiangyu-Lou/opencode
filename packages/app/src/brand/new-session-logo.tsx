import { Wordmark } from "@opencode/ui/wordmark"

/**
 * shiyou: the new session hero shows the shiyou logo in place of the interactive OpenCode wordmark (its lodger, pin
 * board and Brick Breaker are drawn around the OpenCode letters). It has the first-launch splash's geometry, so the
 * splash hands over without a jump.
 */
export function BrandNewSessionLogo(props: { ref: (element: HTMLDivElement) => void }) {
  return (
    <div
      ref={props.ref}
      data-component="brand-new-session-logo"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px]"
    >
      <Wordmark fade={false} muted={false} class="mx-auto block h-auto w-4/5" />
    </div>
  )
}
