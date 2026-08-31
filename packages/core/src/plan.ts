import { createHash } from "node:crypto"
import { join } from "node:path"
import { allFamilies, lookupByLibgpodKey, lookupByModelNumStr } from "@omatune/device-database"
import type { FamilyRecord } from "@omatune/device-database"
import type { OwnerState } from "./device-report.ts"
import type { Ledger, LedgerEntry } from "./ledger.ts"
import type { SelectedTrack, SkippedTrack } from "./rules.ts"
import type { UnlistedFile } from "./scan.ts"
import { deviceExtensionFor, estimatedTranscodedSize } from "./transcode-plan.ts"

export type PlanKind = "normal" | "wipe" | "adoption"

export type PlannedTrack = {
  readonly path: string
  readonly devicePath: string
  readonly size: number
  /** True when a Sync transcodes this Track before it reaches the Device. */
  readonly transcode: boolean
  /** True when `size` is a budget estimate rather than a measured size. */
  readonly estimated: boolean
}

export type SyncPlan = {
  readonly kind: PlanKind
  readonly add: ReadonlyArray<PlannedTrack>
  readonly remove: ReadonlyArray<PlannedTrack>
  readonly keep: ReadonlyArray<PlannedTrack>
  readonly skipped: ReadonlyArray<SkippedTrack>
  readonly bytesNeeded: number
  readonly freeSpaceAfter: number
  readonly forceModel: string | null
  readonly playCountsPending: number
  /** Adds that a Transcode produces, counted for the Plan summary. */
  readonly transcodeCount: number
  readonly unlisted: ReadonlyArray<UnlistedFile>
}

const FOLDER_COUNT = 50

export function resolveForceModel(key: string): FamilyRecord | undefined {
  const byKey = lookupByLibgpodKey(key)
  if (byKey) {
    return byKey
  }
  const byModel = lookupByModelNumStr(key)
  if (byModel) {
    return byModel
  }
  const needle = key.trim().toLowerCase()
  return allFamilies().find((family) => family.family.toLowerCase() === needle)
}

export function planKind(input: {
  readonly ownerState: OwnerState
  readonly hasLedger: boolean
}): PlanKind {
  if (input.ownerState === "foreign") {
    return "wipe"
  }
  if (input.ownerState === "omatune" && !input.hasLedger) {
    return "adoption"
  }
  return "normal"
}

export function devicePathFor(sha256: string, extension: string): string {
  const folder = Number.parseInt(sha256.slice(0, 8), 16) % FOLDER_COUNT
  const name = sha256.slice(0, 16)
  const ext = extension.replace(/^\./, "").toLowerCase()
  return `iPod_Control/Music/F${String(folder).padStart(2, "0")}/${name}.${ext}`
}

export async function sha256File(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  return createHash("sha256").update(bytes).digest("hex")
}

const HASH_WIDTH = 4

export async function hashesForAdds(
  libraryRoot: string,
  selected: ReadonlyArray<SelectedTrack>,
  ledger: Ledger | null,
): Promise<ReadonlyMap<string, string>> {
  const ledgerByPath = new Map((ledger?.tracks ?? []).map((entry) => [entry.libraryPath, entry]))
  const pending: SelectedTrack[] = []
  for (const track of selected) {
    const prior = ledgerByPath.get(track.relativePath)
    const unchanged =
      prior !== undefined && prior.size === track.size && prior.mtime === track.mtimeMs
    if (!unchanged) {
      pending.push(track)
    }
  }
  const hashes = new Map<string, string>()
  await runPool(pending, HASH_WIDTH, async (track) => {
    hashes.set(track.relativePath, await sha256File(join(libraryRoot, track.relativePath)))
  })
  return hashes
}

export async function runPool<T>(
  items: ReadonlyArray<T>,
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, width)
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size)
    await Promise.all(slice.map((item) => fn(item)))
  }
}

export function artworkHashOf(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) {
    return null
  }
  return createHash("sha256").update(bytes).digest("hex")
}

export function buildPlan(input: {
  readonly kind: PlanKind
  readonly selected: ReadonlyArray<SelectedTrack>
  readonly skipped: ReadonlyArray<SkippedTrack>
  readonly ledger: Ledger | null
  readonly hashes: ReadonlyMap<string, string>
  readonly freeBytes: number
  readonly forceModel: string | null
  readonly playCountsPending?: number
  readonly unlisted?: ReadonlyArray<UnlistedFile>
}): SyncPlan {
  const ledgerTracks = input.ledger?.tracks ?? []
  const ledgerByPath = new Map<string, LedgerEntry>()
  for (const entry of ledgerTracks) {
    ledgerByPath.set(entry.libraryPath, entry)
  }
  const selectedPaths = new Set(input.selected.map((track) => track.relativePath))
  const add: PlannedTrack[] = []
  const keep: PlannedTrack[] = []
  for (const track of input.selected) {
    const prior = ledgerByPath.get(track.relativePath)
    const unchanged =
      prior !== undefined && prior.size === track.size && prior.mtime === track.mtimeMs
    if (unchanged && prior) {
      keep.push({
        path: track.relativePath,
        devicePath: prior.devicePath,
        // A kept Transcode already sits on the Device at its real size.
        size: prior.transcodedSize ?? track.size,
        transcode: track.transcode,
        estimated: false,
      })
      continue
    }
    const sha256 = input.hashes.get(track.relativePath) ?? prior?.sha256
    const hash = sha256 ?? ""
    add.push({
      path: track.relativePath,
      devicePath: devicePathFor(hash, deviceExtensionFor(track.extension)),
      size: track.transcode ? estimatedTranscodedSize(track.size) : track.size,
      transcode: track.transcode,
      estimated: track.transcode,
    })
  }
  const remove: PlannedTrack[] = []
  for (const entry of ledgerTracks) {
    const selected = selectedPaths.has(entry.libraryPath)
    const prior = ledgerByPath.get(entry.libraryPath)
    const current = input.selected.find((track) => track.relativePath === entry.libraryPath)
    const unchanged =
      current !== undefined && prior !== undefined && prior.size === current.size && prior.mtime === current.mtimeMs
    if (!selected || !unchanged) {
      remove.push({
        path: entry.libraryPath,
        devicePath: entry.devicePath,
        size: entry.transcodedSize ?? entry.size,
        transcode: entry.transcodedSize !== undefined,
        estimated: false,
      })
    }
  }
  add.sort(byPath)
  remove.sort(byPath)
  keep.sort(byPath)
  const skipped = [...input.skipped].sort(byPath)
  const bytesNeeded = add.reduce((sum, track) => sum + track.size, 0)
  const bytesFreed = remove.reduce((sum, track) => sum + track.size, 0)
  return {
    kind: input.kind,
    add,
    remove,
    keep,
    skipped,
    bytesNeeded,
    freeSpaceAfter: input.freeBytes - bytesNeeded + bytesFreed,
    forceModel: input.forceModel,
    playCountsPending: input.playCountsPending ?? 0,
    transcodeCount: add.filter((track) => track.transcode).length,
    unlisted: input.unlisted ?? [],
  }
}

function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path)
}
