import { createHash } from "node:crypto"
import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { serializePlayCounts, type PlayCountsEntry } from "@omatune/device-database"
import { Either, ParseResult, Schema } from "effect"
import type { Ledger } from "./ledger.ts"

export type HostPlayData = {
  readonly playCount: number
  readonly skipCount: number
  readonly rating: number
  readonly lastPlayed: number
  readonly lastSkipped: number
  readonly bookmark: number
  readonly path: string
}

export type PlayDataFile = {
  readonly version: 1
  readonly tracks: { readonly [sha256: string]: HostPlayData }
  readonly mergedPlayCounts: { readonly [serial: string]: string }
}

export type PlayDataIssue = {
  readonly file: string
  readonly line: number
  readonly reason: string
}

export type WrittenEcho = {
  readonly writtenRating: number | null
  readonly lastPlayed: number | null
  readonly bookmark: number | null
}

export type DevicePlayDelta = {
  readonly playCount: number
  readonly skipCount: number
  readonly rating: number
  readonly lastPlayed: number
  readonly lastSkipped: number
  readonly bookmark: number
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: PlayDataIssue }

const EntrySchema = Schema.Struct({
  playCount: Schema.Number,
  skipCount: Schema.Number,
  rating: Schema.Number,
  lastPlayed: Schema.Number,
  lastSkipped: Schema.Number,
  bookmark: Schema.Number,
  path: Schema.String,
})

const FileSchema = Schema.Struct({
  version: Schema.Number,
  tracks: Schema.Record({ key: Schema.String, value: EntrySchema }),
  mergedPlayCounts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})

export const ZERO_PLAY_DATA: HostPlayData = {
  playCount: 0,
  skipCount: 0,
  rating: 0,
  lastPlayed: 0,
  lastSkipped: 0,
  bookmark: 0,
  path: "",
}

export function resolveDataDir(input: {
  readonly xdgDataHome?: string | undefined
  readonly home?: string | undefined
  readonly platform?: string | undefined
}): string {
  const xdg = input.xdgDataHome
  if (xdg && xdg.length > 0) {
    return join(xdg, "omatune")
  }
  const home = input.home && input.home.length > 0 ? input.home : "."
  const platform = input.platform ?? process.platform
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "omatune")
  }
  return join(home, ".local", "share", "omatune")
}

export function playDataPath(dir: string): string {
  return join(dir, "play-data.json")
}

export function emptyPlayData(): PlayDataFile {
  return { version: 1, tracks: {}, mergedPlayCounts: {} }
}

export function hashPlayCountsBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function playDataNeedsWriteback(playData: PlayDataFile, ledger: Ledger | null): boolean {
  for (const entry of ledger?.tracks ?? []) {
    const host = playData.tracks[entry.sha256]
    if (!host) {
      continue
    }
    if (
      host.playCount !== (entry.writtenPlayCount ?? 0) ||
      host.skipCount !== (entry.writtenSkipCount ?? 0) ||
      host.rating !== (entry.writtenRating ?? 0) ||
      host.lastPlayed !== (entry.lastPlayed ?? 0) ||
      host.lastSkipped !== (entry.writtenLastSkipped ?? 0) ||
      host.bookmark !== (entry.bookmark ?? 0)
    ) {
      return true
    }
  }
  return false
}

export function playDataOf(file: PlayDataFile, sha256: string): HostPlayData {
  return file.tracks[sha256] ?? { ...ZERO_PLAY_DATA }
}

export function mergePlayDataEntry(
  host: HostPlayData | undefined,
  delta: DevicePlayDelta,
  echo: WrittenEcho | undefined,
  path: string,
): HostPlayData {
  const base = host ?? { ...ZERO_PLAY_DATA, path }
  const writtenRating = echo?.writtenRating ?? 0
  const writtenLastPlayed = echo?.lastPlayed ?? 0
  const writtenBookmark = echo?.bookmark ?? 0
  const rating = delta.rating !== writtenRating ? delta.rating : base.rating
  const lastPlayed =
    delta.lastPlayed !== writtenLastPlayed
      ? Math.max(base.lastPlayed, delta.lastPlayed)
      : base.lastPlayed
  const bookmark = delta.bookmark !== writtenBookmark ? delta.bookmark : base.bookmark
  return {
    playCount: base.playCount + delta.playCount,
    skipCount: base.skipCount + delta.skipCount,
    rating,
    lastPlayed,
    lastSkipped: Math.max(base.lastSkipped, delta.lastSkipped),
    bookmark,
    path: path.length > 0 ? path : base.path,
  }
}

