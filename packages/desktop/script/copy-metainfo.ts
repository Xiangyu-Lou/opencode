import { resolveChannel } from "./utils"

const arg = process.argv[2]

const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

// shiyou: matches APP_IDS and productName in electron-builder.config.ts.
const appId = channel === "prod" ? "com.shiyou.desktop" : `com.shiyou.desktop.${channel}`

const productName = channel === "prod" ? "shiyou" : `shiyou ${channel.charAt(0).toUpperCase() + channel.slice(1)}`

const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <description>
    <p>
      shiyou (识油) is an agent harness client that helps you write and run code with any AI model. It is based on
      OpenCode by Anomaly Innovations Inc., used under the MIT License.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)

console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
