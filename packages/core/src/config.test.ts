import { expect, test } from "bun:test"
import { parseSelectionText, serializeSelection } from "./config.ts"

test("write-back sorts Rules and drops comments", () => {
  const parsed = parseSelectionText(
    "selection.toml",
    `version = 1

# keep this artist
[[include]]
path = "b/track"
# comment

[[exclude]]
album_artist = "Zed"

[[include]]
album_artist = "Alpha"
album = "Two"

[[include]]
album_artist = "Alpha"
`,
  )
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) {
    return
  }
  const text = serializeSelection(parsed.value)
  expect(text).not.toContain("#")
  expect(text).toBe(`version = 1

[[include]]
album_artist = "Alpha"

[[include]]
album_artist = "Alpha"
album = "Two"

[[include]]
path = "b/track"

[[exclude]]
album_artist = "Zed"
`)
})
