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
