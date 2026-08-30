import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  emptyPlayData,
  mergePlayDataEntry,
  playDataPath,
  resolveDataDir,
  serializePlayData,
  writePlayDataAtomic,
  type HostPlayData,
} from "./play-data.ts"
import { fileNameHashPrefix, matchReadBackHash, slashDevicePath } from "./read-back.ts"
import type { LedgerEntry } from "./ledger.ts"

const host: HostPlayData = {
  playCount: 4,
  skipCount: 1,
  rating: 80,
  lastPlayed: 100,
  lastSkipped: 40,
  bookmark: 12,
  path: "a/track.mp3",
}

test("resolveDataDir prefers XDG_DATA_HOME", () => {
  expect(
    resolveDataDir({
      xdgDataHome: "/tmp/xdg-data",
      home: "/home/user",
      platform: "darwin",
    }),
  ).toBe(join("/tmp/xdg-data", "omatune"))
})

test("resolveDataDir uses Application Support on macOS", () => {
  expect(resolveDataDir({ home: "/Users/ada", platform: "darwin" })).toBe(
    join("/Users/ada", "Library", "Application Support", "omatune"),
  )
})

test("resolveDataDir uses .local/share on Linux", () => {
  expect(resolveDataDir({ home: "/home/ada", platform: "linux" })).toBe(
    join("/home/ada", ".local", "share", "omatune"),
  )
})

test("merge adds counts and keeps the later skip time", () => {
  const merged = mergePlayDataEntry(
    host,
    {
      playCount: 2,
      skipCount: 3,
      rating: 80,
      lastPlayed: 100,
      lastSkipped: 90,
      bookmark: 12,
    },
    { writtenRating: 80, lastPlayed: 100, bookmark: 12 },
    "a/track.mp3",
  )
  expect(merged.playCount).toBe(6)
  expect(merged.skipCount).toBe(4)
  expect(merged.lastSkipped).toBe(90)
  expect(merged.rating).toBe(80)
  expect(merged.lastPlayed).toBe(100)
  expect(merged.bookmark).toBe(12)
})

test("Echo keeps rating, last played, and bookmark when they match the Ledger", () => {
  const merged = mergePlayDataEntry(
    host,
    {
      playCount: 1,
      skipCount: 0,
      rating: 80,
      lastPlayed: 100,
      lastSkipped: 0,
      bookmark: 12,
    },
    { writtenRating: 80, lastPlayed: 100, bookmark: 12 },
    "a/track.mp3",
  )
  expect(merged.rating).toBe(80)
  expect(merged.lastPlayed).toBe(100)
  expect(merged.bookmark).toBe(12)
  expect(merged.playCount).toBe(5)
})

test("non-Echo rating and bookmark replace, last played takes the later time", () => {
  const merged = mergePlayDataEntry(
    host,
    {
      playCount: 0,
      skipCount: 0,
      rating: 100,
      lastPlayed: 50,
      lastSkipped: 0,
      bookmark: 3,
    },
    { writtenRating: 80, lastPlayed: 100, bookmark: 12 },
    "a/track.mp3",
  )
  expect(merged.rating).toBe(100)
  expect(merged.bookmark).toBe(3)
  expect(merged.lastPlayed).toBe(100)
})

test("writePlayDataAtomic replaces the host file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-play-data-"))
  await writePlayDataAtomic(dir, {
    version: 1,
    tracks: { ab: { ...host } },
  })
  const text = await Bun.file(playDataPath(dir)).text()
  expect(text).toBe(serializePlayData({ version: 1, tracks: { ab: host } }))
  expect(JSON.parse(text).tracks.ab.playCount).toBe(4)
})

test("emptyPlayData has no Tracks", () => {
  expect(emptyPlayData()).toEqual({ version: 1, tracks: {} })
})

test("Adoption match uses the file-name hash prefix", () => {
  const sha = "abcdef0123456789" + "ff".repeat(16)
  const prefixes = new Map([["abcdef0123456789", sha]])
  const found = matchReadBackHash(
    ":iPod_Control:Music:F00:abcdef0123456789.mp3",
    new Map(),
    prefixes,
  )
  expect(found).toBe(sha)
  expect(fileNameHashPrefix(":iPod_Control:Music:F12:aaaaaaaaaaaaaaaa.m4a")).toBe(
    "aaaaaaaaaaaaaaaa",
  )
  expect(slashDevicePath(":iPod_Control:Music:F00:aa.mp3")).toBe(
    "iPod_Control/Music/F00/aa.mp3",
  )
})

test("Ledger device path wins over the hash prefix", () => {
  const ledgerSha = "11".repeat(32)
  const prefixSha = "22".repeat(32)
  const entry = {
    libraryPath: "a/track.mp3",
    size: 1,
    mtime: 1,
    sha256: ledgerSha,
    devicePath: "iPod_Control/Music/F00/abcdef0123456789.mp3",
    dbid: "1",
    artworkHash: null,
    writtenRating: 0,
    lastPlayed: 0,
    bookmark: 0,
  } satisfies LedgerEntry
  const ledgerByPath = new Map([[entry.devicePath, entry]])
  const prefixes = new Map([["abcdef0123456789", prefixSha]])
  expect(matchReadBackHash(entry.devicePath, ledgerByPath, prefixes)).toBe(ledgerSha)
})
