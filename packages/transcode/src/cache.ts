import { createHash } from "node:crypto"
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { TRANSCODE_MODULE_VERSION, type AudioCeiling } from "./engine.ts"

/**
 * The Transcode Cache: finished Transcodes kept on the host and reused across
 * Syncs and Devices.
 *
 * The key covers the source content and every parameter that changes the
 * output, the module version included. A change to any of them produces a new
 * key, so a stale entry is never read back.
 *
 * Each entry is a pair. `<key>.m4a` holds the bytes and `<key>.json` records
 * which Library file produced them and what the result hashes to. The sidecar
 * is what lets a Sync prune an entry whose source left the Library without
 * rehashing the whole Library, and what lets a cache hit fill in the Ledger
 * without reading the bytes a second time.
 */

export type TranscodeCacheKeyInput = {
  /** sha256 of the source Track as it sits in the Library. */
  readonly sourceSha256: string
  readonly ceiling: AudioCeiling
  /** Format pair the engine ran, for example `flac-alac`. */
  readonly conversion: string
}

export type TranscodeCacheSource = {
  readonly libraryRoot: string
  readonly libraryPath: string
  readonly size: number
  readonly mtime: number
}

export type TranscodeCacheEntry = {
  readonly source: TranscodeCacheSource
  /** Size and sha256 of the cached bytes, which the Ledger records. */
  readonly size: number
  readonly sha256: string
}

export function transcodeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OMATUNE_CACHE && env.OMATUNE_CACHE.length > 0) {
    return join(env.OMATUNE_CACHE, "transcode")
  }
  if (env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0) {
    return join(env.XDG_CACHE_HOME, "omatune", "transcode")
  }
  return join(homedir(), ".cache", "omatune", "transcode")
}

/** Builds the cache key. Every field that changes the bytes goes in. */
export function transcodeCacheKey(input: TranscodeCacheKeyInput): string {
  const parts = [
    `v${TRANSCODE_MODULE_VERSION}`,
    input.conversion,
    `rate=${input.ceiling.sampleRate}`,
    `bits=${input.ceiling.bitsPerSample}`,
    `src=${input.sourceSha256}`,
  ]
  return createHash("sha256").update(parts.join(" ")).digest("hex")
}

/* Two levels of fan-out keep any one directory small on a large Library. */
export function transcodeCachePath(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.m4a`)
}

export function transcodeSourcePath(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.json`)
}

/**
 * Reports what the cache holds for a key, without reading the audio.
 *
 * A hit answers with the size and the hash the Ledger needs, so the copy step
 * reads the bytes exactly once, on its way to the Device.
 */
export async function lookupTranscodeCache(
  dir: string,
  key: string,
): Promise<TranscodeCacheEntry | null> {
  let size: number
  try {
    const info = await stat(transcodeCachePath(dir, key))
    if (!info.isFile()) {
      return null
    }
    size = info.size
  } catch {
    return null
  }
  const sidecar = await readSidecar(dir, key)
  // Size disagreement means the pair drifted apart, so the entry is not usable.
  if (!sidecar || sidecar.size !== size) {
    return null
  }
  return sidecar
}

export async function readTranscodeCache(dir: string, key: string): Promise<Uint8Array | null> {
  const file = Bun.file(transcodeCachePath(dir, key))
  if (!(await file.exists())) {
    return null
  }
  return file.bytes()
}

async function readSidecar(dir: string, key: string): Promise<TranscodeCacheEntry | null> {
  const file = Bun.file(transcodeSourcePath(dir, key))
  if (!(await file.exists())) {
    return null
  }
  let value: TranscodeCacheEntry
  try {
    value = (await file.json()) as TranscodeCacheEntry
  } catch {
    return null
  }
  if (
    typeof value.sha256 !== "string" ||
    typeof value.size !== "number" ||
    typeof value.source?.libraryRoot !== "string" ||
    typeof value.source?.libraryPath !== "string"
  ) {
    return null
  }
  return value
}

/** Writes through a temporary name so a stopped Sync leaves no partial entry. */
export async function writeTranscodeCache(
  dir: string,
  key: string,
  bytes: Uint8Array,
  source: TranscodeCacheSource,
): Promise<TranscodeCacheEntry> {
  const entry: TranscodeCacheEntry = {
    source,
    size: bytes.length,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  }
  await mkdir(join(dir, key.slice(0, 2)), { recursive: true })
  await writeAtomic(transcodeSourcePath(dir, key), `${JSON.stringify(entry, null, 2)}\n`)
  // The bytes land last, so a reader never finds an entry without its sidecar.
  await writeAtomic(transcodeCachePath(dir, key), bytes)
  return entry
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await Bun.write(temporary, data)
  await rename(temporary, path)
}

/**
 * Drops every entry whose source Track left the Library.
 *
 * Each Sync calls this once. The check reads the sidecar and asks whether the
 * Library file it names is still there at the same size and time. A file that
 * changed has a different content hash, so its entry has a different key and
 * this entry is dead either way.
 *
 * Returns the number of entries removed.
 */
export async function pruneTranscodeCache(dir: string): Promise<number> {
  let removed = 0
  let buckets: string[]
  try {
    buckets = await readdir(dir)
  } catch {
    return 0
  }
  for (const bucket of buckets) {
    let entries: string[]
    try {
      entries = await readdir(join(dir, bucket))
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, bucket, entry)
      if (entry.endsWith(".tmp")) {
        // A leftover from a stopped Sync is not an entry.
        await removeQuiet(path)
        continue
      }
      if (!entry.endsWith(".m4a")) {
        continue
      }
      const key = entry.slice(0, entry.length - ".m4a".length)
      if (await sourceIsLive(dir, key)) {
        continue
      }
      await removeQuiet(transcodeSourcePath(dir, key))
      if (await removeQuiet(path)) {
        removed += 1
      }
    }
  }
  return removed
}

async function sourceIsLive(dir: string, key: string): Promise<boolean> {
  // An entry with no readable sidecar cannot be traced to a Library file.
  const entry = await readSidecar(dir, key)
  if (!entry) {
    return false
  }
  const source = entry.source
  try {
    const info = await stat(join(source.libraryRoot, source.libraryPath))
    return info.isFile() && info.size === source.size && info.mtimeMs === source.mtime
  } catch {
    return false
  }
}

async function removeQuiet(path: string): Promise<boolean> {
  try {
    await unlink(path)
    return true
  } catch {
    return false
  }
}
