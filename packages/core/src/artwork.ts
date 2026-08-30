import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  artworkFormatRows,
  buildArtworkdb,
  imageItems,
  parseArtworkdb,
  rgb888ToRgb565Le,
  serializeArtworkdb,
  type ArtworkFormatRow,
  type FamilyRecord,
} from "@omatune/device-database"
import { ARTWORK_DIR, ARTWORKDB, writeFileAtomic } from "./device-fs.ts"
import {
  decodeEmbeddedImage,
  resizeRgba,
  rgbaToRgb888,
  type DecodeImageFailure,
  type ImageRgba,
} from "./image.ts"
import type { Ledger } from "./ledger.ts"
import { artworkHashOf } from "./plan.ts"
import type { SelectedTrack } from "./rules.ts"

export { ARTWORK_DIR, ARTWORKDB }

const FIRST_IMAGE_ID = 0x64
const MHFD_HEADER = 132
const MHSD_HEADER = 96
const LIST_HEADER = 92
const MHII_HEADER = 152
const MHNI_HEADER = 76
const MHIF_HEADER = 124
const MHOD_HEADER = 24
const MHOD_BODY_PREFIX = 16
const NAME_UTF16_BYTES = 64
const RESERVE_ALIGN = 512

export type ArtworkTrack = {
  readonly libraryPath: string
  readonly dbid: string
  readonly albumArtist: string
  readonly album: string
  readonly artworkBytes: Uint8Array | null
}

export type ArtworkSkipReason = DecodeImageFailure["reason"] | "disk_full"

export type ArtworkSkip = {
  readonly path: string
  readonly reason: ArtworkSkipReason
}

export type ArtworkWriteInput = {
  readonly mountPoint: string
  readonly family: FamilyRecord
  readonly tracks: ReadonlyArray<ArtworkTrack>
  readonly cacheDir: string
  readonly priorHashes?: ReadonlyMap<string, string | null>
  readonly spaceRemaining?: number
}

export type ArtworkWriteResult = {
  readonly dbidsWithArtwork: ReadonlySet<string>
  readonly hashes: ReadonlyMap<string, string | null>
  readonly skipped: ReadonlyArray<ArtworkSkip>
  readonly wrote: boolean
}

export function artworkIthmbAlbumBytes(rows: ReadonlyArray<ArtworkFormatRow>): number {
  return rows.reduce((sum, row) => sum + row.blockBytes, 0)
}

export function artworkDbReserveBytes(imageCount: number, formatCount: number): number {
  const count = Math.max(0, Math.floor(imageCount))
  const formats = Math.max(0, Math.floor(formatCount))
  const nameMhod = MHOD_HEADER + MHOD_BODY_PREFIX + NAME_UTF16_BYTES
  const perThumb = MHOD_HEADER + MHNI_HEADER + nameMhod
  const perImage = MHII_HEADER + perThumb * formats
  const fixed =
    MHFD_HEADER + 3 * MHSD_HEADER + 3 * LIST_HEADER + MHIF_HEADER * formats
  return roundUp(fixed, RESERVE_ALIGN) + roundUp(perImage, RESERVE_ALIGN) * count
}

export function artworkCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OMATUNE_CACHE && env.OMATUNE_CACHE.length > 0) {
    return join(env.OMATUNE_CACHE, "artwork")
  }
  if (env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0) {
    return join(env.XDG_CACHE_HOME, "omatune", "artwork")
  }
  return join(homedir(), ".cache", "omatune", "artwork")
}

export function tracksForArtwork(
  ledger: Ledger,
  selectedByPath: ReadonlyMap<string, SelectedTrack>,
): ArtworkTrack[] {
  const out: ArtworkTrack[] = []
  for (const entry of ledger.tracks) {
    const selected = selectedByPath.get(entry.libraryPath)
    if (!selected) {
      continue
    }
    out.push({
      libraryPath: entry.libraryPath,
      dbid: entry.dbid,
      albumArtist: selected.albumArtist,
      album: selected.album,
      artworkBytes: selected.tags.artworkBytes,
    })
  }
  return out
}

