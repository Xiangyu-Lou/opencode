import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"
import { app } from "electron"
import type { Plugin } from "@opencode/plugin/gui/main"
import { CustomProviders, type ModelListing, type SaveResult } from "./contract"
import {
  fromConfig,
  modelIDs,
  ModelsReply,
  modelsRequest,
  normalize,
  toConfig,
  upsert,
  validate,
  type CustomProvider,
} from "./model"

const LIST_TIMEOUT_MS = 15_000

const decodeReply = Schema.decodeUnknownOption(ModelsReply)

/** The file the server reads. Keep in sync with packages/desktop/src/main/service/shiyou-server.ts. */
export function providersFile(userData: string) {
  return path.join(userData, "server", "config", "opencode", "shiyou-providers.json")
}

/** The file's text, or undefined when there is no file yet. */
async function readText(file: string) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined

    throw error
  }
}

/** What one change of the saved list does: the list to write, if any, and what the caller gets back. */
type Change<A> = { readonly next?: readonly CustomProvider[]; readonly result: A }

const setup: Plugin.MainSetup = (ctx) => {
  const file = providersFile(app.getPath("userData"))
  const log = ctx.log
  // Writes run one at a time, each on the list the previous one left.
  const queue = { tail: Promise.resolve() }

  const read = async (): Promise<CustomProvider[]> => {
    const text = await readText(file)

    return text === undefined ? [] : fromConfig(text)
  }

  // The server watches the folder, so the new file replaces the old in one rename and is never read half written.
  // It holds API keys, so only this user may read it.
  const write = async (providers: readonly CustomProvider[]) => {
    await mkdir(path.dirname(file), { recursive: true })

    const temporary = `${file}.${process.pid}.tmp`

    try {
      await writeFile(temporary, `${JSON.stringify(toConfig(providers), null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, file)
    } catch (error) {
      await rm(temporary, { force: true })

      throw error
    }
  }

  const change = <A>(update: (providers: CustomProvider[]) => Change<A>) => {
    const run = queue.tail.then(async () => {
      const { next, result } = update(await read())

      if (next) await write(next)

      return result
    })

    queue.tail = run.then(
      () => undefined,
      () => undefined,
    )

    return run
  }

  ctx.provide(CustomProviders, {
    list: () => read(),
    save: (input) =>
      change((providers): Change<SaveResult> => {
        const provider = normalize(input)

        const problem = validate(
          provider,
          providers.flatMap((item) => (item.id === provider.id ? [] : [item.id])),
        )

        if (problem)
          return { result: { ok: false, problem: problem.key, model: "model" in problem ? problem.model : undefined } }

        return { next: upsert(providers, provider), result: { ok: true } }
      }),
    remove: (id) => change((providers) => ({ next: providers.filter((item) => item.id !== id), result: undefined })),
    models: async (input, caller): Promise<ModelListing> => {
      const request = modelsRequest(input)

      try {
        const response = await fetch(request.url, {
          headers: request.headers,
          signal: AbortSignal.any([caller.signal, AbortSignal.timeout(LIST_TIMEOUT_MS)]),
        })

        if (!response.ok) return { ok: false, message: `HTTP ${response.status} ${response.statusText}`.trim() }

        const reply = decodeReply(await response.json())
        const models = Option.isSome(reply) ? modelIDs(reply.value) : []

        if (models.length === 0) return { ok: false, message: "The API listed no models." }

        return { ok: true, models }
      } catch (error) {
        log.write("warn", "listing provider models failed", { url: request.url, error: String(error) })

        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

export default setup
