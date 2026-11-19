# shiyou (识油)

This fork of [OpenCode](https://github.com/anomalyco/opencode) ships its desktop client as **shiyou (识油)**. OpenCode is
MIT licensed; the root `LICENSE` stays as it is, and the client's About page shows the attribution and the license text.

The rebrand is kept small and in a few places so upstream syncs stay easy. Fork-only code is marked with a `shiyou:`
comment wherever it touches an upstream file.

## Artwork

- `brand/shiyou.svg` is the source drawing: the mark and the 识油 wordmark.
- `packages/ui/src/components/brand.tsx` draws it in the client. `@opencode/ui/logo` (`Mark`, `Splash`, `Logo`) and
  `@opencode/ui/wordmark` re-export it, so every OpenCode logo in the client shows shiyou.
- `bun brand/generate-icons.ts` regenerates the desktop app icons (`packages/desktop/icons/{prod,beta,dev}`) and the
  notification icon from `brand/shiyou.svg`. After a new drawing, replace the SVG, update the paths in `brand.tsx`, and
  run the script.

## Name and copy

- `packages/app/src/brand/name.ts` holds the name.
- `packages/app/src/brand/i18n.ts` lists the translation keys whose "OpenCode" means the client and renames them in
  every locale. Copy about the OpenCode server and CLI, the OpenCode Go, Console and Zen services, and the trademark
  keeps the OpenCode name.
- Window titles, the Windows menu heading and the default theme's label use the name directly.

## Removed from the client

- Links to opencode.ai, the OpenCode docs, Discord and GitHub: the Help menu items, the Help button, the error page's
  report link, the "Add skills" and theme "Learn more" links, and the About page's website and contributor links.
- The updater plugin, which installs official OpenCode releases from opencode.ai.
- The Install CLI menu item, which writes `~/.opencode/bin/opencode`, where an installed OpenCode CLI lives.

## OpenCode's own services are off

shiyou turns off OpenCode's own sign-in and models: the OpenCode Console and OpenCode Go sign-ins, OpenCode Zen with
its free models ("OpenCode Free"), and the providers a Console workspace adds. Their code stays in place, so upstream
syncs stay easy.

- `packages/desktop/src/main/service/shiyou-hide-opencode.plugin.js` is a plugin for shiyou's own server. The desktop
  copies it into `<app data>/server/config/opencode/plugins/` each time it starts the server, and it removes those
  integrations and providers, so no list in the client shows them and the server never falls back to a free OpenCode
  model. It shows up in the server's plugin list as `shiyou.hide-opencode`.
- The client hides what the server can't: the empty "Free models provided by OpenCode" heading
  (`providers/models/unpaid.tsx`), the "View usage" command for OpenCode Go and Console budgets
  (`composer/commands.tsx`), and the connect command's description that names OpenCode Go and Console
  (`SERVICE_KEYS` in `packages/app/src/brand/i18n.ts`).

## Model providers page

With OpenCode's services off, users bring their own models. **Settings → Model providers** (also the "Configure model
providers" command) adds providers with their own API: a name and ID, the API format (OpenAI Chat Completions, OpenAI
Responses or Anthropic Messages), the base URL, the API key, and models with a thinking level (Off, Low, Medium,
High) and optional context and output limits. "Fetch model list" asks the API's `/models` for IDs to add.

- It is the `custom-providers` built-in GUI plugin, `packages/gui-plugins/src/custom-providers/`. Its main entry
  writes `<app data>/server/config/opencode/shiyou-providers.json`, a plain config document in the server's
  `providers` format (`toConfig` in `model.ts`). The file is the only store, so API keys sit there in plain text,
  readable only by the user (mode 0600).
- The desktop starts the server with `OPENCODE_CONFIG` pointing at that file (`providersFile` in
  `packages/desktop/src/main/service/shiyou-server.ts`). The server loads it like any config and watches it, so a
  saved change reaches every open project in about a second, without a restart. Project config still overrides it.
- Thinking: the chosen level is the model's own settings, which the composer's Default variant uses; thinking models
  also offer Low, Medium and High there. OpenAI formats let the server spell the variants (`reasoningEffort`);
  Anthropic-compatible models get budgeted `thinking` variants written by the plugin, below the output limit.
- The user's own `OPENCODE_CONFIG` travels in `SHIYOU_USER_CONFIG` and `restoreUserConfig`
  (`packages/util/src/shiyou-user-env.ts`) hands it back right after `packages/cli/src/server-process.ts` reads it,
  so terminals and tools the server starts never load shiyou's providers.

## Identity

