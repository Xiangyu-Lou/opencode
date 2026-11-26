// shiyou: fork-only. DeepSeek DSML tool-call markup that the serving engine left in reasoning or text.
import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { ai, LLMEvent } from "../../src/effect.js"
import { Auth, LLMClient } from "../../src/route.js"
import * as OpenAICompatibleChat from "../../src/protocols/openai-compatible-chat.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const request = ai.request({
  model: OpenAICompatibleChat.route
    .with({ provider: "custom", endpoint: { baseURL: "https://api.custom.test/v1" }, auth: Auth.bearer("test-key") })
    .model({ id: "deepseek-v4.1" }),
  prompt: "Present the report.",
})

const chunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

const toolCall = chunk({
  tool_calls: [{ index: 0, id: "call_1", function: { name: "tool_search", arguments: '{"query":"present"}' } }],
})

const shown = (events: ReadonlyArray<LLMEvent>, type: "reasoning-delta" | "text-delta") =>
  events.flatMap((event) => (event.type === type ? [event.text] : [])).join("")

describe("OpenAI Chat DSML markup", () => {
  it.effect("fails a reply whose tool call reached the client only as leftover markup", () =>
    Effect.gen(function* () {
      const events: LLMEvent[] = []
      // As in the report: the engine kept the opening tags and left the closing ones, split across deltas.
      const error = yield* LLMClient.stream(request).pipe(
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ reasoning_content: 'Let me search tools for "present".' }),
              chunk({ reasoning_content: "</｜DSML｜ parameter>\n</｜DS" }),
              chunk({ reasoning_content: "ML｜ invoke>\n</｜DSML｜ calls>" }),
              chunk({}, "stop"),
            ),
          ),
        ),
        Effect.flip,
      )

      expect(shown(events, "reasoning-delta")).toBe('Let me search tools for "present".')
      expect(error.reason).toMatchObject({ _tag: "InvalidProviderOutput", classification: "incomplete-stream" })
    }),
  )

  it.effect("keeps a parsed tool call and hides the markup the engine also left as text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ reasoning_content: "Searching." }),
              chunk({ content: "Checking.\n\n<｜DSML｜function_calls>\n<｜DSML｜invoke " }),
              chunk({ content: 'name="tool_search">\n<｜DSML｜parameter name="query" string="true">present' }),
              chunk({ content: "</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>" }),
              toolCall,
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("Searching.")
      expect(response.text).toBe("Checking.\n\n")
      expect(response.toolCalls).toMatchObject([{ id: "call_1", name: "tool_search", input: { query: "present" } }])
      expect(response.finishReason.normalized).toBe("tool-calls")
    }),
  )

  it.effect("hides every spelling of the markup: ASCII and doubled pipes, V4 and V4.1 blocks", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ reasoning_content: 'One.<|DSML|tool_calls><|DSML|invoke name="a"></|DSML|invoke>' }),
              chunk({ reasoning_content: "</|DSML|tool_calls> Two.<||DSML||" }),
              chunk({
                reasoning_content: ' calls><||DSML|| invoke name="b"></||DSML|| invoke></||DSML|| calls> Three.',
              }),
              toolCall,
              chunk({}, "tool_calls"),
            ),
          ),
        ),
      )

      expect(response.reasoning).toBe("One. Two. Three.")
      expect(response.toolCalls).toHaveLength(1)
    }),
  )

  it.effect("leaves ordinary angle brackets alone, including one held at the end of a delta", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents(
              chunk({ content: "if a <" }),
              chunk({ content: "| b then <div> <" }),
              chunk({ content: "/div> ends with <" }),
              chunk({}, "stop"),
            ),
          ),
        ),
      )

      expect(response.text).toBe("if a <| b then <div> </div> ends with <")
      expect(response.finishReason.normalized).toBe("stop")
      expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
    }),
  )
})
