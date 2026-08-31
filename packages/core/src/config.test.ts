import { expect, test } from "bun:test"
import {
  formatConfigIssue,
  parseConfigText,
  parseSelectionText,
  serializeSelection,
  starterConfigText,
} from "./config.ts"
import { LIBRARY_NOT_SET, starterConfigRefusal } from "./refusals.ts"

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

test("starter config without library names the cause and the fix", () => {
  const parsed = parseConfigText("config.toml", starterConfigText())
  expect(parsed.ok).toBe(false)
  if (parsed.ok) {
    return
  }
  expect(formatConfigIssue(parsed.issue)).toBe(`config.toml: ${LIBRARY_NOT_SET}`)
  expect(starterConfigRefusal("/tmp/config.toml")).toBe(
    `Wrote starter config /tmp/config.toml. ${LIBRARY_NOT_SET}`,
  )
})
