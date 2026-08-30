import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  parseItunesdb,
  parsePlayCounts,
  playCountsForTracks,
  tracksOf,
  type PlayCountsEntry,
  type Track,
} from "@omatune/device-database"
import { ITUNESDB, PLAY_COUNTS, pathExists } from "./device-fs.ts"
import type { Ledger, LedgerEntry } from "./ledger.ts"
import type { PlanKind } from "./plan.ts"
import {
  hashPlayCountsBytes,
  mergePlayDataEntry,
  withMergedPlayCounts,
  withPlayDataEntry,
  type PlayDataFile,
  type WrittenEcho,
} from "./play-data.ts"
import type { SelectedTrack } from "./rules.ts"

export const FOREIGN_READ_BACK_SKIP = "Read-back skipped: Device is foreign."

export type ReadBackRequest = {
  readonly kind: PlanKind
  readonly serial: string
  readonly mountPoint: string
  readonly dataDir: string
  readonly ledger: Ledger | null
  readonly hashes: ReadonlyMap<string, string>
  readonly selected: ReadonlyArray<SelectedTrack>
  readonly strict: boolean
  readonly now: number
}

export type ReadBackMessage = {
  readonly text: string
  readonly level: "info" | "warning"
}

export type ReadBackResult = {
  readonly playData: PlayDataFile
  readonly consumedPlayCounts: boolean
  readonly changed: boolean
  readonly messages: ReadonlyArray<ReadBackMessage>
  readonly strictFail: string | null
}

