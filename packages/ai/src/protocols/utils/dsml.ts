// shiyou: fork-only. DeepSeek models write tool calls in DSML, and the serving engine is meant to turn that markup into
// `tool_calls`. When its tool parser does not know the model's spelling (DeepSeek-V4.1 writes `<｜DSML｜ calls>`, with a
// space, where V4 wrote `<｜DSML｜tool_calls>` and V3.2 `<｜DSML｜function_calls>`), pieces of the call reach the client
// as reasoning or text instead, and the reply ends with `stop` and no tool call. This keeps the markup out of what is
// shown and records that it appeared, so the protocol can fail the reply as incomplete and the session continues.

/** One output channel, reasoning or text, as DSML markup is taken out of it. */
export interface Channel {
  /** The end of the last delta, held back because it may still become a DSML tag. */
  readonly held: string
  /** Inside a tool-call block, whose text is dropped up to the block's closing tag. */
  readonly inBlock: boolean
  /** A DSML tag appeared in this channel. */
  readonly seen: boolean
}

export const empty: Channel = { held: "", inBlock: false, seen: false }

// Any DSML tag, in every spelling seen: fullwidth or ASCII pipes, single or doubled, with or without spaces.
const TAG = /<\/?[ \t]*[｜|]{1,2}[ \t]*DSML[ \t]*[｜|]{1,2}[^<>]*>/

// The tag that closes a whole block: `function_calls` (V3.2), `tool_calls` (V4) or ` calls` (V4.1).
const BLOCK_END = /^<\/[ \t]*[｜|]{1,2}[ \t]*DSML[ \t]*[｜|]{1,2}[ \t]*(?:[a-z]+_)?calls[ \t]*>$/

// The start of a DSML tag that the next delta may complete.
const PARTIAL = /^<\/?[ \t]*(?:[｜|]{1,2}[ \t]*(?:D(?:S(?:M(?:L(?:[ \t]*(?:[｜|]{1,2}[^<>]*)?)?)?)?)?)?)?$/

// Tags are short; a longer tail is ordinary text.
const MAX_HELD = 256

/** The channel after `delta`, and the part of it to show. */
export function push(channel: Channel, delta: string) {
  return scan(channel.held + delta, channel.inBlock, channel.seen, "")
}

/** The channel at the end of the reply, and what it still held back to show. */
export function flush(channel: Channel): readonly [Channel, string] {
  // A tag the reply cut off before its `>` is still markup.
  const cut = channel.held.includes("DSML")
  if (channel.inBlock || cut) return [{ held: "", inBlock: channel.inBlock, seen: channel.seen || cut }, ""]
  return [{ ...channel, held: "" }, channel.held]
}

function scan(text: string, inBlock: boolean, seen: boolean, shown: string): readonly [Channel, string] {
  const tag = TAG.exec(text)

  // The block's closing tag ends it. Any other tag starts one, so a call that arrives without its opening tags is
  // dropped from its first closing tag on.
  if (tag)
    return scan(
      text.slice(tag.index + tag[0].length),
      !BLOCK_END.test(tag[0]),
      true,
      inBlock ? shown : shown + text.slice(0, tag.index),
    )

  const start = text.lastIndexOf("<")
  const held =
    start !== -1 && text.length - start <= MAX_HELD && PARTIAL.test(text.slice(start)) ? text.slice(start) : ""

  return [{ held, inBlock, seen }, inBlock ? shown : shown + text.slice(0, text.length - held.length)]
}

export * as DSML from "./dsml.js"
