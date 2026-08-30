import { expect, test } from "bun:test"
import { join } from "node:path"
import type { AppSelection } from "./config.ts"
import { albumIdentity, evaluateSelection } from "./rules.ts"
import { scanLibrary } from "./scan.ts"

const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")

const ALL: AppSelection = {
  version: 1,
  include: [{ kind: "path", path: "**/*" }],
  exclude: [],
}

test("scanner reads mp3 and m4a tags from the Verification Library", async () => {
  const files = await scanLibrary(LIBRARY)
  expect(files.length).toBe(12)
  const byPath = new Map(files.map((file) => [file.relativePath, file]))
  const mp3 = byPath.get("tone-suite/01-pregap.mp3")
  expect(mp3?.tags?.title).toBe("Pregap")
  expect(mp3?.tags?.artist).toBe("Björk")
  expect(mp3?.tags?.albumArtist).toBe("Björk")
  expect(mp3?.tags?.album).toBe("Tone Suite")
  expect(mp3?.tags?.disc).toBe(1)
  expect(mp3?.tags?.track).toBe(1)
  expect(mp3?.tags?.compilation).toBe(false)
  expect(mp3?.tags?.artworkBytes?.length).toBeGreaterThan(0)
  expect(mp3?.tags?.durationSeconds).not.toBeNull()
  expect(mp3?.tags?.durationSeconds ?? 0).toBeGreaterThan(1)
  expect(mp3?.tags?.durationSeconds ?? 0).toBeLessThan(4)

  const aac = byPath.get("field-recordings/01-alpha.m4a")
  expect(aac?.tags?.title).toBe("Alpha")
  expect(aac?.tags?.compilation).toBe(true)
  expect(aac?.tags?.artworkBytes?.length).toBeGreaterThan(0)
  expect(albumIdentity(aac?.tags ?? mp3!.tags!).albumArtist).toBe("Various Artists")

  const alac = byPath.get("dual-disc/d2-01-low.m4a")
  expect(alac?.tags?.album).toBe("Dual Disc")
  expect(alac?.tags?.disc).toBe(2)
  expect(alac?.tags?.track).toBe(1)

  const uncovered = byPath.get("tone-suite/05-uncovered.mp3")
  expect(uncovered?.tags?.artworkBytes).toBeNull()
})

test("disc number does not split an Album", async () => {
  const files = await scanLibrary(LIBRARY)
  const { selected } = evaluateSelection(files, ALL)
  const dual = selected.filter((track) => track.album === "Dual Disc")
  const keys = new Set(dual.map((track) => `${track.albumArtist}\0${track.album}`))
  expect(dual.length).toBe(4)
  expect(keys.size).toBe(1)
})