export function slashDevicePath(devicePath: string): string {
  return devicePath.replaceAll(":", "/").replace(/^\//, "")
}

export function fileNameHashPrefix(devicePath: string): string | null {
  const base = slashDevicePath(devicePath).split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  const stem = dot <= 0 ? base : base.slice(0, dot)
  if (!/^[0-9a-fA-F]{16}$/.test(stem)) {
    return null
  }
  return stem.toLowerCase()
}

export function hashPrefixMap(
  hashes: ReadonlyMap<string, string>,
  ledger: Ledger | null,
  playData: PlayDataFile,
): Map<string, string> {
  const out = new Map<string, string>()
  const add = (sha256: string) => {
    if (sha256.length < 16) {
      return
    }
    const prefix = sha256.slice(0, 16).toLowerCase()
    if (!out.has(prefix)) {
      out.set(prefix, sha256)
    }
  }
  for (const sha256 of hashes.values()) {
    add(sha256)
  }
  for (const entry of ledger?.tracks ?? []) {
    add(entry.sha256)
  }
  for (const sha256 of Object.keys(playData.tracks)) {
    add(sha256)
  }
  return out
}

export function matchReadBackHash(
  itunesPath: string,
  ledgerByDevicePath: ReadonlyMap<string, LedgerEntry>,
  prefixes: ReadonlyMap<string, string>,
): string | null {
  const slash = slashDevicePath(itunesPath)
  const fromLedger = ledgerByDevicePath.get(slash)
  if (fromLedger) {
    return fromLedger.sha256
  }
  const prefix = fileNameHashPrefix(slash)
  if (!prefix) {
    return null
  }
  return prefixes.get(prefix) ?? null
}

export async function countPlayCountsEntries(mountPoint: string): Promise<number> {
  const path = join(mountPoint, PLAY_COUNTS)
  if (!(await pathExists(path))) {
    return 0
  }
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  const parsed = parsePlayCounts(bytes)
  if (!parsed.ok) {
    return 0
  }
  return parsed.value.entries.length
}

export async function runPlayDataReadBack(
  request: ReadBackRequest,
  playData: PlayDataFile,
): Promise<ReadBackResult> {
  if (request.kind === "wipe") {
    return {
      playData,
      consumedPlayCounts: false,
      changed: false,
      messages: [{ text: FOREIGN_READ_BACK_SKIP, level: "info" }],
      strictFail: null,
    }
  }
  const playCountsPath = join(request.mountPoint, PLAY_COUNTS)
  if (!(await pathExists(playCountsPath))) {
    return {
      playData,
      consumedPlayCounts: false,
      changed: false,
      messages: [],
      strictFail: null,
    }
  }
  const bytes = new Uint8Array(await Bun.file(playCountsPath).arrayBuffer())
  const digest = hashPlayCountsBytes(bytes)
  if (playData.mergedPlayCounts[request.serial] === digest) {
    return {
      playData,
      consumedPlayCounts: true,
      changed: false,
      messages: [],
      strictFail: null,
    }
  }
  const parsed = parsePlayCounts(bytes)
  if (!parsed.ok) {
    const failed = await copyCorruptPlayCounts(request, bytes)
    const messages: ReadBackMessage[] = [
      { text: `Play Counts is corrupt. Copied to ${failed}.`, level: "warning" },
    ]
    const text = messages[0]?.text ?? "Play Counts is corrupt."
    return {
      playData,
      consumedPlayCounts: false,
      changed: false,
      messages,
      strictFail: request.strict ? text : null,
    }
  }
  const itunesPath = join(request.mountPoint, ITUNESDB)
  if (!(await pathExists(itunesPath))) {
    return {
      playData,
      consumedPlayCounts: false,
      changed: false,
      messages: [],
      strictFail: null,
    }
  }
  let tracks: Track[]
  try {
    const dbBytes = new Uint8Array(await Bun.file(itunesPath).arrayBuffer())
    tracks = tracksOf(parseItunesdb(dbBytes))
  } catch {
    return {
      playData,
      consumedPlayCounts: false,
      changed: false,
      messages: [],
      strictFail: null,
    }
  }
  const ledgerByDevicePath = new Map<string, LedgerEntry>()
  for (const entry of request.ledger?.tracks ?? []) {
    ledgerByDevicePath.set(slashDevicePath(entry.devicePath), entry)
  }
  const prefixes = hashPrefixMap(request.hashes, request.ledger, playData)
  const selectedByPath = new Map(request.selected.map((track) => [track.relativePath, track]))
  const selectedByHash = new Map<string, SelectedTrack>()
  for (const [path, sha256] of request.hashes) {
    const selected = selectedByPath.get(path)
    if (selected) {
      selectedByHash.set(sha256, selected)
    }
  }
  let next = playData
  let changed = false
  const paired = playCountsForTracks(parsed.value, tracks)
  for (const { track, entry } of paired) {
    const sha256 = matchReadBackHash(track.devicePath, ledgerByDevicePath, prefixes)
    if (!sha256) {
      continue
    }
    const ledgerEntry = ledgerByDevicePath.get(slashDevicePath(track.devicePath))
    const selected =
      (ledgerEntry ? selectedByPath.get(ledgerEntry.libraryPath) : undefined) ??
      selectedByHash.get(sha256)
    const path =
      ledgerEntry?.libraryPath ??
      selected?.relativePath ??
      next.tracks[sha256]?.path ??
      slashDevicePath(track.devicePath)
    const merged = mergePlayDataEntry(next.tracks[sha256], deltaOf(entry), echoOf(ledgerEntry), path)
    next = withPlayDataEntry(next, sha256, merged)
    changed = true
  }
  if (changed) {
    next = withMergedPlayCounts(next, request.serial, digest)
  }
  return {
    playData: next,
    consumedPlayCounts: true,
    changed,
    messages: [],
    strictFail: null,
  }
}

function deltaOf(entry: PlayCountsEntry): {
  playCount: number
  skipCount: number
  rating: number
  lastPlayed: number
  lastSkipped: number
  bookmark: number
} {
  return {
    playCount: entry.playCount,
    skipCount: entry.skipCount,
    rating: entry.rating,
    lastPlayed: entry.lastPlayed,
    lastSkipped: entry.lastSkipped,
    bookmark: entry.bookmark,
  }
}

function echoOf(entry: LedgerEntry | undefined): WrittenEcho | undefined {
  if (!entry) {
    return undefined
  }
  return {
    writtenRating: entry.writtenRating,
    lastPlayed: entry.lastPlayed,
    bookmark: entry.bookmark,
  }
}

async function copyCorruptPlayCounts(request: ReadBackRequest, bytes: Uint8Array): Promise<string> {
  const dir = join(request.dataDir, "read-back-failed")
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${request.serial}-${request.now}.bin`)
  await Bun.write(path, bytes)
  return path
}
