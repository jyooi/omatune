import { expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  defaultDeviceName,
  formatConfigIssue,
  parseConfigText,
  parseSelectionText,
  registerDevice,
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

test("defaultDeviceName tightens family and size, drops the year", () => {
  expect(defaultDeviceName("iPod classic 120 GB (2008)", "aaaaaaaaaaaaaaaa")).toBe("Classic 120GB")
  expect(defaultDeviceName("iPod classic 80/160 GB (2007)", "aaaaaaaaaaaaaaaa")).toBe("Classic 80/160GB")
  expect(defaultDeviceName("iPod nano 4G", "aaaaaaaaaaaaaaaa")).toBe("Nano 4G")
})

test("defaultDeviceName falls back to the serial when the family is unknown", () => {
  expect(defaultDeviceName(null, "aaaaaaaaaaaaaaaa")).toBe("aaaaaaaaaaaaaaaa")
})

test("registerDevice appends a devices table and resets its Selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-register-"))
  await writeFile(join(dir, "config.toml"), 'version = 1\n# keep this comment\nlibrary = "/music"\n')
  const result = await registerDevice(dir, "AAAAAAAAAAAAAAAA", "Classic 120GB")
  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }
  expect(result.value).toEqual({ serial: "aaaaaaaaaaaaaaaa", name: "Classic 120GB" })
  const config = await Bun.file(join(dir, "config.toml")).text()
  expect(config).toContain("# keep this comment")
  expect(config).toContain('[devices."aaaaaaaaaaaaaaaa"]')
  expect(config).toContain('name = "Classic 120GB"')
  const selection = await Bun.file(join(dir, "devices", "aaaaaaaaaaaaaaaa", "selection.toml")).text()
  expect(selection).toContain("version = 1")
  expect(selection).not.toContain("[[include]]")
})