The desktop app is `shiyou` (`com.shiyou.desktop`, with `.beta` and `.dev` channels) and registers the `shiyou://`
scheme, so it installs beside an OpenCode desktop app and keeps its own app data. See
`packages/desktop/src/main/constants.ts`, `packages/desktop/electron-builder.config.ts`,
`packages/desktop/script/dev-electron.ts` and `packages/desktop/src/main/lifecycle/environment.ts`.

## Its own server

shiyou never shares a background server, sessions, sign-ins or config with an installed OpenCode. Its bundled server
keeps everything under `<app data>/server/{data,config,cache,state}` and listens on its own port (`0x51C0` for shiyou,
`0x51C1` for Beta, `0x51C2` for Dev; OpenCode uses `0xC0DE`). So shiyou never reads OpenCode's sessions, and never
adopts, restarts or replaces an OpenCode server. See `packages/desktop/src/main/service/shiyou-server.ts`.

The server gets those folders through `XDG_*`, which any CLI binary honors. The user's own `XDG_*` values travel along
in `SHIYOU_USER_XDG`, and `packages/util/src/shiyou-user-env.ts` hands them back once the server has read its roots,
so terminals and tools started from shiyou keep the user's folders (an unset value comes back empty, which XDG reads
as unset). That step lives in this fork's CLI: a desktop build that downloads a published OpenCode CLI instead of
bundling `packages/cli/dist` keeps the separation, but its terminals see shiyou's server folders.

Still shared on purpose: project files (`.opencode/` in a repository), `~/.claude` and `~/.agents`, and an
`OPENCODE_CONFIG_DIR` or `OPENCODE_DB` set in your shell.

## MCP servers in Settings and for the agent

Because the server's global configuration lives in `<app data>/server/config/opencode/opencode.json(c)`, OpenCode's own
guidance points at the wrong file: its built-in `opencode` skill tells the agent the global config is
`~/.config/opencode/opencode.json(c)` and to add MCP servers with `opencode mcp add`, which from the agent's shell (where
the user's `XDG_*` are back) writes the user's own OpenCode configuration. A second server plugin fixes both sides:

- `packages/desktop/src/main/service/shiyou-mcp-config.plugin.js` (`shiyou.mcp-config`), installed beside
  `shiyou-hide-opencode.js` at every start (`SERVER_PLUGINS` in `background-service.ts`). It finds the config folder from
  its own location, and:
  - rewrites the `opencode` skill: a first section that names shiyou's config file and server log and says `opencode`
    shell commands reach the user's OpenCode, not shiyou; OpenCode's paths replaced where the guide spells them out; and
    an MCP section that edits shiyou's file directly. The first section still holds when an upstream sync moves the text
    the replacements look for (`shiyou-mcp-config.plugin.test.ts` reads the real skill and fails when it moves);
  - adds the `shiyou_mcp_status` tool (`tools.shiyou.mcp_status` in Code Mode), so the agent can check what it
    configured without `opencode mcp list`;
  - serves the `shiyou.mcp-config` RPC: `read` returns the file and its text, `write` replaces the text only when the
    file still reads what the client read (otherwise it answers `conflict` with the current text) and only with a JSON or
    JSONC object.
- Settings › Extensions › MCPs (`packages/app/src/brand/mcp/`) adds **Add server** and an edit button on every server the
  global file defines, with a dialog for local commands and remote URLs (name, command or URL, environment variables or
  headers, enabled) that also removes a server. Edits go through jsonc-parser, so comments, other settings and the
  fields the dialog doesn't show (`timeout`, `oauth`, `codemode`…) stay; a write refused as a conflict is applied once
  more to the new text, so an edit the agent saved meanwhile is kept. Connected to a server without the RPC, the page
  keeps OpenCode's read-only list. Its copy is in `packages/app/src/brand/en.ts` (English only for now).

The file is the one OpenCode's own config writer edits: `opencode.jsonc`, or `opencode.json` when only that one exists.
The server reloads it on save, so servers added from Settings or by the agent connect without a restart.

## Releases

`.github/workflows/shiyou-release.yml` builds this fork's CLI and the desktop client and publishes a GitHub Release
tagged `shiyou-v<version>` with the macOS Apple Silicon DMG and the Windows x64 installer. To release, put the new
version in `.github/shiyou/RELEASE` and merge it to dev. Pushing a `shiyou-v<version>` tag or **shiyou-release → Run
workflow** in the Actions tab works too. It needs no secrets, so the builds are unsigned: the macOS app is ad-hoc
signed (`.github/shiyou/package-macos.sh`) and not notarized.

Upstream's own workflows stay in place for easy syncs. `shiyou-disable-upstream-workflows.yml` turns them off in the
fork (they triage and close pull requests, publish to OpenCode's channels, or need upstream's runners) and cancels
their unfinished runs. It runs on every push to dev that changes a workflow, so a sync that adds one turns it off too.