export async function writeDeviceArtwork(input: ArtworkWriteInput): Promise<ArtworkWriteResult> {
  const hashes = new Map<string, string | null>()
  for (const track of input.tracks) {
    hashes.set(track.libraryPath, artworkHashOf(track.artworkBytes))
  }
  const skipped: ArtworkSkip[] = []
  const rows = artworkFormatRows[input.family.family] ?? []
  if (!input.family.colourScreen || rows.length === 0) {
    return { dbidsWithArtwork: new Set(), hashes, skipped, wrote: false }
  }
  if (
    input.priorHashes &&
    !hashesDiffer(hashes, input.priorHashes) &&
    !(await artworkFilesMissing(input.mountPoint, rows))
  ) {
    return { dbidsWithArtwork: new Set(), hashes, skipped, wrote: false }
  }
  const groups = albumGroups(input.tracks)
  const dbidsWithArtwork = new Set<string>()
  const failed = new Set<string>()
  let remaining =
    input.spaceRemaining === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.spaceRemaining)
  let reservedImages = 0
  const images: Array<{
    dbid: bigint
    thumbs: Array<{
      formatId: number
      offset: number
      size: number
      width: number
      height: number
      fileName: string
    }>
  }> = []
  const offsets = new Map<number, number>()
  const ithmb = new Map<number, Uint8Array[]>()
  for (const row of rows) {
    offsets.set(row.id, 0)
    ithmb.set(row.id, [])
  }
  for (const group of groups) {
    let blocks: Map<number, Uint8Array> | null = null
    for (const track of group.tracks) {
      const bytes = track.artworkBytes
      if (!bytes || bytes.byteLength === 0) {
        continue
      }
      const decoded = decodeEmbeddedImage(bytes)
      if (!decoded.ok) {
        skipped.push({ path: track.libraryPath, reason: decoded.reason })
        failed.add(track.libraryPath)
        continue
      }
      if (!blocks) {
        const encoded = await encodeAlbum(bytes, rows, input.cacheDir, decoded.image)
        if (!encoded.ok) {
          skipped.push({ path: track.libraryPath, reason: encoded.reason })
          failed.add(track.libraryPath)
          continue
        }
        blocks = encoded.blocks
      }
    }
    if (!blocks) {
      continue
    }
    const ready = group.tracks.filter(
      (track) =>
        track.artworkBytes !== null &&
        track.artworkBytes.byteLength > 0 &&
        !failed.has(track.libraryPath),
    )
    const dbBefore = artworkDbReserveBytes(reservedImages, rows.length)
    const dbAfter = artworkDbReserveBytes(reservedImages + ready.length, rows.length)
    const cost = artworkIthmbAlbumBytes(rows) + (dbAfter - dbBefore)
    if (cost > remaining) {
      for (const track of ready) {
        skipped.push({ path: track.libraryPath, reason: "disk_full" })
      }
      continue
    }
    remaining -= cost
    reservedImages += ready.length
    const albumOffsets = new Map<number, number>()
    for (const row of rows) {
      const block = blocks.get(row.id)
      if (!block) {
        continue
      }
      const list = ithmb.get(row.id)
      if (!list) {
        continue
      }
      const offset = offsets.get(row.id) ?? 0
      albumOffsets.set(row.id, offset)
      list.push(block)
      offsets.set(row.id, offset + row.blockBytes)
    }
    for (const track of group.tracks) {
      if (!track.artworkBytes || track.artworkBytes.byteLength === 0) {
        continue
      }
      if (failed.has(track.libraryPath)) {
        continue
      }
      dbidsWithArtwork.add(track.dbid)
      images.push({
        dbid: BigInt(track.dbid),
        thumbs: rows.map((row) => ({
          formatId: row.id,
          offset: albumOffsets.get(row.id) ?? 0,
          size: row.blockBytes,
          width: row.width,
          height: row.height,
          fileName: ithmbName(row.id),
        })),
      })
    }
  }
  if (images.length === 0 && input.spaceRemaining !== undefined) {
    const emptyCost = artworkDbReserveBytes(0, rows.length)
    if (emptyCost > Math.max(0, input.spaceRemaining) || skipped.some((skip) => skip.reason === "disk_full")) {
      return { dbidsWithArtwork, hashes, skipped, wrote: false }
    }
  }
  const db = buildArtworkdb(
    images.map((image, index) => ({
      dbid: image.dbid,
      imageId: FIRST_IMAGE_ID + index,
      thumbs: image.thumbs,
    })),
    rows.map((row) => ({ formatId: row.id, imageSize: row.blockBytes })),
  )
  const artworkRoot = join(input.mountPoint, ARTWORK_DIR)
  await mkdir(artworkRoot, { recursive: true })
  await writeFileAtomic(join(input.mountPoint, ARTWORKDB), serializeArtworkdb(db))
  for (const row of rows) {
    const blocks = ithmb.get(row.id) ?? []
    if (blocks.length === 0) {
      continue
    }
    await writeFileAtomic(join(artworkRoot, fileNameOf(row.id)), concat(blocks))
  }
  return { dbidsWithArtwork, hashes, skipped, wrote: true }
}

