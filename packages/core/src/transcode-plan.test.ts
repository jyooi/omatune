import { expect, test } from "bun:test"
import { buildPlan } from "./plan.ts"
import { evaluateSelection } from "./rules.ts"
import type { ScannedFile } from "./scan.ts"
import type { TrackTags } from "./tags.ts"
import {
  TRANSCODE_CEILING,
  TRANSCODE_SIZE_MARGIN,
  deviceExtensionFor,
  estimatedTranscodedSize,
  isTranscodedExtension,
  transcodeRouteFor,
} from "./transcode-plan.ts"

function tags(title: string): TrackTags {
  return {
    title,
    artist: "Björk",
    album: "Lossless Suite",
    albumArtist: "Björk",
    track: 1,
    trackTotal: 2,
    disc: 1,
    discTotal: 1,
    compilation: false,
    hasArtwork: false,
    artworkMime: null,
    artworkBytes: null,
    codec: "flac",
    gapless: null,
    durationSeconds: 2,
  }
}

function file(path: string, extension: string, size: number): ScannedFile {
  return { relativePath: path, size, mtimeMs: 1, extension, tags: tags(path) }
}

const SELECTION = {
  version: 1 as const,
  include: [{ kind: "album_artist" as const, albumArtist: "Björk" }],
  exclude: [],
}

test("the ceiling is one constant at 16 bits and 48 kHz", () => {
  expect(TRANSCODE_CEILING).toEqual({ sampleRate: 48000, bitsPerSample: 16 })
})

test("FLAC routes to m4a and nothing else does yet", () => {
  expect(transcodeRouteFor("flac")).toEqual({ from: "flac", to: "m4a", conversion: "flac-alac" })
  expect(transcodeRouteFor(".FLAC")?.to).toBe("m4a")
  expect(transcodeRouteFor("mp3")).toBeNull()
  expect(transcodeRouteFor("ogg")).toBeNull()
  expect(isTranscodedExtension("flac")).toBe(true)
  expect(isTranscodedExtension("m4a")).toBe(false)
  expect(deviceExtensionFor("flac")).toBe("m4a")
  expect(deviceExtensionFor("mp3")).toBe("mp3")
})

test("the estimate adds the safety margin to the source size", () => {
  expect(estimatedTranscodedSize(1000)).toBe(Math.ceil(1000 * (1 + TRANSCODE_SIZE_MARGIN)))
  expect(estimatedTranscodedSize(1000)).toBeGreaterThan(1000)
  expect(estimatedTranscodedSize(0)).toBe(0)
})

test("FLAC is no longer Skipped and other formats still are", () => {
  const files = [
    file("Björk/Lossless Suite/01.flac", "flac", 10_000),
    file("Björk/Lossless Suite/02.mp3", "mp3", 5_000),
    file("Björk/Lossless Suite/03.ogg", "ogg", 4_000),
    file("Björk/Lossless Suite/04.opus", "opus", 3_000),
  ]
  const { selected, skipped } = evaluateSelection(files, SELECTION)
  expect(selected.map((track) => track.relativePath)).toEqual([
    "Björk/Lossless Suite/01.flac",
    "Björk/Lossless Suite/02.mp3",
  ])
  expect(selected.find((track) => track.extension === "flac")?.transcode).toBe(true)
  expect(selected.find((track) => track.extension === "mp3")?.transcode).toBe(false)
  expect(skipped).toEqual([
    { path: "Björk/Lossless Suite/03.ogg", reason: "unsupported_format" },
    { path: "Björk/Lossless Suite/04.opus", reason: "unsupported_format" },
  ])
})

test("a transcoded add takes an m4a Device path built from the source hash", () => {
  const files = [file("Björk/Lossless Suite/01.flac", "flac", 10_000)]
  const { selected, skipped } = evaluateSelection(files, SELECTION)
  const hash = "c".repeat(64)
  const plan = buildPlan({
    kind: "normal",
    selected,
    skipped,
    ledger: null,
    hashes: new Map([["Björk/Lossless Suite/01.flac", hash]]),
    freeBytes: 1_000_000,
    forceModel: null,
  })
  expect(plan.add).toHaveLength(1)
  const add = plan.add[0]
  expect(add?.devicePath).toEndWith(".m4a")
  // Identity stays with the source, so the file name is the source hash.
  expect(add?.devicePath).toContain(hash.slice(0, 16))
  expect(add?.transcode).toBe(true)
  expect(add?.estimated).toBe(true)
  expect(add?.size).toBe(estimatedTranscodedSize(10_000))
  expect(plan.transcodeCount).toBe(1)
})

test("the Plan budgets the estimate and counts only transcoded adds", () => {
  const files = [
    file("Björk/Lossless Suite/01.flac", "flac", 10_000),
    file("Björk/Lossless Suite/02.mp3", "mp3", 5_000),
  ]
  const { selected, skipped } = evaluateSelection(files, SELECTION)
  const plan = buildPlan({
    kind: "normal",
    selected,
    skipped,
    ledger: null,
    hashes: new Map([
      ["Björk/Lossless Suite/01.flac", "c".repeat(64)],
      ["Björk/Lossless Suite/02.mp3", "d".repeat(64)],
    ]),
    freeBytes: 1_000_000,
    forceModel: null,
  })
  expect(plan.transcodeCount).toBe(1)
  expect(plan.bytesNeeded).toBe(estimatedTranscodedSize(10_000) + 5_000)
  expect(plan.add.find((track) => track.path.endsWith(".mp3"))?.estimated).toBe(false)
})

test("a kept Transcode reports the size it really has on the Device", () => {
  const files = [file("Björk/Lossless Suite/01.flac", "flac", 10_000)]
  const { selected, skipped } = evaluateSelection(files, SELECTION)
  const plan = buildPlan({
    kind: "normal",
    selected,
    skipped,
    ledger: {
      version: 1,
      serial: "0000000000000001",
      libraryRoot: "/library",
      lastCommitTime: 0,
      tracks: [
        {
          libraryPath: "Björk/Lossless Suite/01.flac",
          size: 10_000,
          mtime: 1,
          sha256: "c".repeat(64),
          devicePath: "iPod_Control/Music/F00/cccccccccccccccc.m4a",
          dbid: "1",
          artworkHash: null,
          writtenRating: 0,
          lastPlayed: 0,
          bookmark: 0,
          transcodedSize: 12_345,
          transcodedSha256: "e".repeat(64),
        },
      ],
    },
    hashes: new Map(),
    freeBytes: 1_000_000,
    forceModel: null,
  })
  expect(plan.add).toHaveLength(0)
  expect(plan.keep).toHaveLength(1)
  expect(plan.keep[0]?.size).toBe(12_345)
  expect(plan.keep[0]?.estimated).toBe(false)
  expect(plan.transcodeCount).toBe(0)
})