export function withPlayDataEntry(
  file: PlayDataFile,
  sha256: string,
  entry: HostPlayData,
): PlayDataFile {
  return {
    version: 1,
    tracks: { ...file.tracks, [sha256]: entry },
    mergedPlayCounts: file.mergedPlayCounts,
  }
}

export function withMergedPlayCounts(
  file: PlayDataFile,
  serial: string,
  sha256: string,
): PlayDataFile {
  return {
    version: 1,
    tracks: file.tracks,
    mergedPlayCounts: { ...file.mergedPlayCounts, [serial]: sha256 },
  }
}

export function parsePlayDataText(file: string, text: string): Outcome<PlayDataFile> {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { ok: false, issue: { file, line: 1, reason: "Malformed Play Data JSON." } }
  }
  const decoded = Schema.decodeUnknownEither(FileSchema, {
    onExcessProperty: "error",
    errors: "all",
  })(value)
  if (Either.isLeft(decoded)) {
    const issues = ParseResult.ArrayFormatter.formatErrorSync(decoded.left)
    const first = issues[0]
    const reason = first ? first.message : "Invalid Play Data."
    return {
      ok: false,
      issue: { file, line: 1, reason: reason.endsWith(".") ? reason : `${reason}.` },
    }
  }
  if (decoded.right.version !== 1) {
    return {
      ok: false,
      issue: { file, line: 1, reason: `Unsupported version ${decoded.right.version}.` },
    }
  }
  return {
    ok: true,
    value: {
      version: 1,
      tracks: decoded.right.tracks,
      mergedPlayCounts: decoded.right.mergedPlayCounts ?? {},
    },
  }
}

export async function loadPlayData(dir: string): Promise<Outcome<PlayDataFile>> {
  const file = playDataPath(dir)
  const exists = await Bun.file(file).exists()
  if (!exists) {
    return { ok: true, value: emptyPlayData() }
  }
  const text = await Bun.file(file).text()
  return parsePlayDataText(file, text)
}

export function serializePlayData(file: PlayDataFile): string {
  const tracks: Record<string, HostPlayData> = {}
  for (const key of Object.keys(file.tracks).sort()) {
    const entry = file.tracks[key]
    if (entry) {
      tracks[key] = entry
    }
  }
  const mergedPlayCounts: Record<string, string> = {}
  for (const key of Object.keys(file.mergedPlayCounts).sort()) {
    const digest = file.mergedPlayCounts[key]
    if (digest) {
      mergedPlayCounts[key] = digest
    }
  }
  return `${JSON.stringify({ version: 1, tracks, mergedPlayCounts }, null, 2)}\n`
}

export async function writePlayDataAtomic(dir: string, file: PlayDataFile): Promise<void> {
  const path = playDataPath(dir)
  const tmp = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(tmp, serializePlayData(file))
  await rename(tmp, path)
}

export function encodePlayCounts(entries: ReadonlyArray<Partial<PlayCountsEntry>>): Uint8Array {
  const full: PlayCountsEntry[] = entries.map((fields) => ({
    playCount: 0,
    lastPlayed: 0,
    bookmark: 0,
    rating: 0,
    unknown: 0,
    skipCount: 0,
    lastSkipped: 0,
    tail: new Uint8Array(0),
    ...fields,
  }))
  return serializePlayCounts({
    headerLength: 0x60,
    entryLength: 0x1c,
    headerTail: new Uint8Array(0x60 - 16),
    entries: full,
  })
}
