import { expect, test } from "bun:test"
import { mkdir, mkdtemp, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppSelection } from "./config.ts"
import { albumIdentity, evaluateSelection } from "./rules.ts"
import { scanLibrary } from "./scan.ts"
import type { TrackTags } from "./tags.ts"

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
  expect(mp3?.tags?.gapless).toEqual({
    encoderDelay: 576,
    encoderPadding: 1080,
    sampleCount: 88200n,
  })

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

function namedTags(album: string, artist: string): TrackTags {
  return {
    title: "T",
    artist,
    album,
    albumArtist: artist,
    track: 1,
    trackTotal: 1,
    disc: 1,
    discTotal: 1,
    compilation: false,
    hasArtwork: false,
    artworkMime: null,
    artworkBytes: null,
    codec: "mp3",
    gapless: null,
    durationSeconds: 1,
  }
}

test("album Rule matches Straße with STRASSE and Strasse", () => {
  const files = [
    {
      relativePath: "strasse.mp3",
      size: 1,
      mtimeMs: 0,
      extension: "mp3",
      tags: namedTags("Straße", "A"),
    },
  ]
  const strasse = evaluateSelection(files, {
    version: 1,
    include: [{ kind: "album", albumArtist: "A", album: "STRASSE" }],
    exclude: [],
  })
  const ascii = evaluateSelection(files, {
    version: 1,
    include: [{ kind: "album", albumArtist: "A", album: "Strasse" }],
    exclude: [],
  })
  expect(strasse.selected).toHaveLength(1)
  expect(ascii.selected).toHaveLength(1)
})

test("album_artist Rule matches Björk casing", () => {
  const files = [
    {
      relativePath: "bjork.mp3",
      size: 1,
      mtimeMs: 0,
      extension: "mp3",
      tags: namedTags("Tone Suite", "Björk"),
    },
  ]
  const { selected } = evaluateSelection(files, {
    version: 1,
    include: [{ kind: "album_artist", albumArtist: "BJÖRK" }],
    exclude: [],
  })
  expect(selected).toHaveLength(1)
})

test("scanner follows a symbolic link to a Track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-scan-link-"))
  const linked = join(dir, "linked.mp3")
  await symlink(join(LIBRARY, "tone-suite/01-pregap.mp3"), linked)
  const files = await scanLibrary(dir)
  expect(files).toHaveLength(1)
  expect(files[0]?.relativePath).toBe("linked.mp3")
  expect(files[0]?.tags?.title).toBe("Pregap")
})

test("scanner does not loop on a directory symlink cycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-scan-cycle-"))
  const nested = join(dir, "a")
  await mkdir(nested)
  await symlink(nested, join(nested, "loop"))
  await symlink(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(nested, "track.mp3"))
  const files = await scanLibrary(dir)
  expect(files).toHaveLength(1)
  expect(files[0]?.relativePath).toBe("a/track.mp3")
})
