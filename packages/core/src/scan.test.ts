import { expect, test } from "bun:test"
import { mkdir, mkdtemp, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppSelection } from "./config.ts"
import { albumIdentity, evaluateSelection } from "./rules.ts"
import {
  scanLibrary,
  UNLISTED_MISSING_TAGS,
  UNLISTED_RENAME_ALAC,
  UNLISTED_UNREADABLE,
  unsupportedFormatReason,
} from "./scan.ts"
import type { TrackTags } from "./tags.ts"

const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")

const ALL: AppSelection = {
  version: 1,
  include: [{ kind: "path", path: "**/*" }],
  exclude: [],
}

test("scanner reads mp3, m4a, and flac tags from the Verification Library", async () => {
  const { files, unlisted } = await scanLibrary(LIBRARY)
  expect(files.length).toBe(14)
  expect(unlisted).toEqual([])
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

  // FLAC joined the supported set, so the scanner reads its Vorbis comments
  // and its picture block.
  const flac = byPath.get("lossless-suite/01-standard.flac")
  expect(flac?.tags?.codec).toBe("flac")
  expect(flac?.tags?.title).toBe("Standard")
  expect(flac?.tags?.artist).toBe("Björk")
  expect(flac?.tags?.albumArtist).toBe("Björk")
  expect(flac?.tags?.album).toBe("Lossless Suite")
  expect(flac?.tags?.track).toBe(1)
  expect(flac?.tags?.trackTotal).toBe(2)
  expect(flac?.tags?.artworkBytes?.length).toBeGreaterThan(0)
  expect(flac?.tags?.artworkMime).toBe("image/png")
  expect(flac?.tags?.durationSeconds).toBeCloseTo(2, 3)
})

test("disc number does not split an Album", async () => {
  const { files } = await scanLibrary(LIBRARY)
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
  const { files } = await scanLibrary(dir)
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
  const { files } = await scanLibrary(dir)
  expect(files).toHaveLength(1)
  expect(files[0]?.relativePath).toBe("a/track.mp3")
})

async function writeTempLibrary(
  entries: ReadonlyArray<{ path: string; bytes: string | Uint8Array }>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omatune-scan-unlisted-"))
  for (const entry of entries) {
    const dest = join(dir, entry.path)
    const parent = dest.slice(0, dest.lastIndexOf("/"))
    if (parent !== dir) {
      await mkdir(parent, { recursive: true })
    }
    await Bun.write(dest, entry.bytes)
  }
  return dir
}

function emptyM4a(): Uint8Array {
  const ftypBody = new TextEncoder().encode("M4A isom")
  const ftyp = new Uint8Array(8 + ftypBody.length)
  ftyp[0] = 0
  ftyp[1] = 0
  ftyp[2] = 0
  ftyp[3] = ftyp.length
  ftyp[4] = 0x66
  ftyp[5] = 0x74
  ftyp[6] = 0x79
  ftyp[7] = 0x70
  ftyp.set(ftypBody, 8)
  const moov = new Uint8Array(8)
  moov[3] = 8
  moov[4] = 0x6d
  moov[5] = 0x6f
  moov[6] = 0x6f
  moov[7] = 0x76
  const out = new Uint8Array(ftyp.length + moov.length)
  out.set(ftyp, 0)
  out.set(moov, ftyp.length)
  return out
}

test("scanner lists a .alac file as Unlisted with the rename reason", async () => {
  const dir = await writeTempLibrary([{ path: "song.alac", bytes: "alac-bytes" }])
  const { files, unlisted } = await scanLibrary(dir)
  expect(files).toEqual([])
  expect(unlisted).toEqual([{ relativePath: "song.alac", reason: UNLISTED_RENAME_ALAC }])
})

test("scanner lists an untagged .m4a as Unlisted with missing tags", async () => {
  const dir = await writeTempLibrary([{ path: "bare.m4a", bytes: emptyM4a() }])
  const { files, unlisted } = await scanLibrary(dir)
  expect(files).toEqual([])
  expect(unlisted).toEqual([{ relativePath: "bare.m4a", reason: UNLISTED_MISSING_TAGS }])
})

test("scanner lists garbage mp3 as Unlisted with unreadable tags", async () => {
  const dir = await writeTempLibrary([{ path: "trunc.mp3", bytes: "not-id3" }])
  const { files, unlisted } = await scanLibrary(dir)
  expect(files).toEqual([])
  expect(unlisted).toEqual([{ relativePath: "trunc.mp3", reason: UNLISTED_UNREADABLE }])
})

test("scanner lists wav as Unlisted unsupported format", async () => {
  const dir = await writeTempLibrary([{ path: "clip.wav", bytes: "RIFF" }])
  const { files, unlisted } = await scanLibrary(dir)
  expect(files).toEqual([])
  expect(unlisted).toEqual([
    { relativePath: "clip.wav", reason: unsupportedFormatReason("wav") },
  ])
})

test("scanner keeps FLAC as a Track", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-scan-flac-"))
  await Bun.write(
    join(dir, "01-standard.flac"),
    Bun.file(join(LIBRARY, "lossless-suite/01-standard.flac")),
  )
  const { files, unlisted } = await scanLibrary(dir)
  expect(unlisted).toEqual([])
  expect(files).toHaveLength(1)
  expect(files[0]?.extension).toBe("flac")
  expect(files[0]?.tags?.title).toBe("Standard")
})

test("scanner ignores Companion images, notes, playlists, and hidden files", async () => {
  const dir = await writeTempLibrary([
    { path: "cover.jpg", bytes: "jpeg" },
    { path: "notes.txt", bytes: "notes" },
    { path: "album.md", bytes: "md" },
    { path: "disc.nfo", bytes: "nfo" },
    { path: "disc.cue", bytes: "cue" },
    { path: "rip.log", bytes: "log" },
    { path: "booklet.pdf", bytes: "pdf" },
    { path: "album.m3u", bytes: "#EXTM3U" },
    { path: "album.pls", bytes: "[playlist]" },
    { path: "odd.zip", bytes: "PK" },
  ])
  await mkdir(join(dir, ".hidden"))
  await Bun.write(join(dir, ".hidden", "secret.mp3"), "ID3")
  await Bun.write(join(dir, ".DS_Store"), "store")
  const { files, unlisted } = await scanLibrary(dir)
  expect(files).toEqual([])
  expect(unlisted).toEqual([{ relativePath: "odd.zip", reason: unsupportedFormatReason("zip") }])
})