type AlbumGroup = {
  readonly key: string
  readonly tracks: ReadonlyArray<ArtworkTrack>
}

function albumGroups(tracks: ReadonlyArray<ArtworkTrack>): AlbumGroup[] {
  const buckets = new Map<string, ArtworkTrack[]>()
  for (const track of tracks) {
    const key = `${track.albumArtist}\0${track.album}`
    const list = buckets.get(key)
    if (list) {
      list.push(track)
    } else {
      buckets.set(key, [track])
    }
  }
  const groups: AlbumGroup[] = []
  for (const [key, list] of buckets) {
    list.sort((left, right) => left.libraryPath.localeCompare(right.libraryPath))
    groups.push({ key, tracks: list })
  }
  groups.sort((left, right) => {
    const a = left.tracks[0]?.libraryPath ?? left.key
    const b = right.tracks[0]?.libraryPath ?? right.key
    return a.localeCompare(b)
  })
  return groups
}

type EncodedAlbum =
  | { readonly ok: true; readonly blocks: Map<number, Uint8Array> }
  | DecodeImageFailure

async function encodeAlbum(
  bytes: Uint8Array,
  rows: ReadonlyArray<ArtworkFormatRow>,
  cacheDir: string,
  image?: ImageRgba,
): Promise<EncodedAlbum> {
  const hash = createHash("sha256").update(bytes).digest("hex")
  const dir = join(cacheDir, hash)
  const cached = new Map<number, Uint8Array>()
  let missing = false
  for (const row of rows) {
    const file = join(dir, `${row.id}.rgb565`)
    const exists = await Bun.file(file).exists()
    if (!exists) {
      missing = true
      break
    }
    cached.set(row.id, new Uint8Array(await Bun.file(file).arrayBuffer()))
  }
  if (!missing) {
    return { ok: true, blocks: cached }
  }
  let decodedImage = image
  if (!decodedImage) {
    const decoded = decodeEmbeddedImage(bytes)
    if (!decoded.ok) {
      return decoded
    }
    decodedImage = decoded.image
  }
  await mkdir(dir, { recursive: true })
  const blocks = new Map<number, Uint8Array>()
  for (const row of rows) {
    const resized = resizeRgba(decodedImage, row.width, row.height)
    const rgb = rgbaToRgb888(resized.rgba)
    const block = rgb888ToRgb565Le(rgb, row.width, row.height, row.blockBytes)
    blocks.set(row.id, block)
    await writeFileAtomic(join(dir, `${row.id}.rgb565`), block)
  }
  return { ok: true, blocks }
}

function hashesDiffer(
  current: ReadonlyMap<string, string | null>,
  prior: ReadonlyMap<string, string | null>,
): boolean {
  if (current.size !== prior.size) {
    return true
  }
  for (const [path, hash] of current) {
    if (prior.get(path) !== hash) {
      return true
    }
  }
  return false
}

async function artworkFilesMissing(
  mountPoint: string,
  rows: ReadonlyArray<ArtworkFormatRow>,
): Promise<boolean> {
  const dbFile = Bun.file(join(mountPoint, ARTWORKDB))
  if (!(await dbFile.exists())) {
    return true
  }
  let hasRows = false
  try {
    const db = parseArtworkdb(new Uint8Array(await dbFile.arrayBuffer()))
    hasRows = imageItems(db).length > 0
  } catch {
    return true
  }
  if (!hasRows) {
    return false
  }
  for (const row of rows) {
    if (!(await Bun.file(join(mountPoint, ARTWORK_DIR, fileNameOf(row.id))).exists())) {
      return true
    }
  }
  return false
}

function ithmbName(formatId: number): string {
  return `:F${formatId}_1.ithmb`
}

function fileNameOf(formatId: number): string {
  return `F${formatId}_1.ithmb`
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0
  for (const part of parts) {
    total += part.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function roundUp(value: number, unit: number): number {
  if (value <= 0) {
    return 0
  }
  return Math.ceil(value / unit) * unit
}
