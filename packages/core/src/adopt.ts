import { join } from "node:path"
import { presentWithSize } from "./device-fs.ts"
import { freshDbid, type Ledger, type LedgerEntry } from "./ledger.ts"
import { artworkHashOf, devicePathFor } from "./plan.ts"
import type { SelectedTrack } from "./rules.ts"

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
    const devicePath = devicePathFor(sha256, track.extension)
    if (!(await presentWithSize(join(input.mountPoint, devicePath), track.size))) {
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
