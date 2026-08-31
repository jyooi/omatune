import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  lookupTranscodeCache,
  pruneTranscodeCache,
  readTranscodeCache,
  transcodeCacheDir,
  transcodeCacheKey,
  transcodeCachePath,
  transcodeSourcePath,
  writeTranscodeCache,
} from "./cache.ts"

const CEILING = { sampleRate: 48000, bitsPerSample: 16 }
const BASE = {
  sourceSha256: "a".repeat(64),
  ceiling: CEILING,
  conversion: "flac-alac",
}

const created: string[] = []
function work(): string {
  const dir = mkdtempSync(join(tmpdir(), "omatune-transcode-cache-"))
  created.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the key changes when any part of it changes", () => {
  const key = transcodeCacheKey(BASE)
  expect(key).toMatch(/^[0-9a-f]{64}$/)
  expect(transcodeCacheKey(BASE)).toBe(key)
  expect(transcodeCacheKey({ ...BASE, sourceSha256: "b".repeat(64) })).not.toBe(key)
  expect(
    transcodeCacheKey({ ...BASE, ceiling: { sampleRate: 44100, bitsPerSample: 16 } }),
  ).not.toBe(key)
  expect(
    transcodeCacheKey({ ...BASE, ceiling: { sampleRate: 48000, bitsPerSample: 24 } }),
  ).not.toBe(key)
  expect(transcodeCacheKey({ ...BASE, conversion: "wav-alac" })).not.toBe(key)
})

test("the cache directory follows the same environment as the Artwork cache", () => {
  expect(transcodeCacheDir({ OMATUNE_CACHE: "/c" })).toBe(join("/c", "transcode"))
  expect(transcodeCacheDir({ XDG_CACHE_HOME: "/x" })).toBe(join("/x", "omatune", "transcode"))
})

test("a written entry reads back and reports its size", async () => {
  const dir = work()
  const key = transcodeCacheKey(BASE)
  const bytes = Uint8Array.from([1, 2, 3, 4, 5])
  const library = work()
  writeFileSync(join(library, "song.flac"), "flac")

  expect(await lookupTranscodeCache(dir, key)).toBeNull()
  const written = await writeTranscodeCache(dir, key, bytes, {
    libraryRoot: library,
    libraryPath: "song.flac",
    size: 4,
    mtime: 1,
  })
  const hit = await lookupTranscodeCache(dir, key)
  expect(hit?.size).toBe(5)
  // The hash comes from the sidecar, so a hit never re-reads the audio.
  expect(hit?.sha256).toBe(written.sha256)
  expect(hit?.sha256).toBe(Bun.SHA256.hash(bytes, "hex"))
  expect(hit?.source.libraryPath).toBe("song.flac")
  expect(await readTranscodeCache(dir, key)).toEqual(bytes)
})

test("an entry whose sidecar is missing is not a hit", async () => {
  const dir = work()
  const library = work()
  writeFileSync(join(library, "song.flac"), "flac")
  const key = transcodeCacheKey(BASE)
  await writeTranscodeCache(dir, key, Uint8Array.from([1]), {
    libraryRoot: library,
    libraryPath: "song.flac",
    size: 4,
    mtime: 1,
  })
  rmSync(transcodeSourcePath(dir, key))
  expect(await lookupTranscodeCache(dir, key)).toBeNull()
})

test("a prune keeps an entry whose source Track is still in the Library", async () => {
  const dir = work()
  const library = work()
  const source = join(library, "song.flac")
  writeFileSync(source, "flac bytes")
  const info = await Bun.file(source).stat()

  const key = transcodeCacheKey(BASE)
  await writeTranscodeCache(dir, key, Uint8Array.from([9]), {
    libraryRoot: library,
    libraryPath: "song.flac",
    size: info.size,
    mtime: info.mtimeMs,
  })

  expect(await pruneTranscodeCache(dir)).toBe(0)
  expect((await lookupTranscodeCache(dir, key))?.size).toBe(1)
})

test("a prune drops an entry whose source Track left the Library", async () => {
  const dir = work()
  const library = work()
  const source = join(library, "gone.flac")
  writeFileSync(source, "flac bytes")
  const info = await Bun.file(source).stat()

  const key = transcodeCacheKey(BASE)
  await writeTranscodeCache(dir, key, Uint8Array.from([9]), {
    libraryRoot: library,
    libraryPath: "gone.flac",
    size: info.size,
    mtime: info.mtimeMs,
  })
  rmSync(source)

  expect(await pruneTranscodeCache(dir)).toBe(1)
  expect(await lookupTranscodeCache(dir, key)).toBeNull()
  expect(await Bun.file(transcodeSourcePath(dir, key)).exists()).toBe(false)
})

test("a prune drops an entry whose source Track changed", async () => {
  const dir = work()
  const library = work()
  const source = join(library, "edited.flac")
  writeFileSync(source, "flac bytes")

  const key = transcodeCacheKey(BASE)
  await writeTranscodeCache(dir, key, Uint8Array.from([9]), {
    libraryRoot: library,
    libraryPath: "edited.flac",
    size: 999,
    mtime: 1,
  })

  expect(await pruneTranscodeCache(dir)).toBe(1)
  expect(await lookupTranscodeCache(dir, key)).toBeNull()
})

test("a prune clears a temporary file a stopped Sync left behind", async () => {
  const dir = work()
  const key = transcodeCacheKey(BASE)
  mkdirSync(join(dir, key.slice(0, 2)), { recursive: true })
  const leftover = `${transcodeCachePath(dir, key)}.999.tmp`
  writeFileSync(leftover, "partial")

  await pruneTranscodeCache(dir)
  expect(await Bun.file(leftover).exists()).toBe(false)
})

test("a prune on a directory that does not exist reports nothing removed", async () => {
  expect(await pruneTranscodeCache(join(work(), "absent"))).toBe(0)
})
