import { stat } from "node:fs/promises"
import { join } from "node:path"
import { presentWithSize } from "./device-fs.ts"
import { freshDbid, type Ledger, type LedgerEntry } from "./ledger.ts"
import { artworkHashOf, devicePathFor } from "./plan.ts"
import type { SelectedTrack } from "./rules.ts"
import { deviceExtensionFor } from "./transcode-plan.ts"

export async function adoptLedger(input: {
  readonly serial: string
  readonly libraryRoot: string
  readonly mountPoint: string
  readonly selected: ReadonlyArray<SelectedTrack>
  readonly hashes: ReadonlyMap<string, string>
  readonly now: number
}): Promise<Ledger> {
  const used = new Set<string>()
  const tracks: LedgerEntry[] = []
  for (const track of input.selected) {
    const sha256 = input.hashes.get(track.relativePath)
    if (!sha256) {
      continue
    }
    const devicePath = devicePathFor(sha256, deviceExtensionFor(track.extension))
    const absolute = join(input.mountPoint, devicePath)

    /* A Track copied as-is must match its Library size exactly. A Transcode
     * cannot: the Device file is a different encoding of the same Track, so
     * adoption reads the size and the hash off the Device instead. */
    let transcoded: { size: number; sha256: string } | null = null
    if (track.transcode) {
      transcoded = await adoptedTranscode(absolute)
      if (!transcoded) {
        continue
      }
    } else if (!(await presentWithSize(absolute, track.size))) {
      continue
    }

    tracks.push({
      libraryPath: track.relativePath,
      size: track.size,
      mtime: track.mtimeMs,
      sha256,
      devicePath,
      dbid: freshDbid(used),
      artworkHash: artworkHashOf(track.tags.artworkBytes),
      writtenRating: null,
      lastPlayed: null,
      bookmark: null,
      ...(transcoded
        ? { transcodedSize: transcoded.size, transcodedSha256: transcoded.sha256 }
        : {}),
    })
  }
  tracks.sort((left, right) => left.libraryPath.localeCompare(right.libraryPath))
  return {
    version: 1,
    serial: input.serial,
    libraryRoot: input.libraryRoot,
    lastCommitTime: input.now,
    tracks,
  }
}

async function adoptedTranscode(
  path: string,
): Promise<{ size: number; sha256: string } | null> {
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) {
      return null
    }
    size = info.size
  } catch {
    return null
  }
  const bytes = await Bun.file(path).bytes()
  return { size, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
}
