import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  artworkFormatRows,
  buildArtworkdb,
  rgb888ToRgb565Le,
  serializeArtworkdb,
  type ArtworkFormatRow,
  type FamilyRecord,
} from "@omatune/device-database"
import { ARTWORK_DIR, ARTWORKDB, writeFileAtomic } from "./device-fs.ts"
import { decodeEmbeddedImage, resizeRgba, rgbaToRgb888 } from "./image.ts"
import type { Ledger } from "./ledger.ts"
import { artworkHashOf } from "./plan.ts"
import type { SelectedTrack } from "./rules.ts"

export { ARTWORK_DIR, ARTWORKDB }

const FIRST_IMAGE_ID = 0x64

export type ArtworkTrack = {
  readonly libraryPath: string
  readonly dbid: string
  readonly albumArtist: string
  readonly album: string
  readonly artworkBytes: Uint8Array | null
}

export type ArtworkWriteInput = {
  readonly mountPoint: string
  readonly family: FamilyRecord
  readonly tracks: ReadonlyArray<ArtworkTrack>
  readonly cacheDir: string
}

export type ArtworkWriteResult = {
  readonly dbidsWithArtwork: ReadonlySet<string>
  readonly hashes: ReadonlyMap<string, string | null>
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
  const rows = artworkFormatRows[input.family.family] ?? []
  if (!input.family.colourScreen || rows.length === 0) {
    return { dbidsWithArtwork: new Set(), hashes }
  }
  const groups = albumGroups(input.tracks)
  const dbidsWithArtwork = new Set<string>()
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
    const source = group.source
    if (!source) {
      continue
    }
    const blocks = await encodeAlbum(source, rows, input.cacheDir)
    if (!blocks) {
      continue
    }
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
  return { dbidsWithArtwork, hashes }
}

type AlbumGroup = {
  readonly key: string
  readonly source: Uint8Array | null
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
    let source: Uint8Array | null = null
    for (const track of list) {
      if (track.artworkBytes && track.artworkBytes.byteLength > 0) {
        source = track.artworkBytes
        break
      }
    }
    groups.push({ key, source, tracks: list })
  }
  groups.sort((left, right) => {
    const a = left.tracks[0]?.libraryPath ?? left.key
    const b = right.tracks[0]?.libraryPath ?? right.key
    return a.localeCompare(b)
  })
  return groups
}

async function encodeAlbum(
  bytes: Uint8Array,
  rows: ReadonlyArray<ArtworkFormatRow>,
  cacheDir: string,
): Promise<Map<number, Uint8Array> | null> {
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
    return cached
  }
  const decoded = decodeEmbeddedImage(bytes)
  if (!decoded.ok) {
    return null
  }
  await mkdir(dir, { recursive: true })
  const blocks = new Map<number, Uint8Array>()
  for (const row of rows) {
    const resized = resizeRgba(decoded.image, row.width, row.height)
    const rgb = rgbaToRgb888(resized.rgba)
    const block = rgb888ToRgb565Le(rgb, row.width, row.height, row.blockBytes)
    blocks.set(row.id, block)
    await writeFileAtomic(join(dir, `${row.id}.rgb565`), block)
  }
  return blocks
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
