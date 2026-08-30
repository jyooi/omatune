import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { serializePlayCounts, type PlayCountsEntry } from "@omatune/device-database"
import { Either, ParseResult, Schema } from "effect"

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
  return { version: 1, tracks: {} }
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
    value: { version: 1, tracks: decoded.right.tracks },
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
  return `${JSON.stringify({ version: 1, tracks }, null, 2)}\n`
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
