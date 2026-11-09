#!/usr/bin/env bun
/**
 * Regenerates the shiyou desktop icons from brand/shiyou.svg: every root-level PNG, icon.icns, icon.ico and dock.png
 * in packages/desktop/icons/{prod,beta,dev}, the production Icon Composer artwork, and the notification icon.
 *
 *   bun brand/generate-icons.ts
 *
 * The mark (the left part of the artwork, without 识油) is drawn by Chromium through the Playwright that
 * packages/app already depends on, at each size, on a light tile tinted per channel. Run `bunx playwright install
 * chromium` once if Playwright has no browser yet, or set CHROMIUM_PATH to a Chromium executable.
 */
import { createRequire } from "node:module"
import path from "node:path"
import { readdir } from "node:fs/promises"

const root = path.resolve(import.meta.dir, "..")
const icons = path.join(root, "packages/desktop/icons")
const { chromium } = createRequire(path.join(root, "packages/app/package.json"))(
  "@playwright/test",
) as typeof import("@playwright/test")

// The mark's group in the artwork, and its box in that group's coordinates.
const artwork = await Bun.file(path.join(import.meta.dir, "shiyou.svg")).text()
const defs = artwork.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? ""
const mark = artwork.match(/<g id="编组-3">[\s\S]*?<\/g>/)?.[0]
if (!mark) throw new Error("brand/shiyou.svg has no mark group (id 编组-3)")
const box = { width: 109.36, height: 96.78 }

// A light tile per channel, so an installed beta or dev build is told apart from the release at a glance.
const tiles = {
  prod: ["#ffffff", "#eef1f5"],
  beta: ["#fff8e8", "#fde7b8"],
  dev: ["#eef5fd", "#d3e4f7"],
} as const

type Channel = keyof typeof tiles
type Tile = "rounded" | "square" | "macos"

/** The icon as SVG on a 1024 canvas. `macos` is the pre-macOS 26 grid: an 824 squircle with a shadow. */
function icon(channel: Channel, shape: Tile) {
  const [top, bottom] = tiles[channel]
  const tile = shape === "macos" ? { x: 100, size: 824 } : { x: 0, size: 1024 }
  const radius = shape === "square" ? 0 : tile.size * 0.225
  const scale = (tile.size * 0.62) / box.width
  const x = tile.x + (tile.size - box.width * scale) / 2
  const y = tile.x + (tile.size - box.height * scale) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${defs}
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/></filter>
  </defs>
  <rect x="${tile.x}" y="${tile.x}" width="${tile.size}" height="${tile.size}" rx="${radius}" fill="url(#tile)"${shape === "macos" ? ' filter="url(#shadow)"' : ""}/>
  ${shape === "square" ? "" : `<rect x="${tile.x + 1}" y="${tile.x + 1}" width="${tile.size - 2}" height="${tile.size - 2}" rx="${radius - 1}" fill="none" stroke="#000" stroke-opacity="0.08" stroke-width="2"/>`}
  <g transform="translate(${x} ${y}) scale(${scale})">${mark}</g>
</svg>`
}

// CHROMIUM_PATH points at a Chromium build when Playwright has none of its own.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage()

async function render(svg: string, size: number) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`,
  )

  return Buffer.from(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
}

const pngSize = (png: Buffer) => png.readUInt32BE(16)

/** An ICNS file of PNG entries, which macOS reads since 10.7. */
function icns(entries: [type: string, png: Buffer][]) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, "latin1")
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write("icns", 0, "latin1")
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

/** An ICO file of PNG entries. */
function ico(pngs: Buffer[]) {
  const head = Buffer.alloc(6 + pngs.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach((png, index) => {
    const size = pngSize(png)
    const at = 6 + index * 16
    head.writeUInt8(size >= 256 ? 0 : size, at)
    head.writeUInt8(size >= 256 ? 0 : size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(png.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...pngs])
}

for (const channel of Object.keys(tiles) as Channel[]) {
  const dir = path.join(icons, channel)
  const rounded = icon(channel, "rounded")
  const macos = icon(channel, "macos")

  // Root-level PNGs keep their names and sizes.
  for (const name of (await readdir(dir)).filter((name) => name.endsWith(".png") && name !== "dock.png")) {
    const size = pngSize(Buffer.from(await Bun.file(path.join(dir, name)).arrayBuffer()))
    await Bun.write(path.join(dir, name), await render(rounded, size))
  }

  // Renders share the one page, so they run one after another.
  const mac: Record<number, Buffer> = {}
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) mac[size] = await render(macos, size)
  await Bun.write(
    path.join(dir, "icon.icns"),
    icns([
      ["icp4", mac[16]],
      ["icp5", mac[32]],
      ["ic11", mac[32]],
      ["ic12", mac[64]],
      ["ic07", mac[128]],
      ["ic13", mac[256]],
      ["ic08", mac[256]],
      ["ic14", mac[512]],
      ["ic09", mac[512]],
      ["ic10", mac[1024]],
    ]),
  )
  // The unpackaged dev app's Dock icon matches the packaged inset (see packages/desktop/icons/README.md).
  await Bun.write(path.join(dir, "dock.png"), mac[256])

  const win: Buffer[] = []
  for (const size of [32, 16, 24, 48, 64, 256]) win.push(await render(rounded, size))
  await Bun.write(path.join(dir, "icon.ico"), ico(win))

  // macOS 26 masks the Icon Composer artwork itself, so it is a full square.
  const composer = path.join(dir, "icon.icon/Assets/icon.png")
  if (await Bun.file(composer).exists()) await Bun.write(composer, await render(icon(channel, "square"), 1024))

  console.log(`Generated ${channel} icons`)
}

await Bun.write(
  path.join(root, "packages/desktop/src/renderer/platform/notification-icon.png"),
  await render(icon("prod", "rounded"), 96),
)

await browser.close()
