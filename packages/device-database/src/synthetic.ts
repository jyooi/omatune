/*
 * Synthetic CLASSIC_2 Fixture from the Verification Library.
 *
 * The writer builds iTunesDB, ArtworkDB, and ithmb files.
 * Persistent ids come from a keyed hash of each Track path.
 * Artwork pixels are a flat colour plus album index.
 *
 * The Fixture holds only the Tracks a Sync copies unchanged. A Transcode
 * source such as FLAC reaches a Device as a different file, at a different
 * size, under a different name, so its Library bytes describe nothing the
 * firmware would ever read. Modelling that here would need the Transcode
 * engine, and this package stays free of it.
 */

import { createHash, createHmac } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { buildArtworkdb } from "./artwork-write.ts"
import { serializeArtworkdb } from "./artwork.ts"
import { writeU16, writeU32, writeU64 } from "./bytes.ts"
import { type Chunk } from "./chunk.ts"
import { serializeItunesdb, type Itunesdb } from "./codec.ts"
import {
  MHIT_FILE_TYPE,
  MHIT_GAPLESS_ALBUM_FLAG,
  MHIT_GAPLESS_TRACK_FLAG,
  MHIT_MEDIA_TYPE,
  MHIT_TYPE_1,
  MHIT_TYPE_2,
  MHIT_UNKNOWN_D0,
  MHYP_MASTER_FLAG,
  MHYP_PERSISTENT_ID,
  MHYP_STRING_MHOD_COUNT,
  fileTypeCodeFor,
  formatBytesFor,
} from "./firmware.ts"
import { artworkFormatRows } from "./model/format-table.ts"
import { rgb888ToRgb565Le } from "./ithmb.ts"
import { SCRUB_HMAC_KEY, signScrubbedItunesdb } from "./scrub.ts"

const MHBD_HEADER = 0xf4
const MHSD_HEADER = 96
const MHLT_HEADER = 92
const MHLP_HEADER = 92
const MHIT_HEADER = 624
const MHOD_HEADER = 24
const MHYP_HEADER = 184
const MHIP_HEADER = 76
const VERSION = 0x30
/* A zero media type makes the stock firmware skip the whole Device
 * Database. See HUF-283 and firmware.ts. */
const MEDIA_TYPE_AUDIO = 1
const FOLDER_COUNT = 50
const FIRST_IMAGE_ID = 0x64
const CLASSIC_FAMILY = "iPod classic 120 GB (2008)"

/* Codecs the stock firmware cannot read, which a Sync transcodes on the way
 * to the Device. See `deviceExtensionFor` in packages/core. */
const TRANSCODE_SOURCE_CODECS = new Set(["flac"])

export type ManifestTrack = {
  path: string
  codec: string
  title: string
  artist: string
  album: string
  albumArtist: string
  track: number
  disc: number
  artwork: boolean
  durationSeconds: number
  gapless: {
    encoderDelay: number
    encoderPadding: number
    sampleCount: number
  } | null
}

export type Manifest = {
  tracks: ManifestTrack[]
}

export type SyntheticTrack = ManifestTrack & {
  size: number
  devicePath: string
  dbid: bigint
  sha256: string
}

export async function writeSyntheticFixture(
  audioRoot: string,
  outDir: string,
  manifest: Manifest,
): Promise<string[]> {
  const tracks = await loadTracks(audioRoot, manifest)
  const itunes = signScrubbedItunesdb(serializeItunesdb(buildSyntheticItunesdb(tracks)), "CLASSIC_2")
  await mkdir(join(outDir, "iTunes"), { recursive: true })
  await mkdir(join(outDir, "Artwork"), { recursive: true })
  const written: string[] = []
  const itunesOut = join(outDir, "iTunes", "iTunesDB")
  await Bun.write(itunesOut, itunes)
  written.push(itunesOut)
  const artWritten = await writeSyntheticArtwork(outDir, tracks)
  written.push(...artWritten)
  await writeSha256Sums(outDir, written)
  return written
}

export function buildSyntheticItunesdb(tracks: readonly SyntheticTrack[]): Itunesdb {
  const mhits = tracks.map((track, index) => mhitOf(track, index + 1))
  const trackSection = mhsdOf(1, mhltOf(mhits))
  const playlistSection = mhsdOf(2, playlistList(tracks))
  const podcastSection = mhsdOf(3, podcastPlaylistList())
  return { chunk: mhbdOf([trackSection, playlistSection, podcastSection]) }
}

export function dbidForPath(path: string): bigint {
  const hmac = createHmac("sha256", SCRUB_HMAC_KEY)
  hmac.update("synthetic-track")
  hmac.update(path)
  const digest = hmac.digest()
  const value = digest.readBigUInt64LE(0)
  return value === 0n ? 1n : value
}

async function loadTracks(audioRoot: string, manifest: Manifest): Promise<SyntheticTrack[]> {
  const out: SyntheticTrack[] = []
  let i = 0
  while (i < manifest.tracks.length) {
    const entry = manifest.tracks[i]
    i += 1
    if (!entry) {
      continue
    }
    if (TRANSCODE_SOURCE_CODECS.has(entry.codec)) {
      continue
    }
    const abs = join(audioRoot, entry.path)
    const bytes = new Uint8Array(await Bun.file(abs).bytes())
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const ext = extensionOf(entry.path)
    out.push({
      ...entry,
      size: bytes.byteLength,
      sha256,
      devicePath: devicePathFor(sha256, ext),
      dbid: dbidForPath(entry.path),
    })
  }
  return out
}

async function writeSyntheticArtwork(
  outDir: string,
  tracks: readonly SyntheticTrack[],
): Promise<string[]> {
  const rows = artworkFormatRows[CLASSIC_FAMILY] ?? []
  const groups = albumGroups(tracks)
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
  let rowInit = 0
  while (rowInit < rows.length) {
    const row = rows[rowInit]
    rowInit += 1
    if (!row) {
      continue
    }
    offsets.set(row.id, 0)
    ithmb.set(row.id, [])
  }
  let groupIndex = 0
  while (groupIndex < groups.length) {
    const group = groups[groupIndex]
    groupIndex += 1
    if (!group || !group.hasArtwork) {
      continue
    }
    const blocks = encodeFlatAlbum(groupIndex, rows)
    const albumOffsets = new Map<number, number>()
    let rowIndex = 0
    while (rowIndex < rows.length) {
      const row = rows[rowIndex]
      rowIndex += 1
      if (!row) {
        continue
      }
      const block = blocks.get(row.id)
      const list = ithmb.get(row.id)
      if (!block || !list) {
        continue
      }
      const offset = offsets.get(row.id) ?? 0
      albumOffsets.set(row.id, offset)
      list.push(block)
      offsets.set(row.id, offset + row.blockBytes)
    }
    let trackIndex = 0
    while (trackIndex < group.tracks.length) {
      const track = group.tracks[trackIndex]
      trackIndex += 1
      if (!track || !track.artwork) {
        continue
      }
      images.push({
        dbid: track.dbid,
        thumbs: rows.map((row) => ({
          formatId: row.id,
          offset: albumOffsets.get(row.id) ?? 0,
          size: row.blockBytes,
          width: row.width,
          height: row.height,
          fileName: `:F${row.id}_1.ithmb`,
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
  const written: string[] = []
  const artworkOut = join(outDir, "Artwork", "ArtworkDB")
  await Bun.write(artworkOut, serializeArtworkdb(db))
  written.push(artworkOut)
  let writeRow = 0
  while (writeRow < rows.length) {
    const row = rows[writeRow]
    writeRow += 1
    if (!row) {
      continue
    }
    const blocks = ithmb.get(row.id) ?? []
    if (blocks.length === 0) {
      continue
    }
    const dest = join(outDir, "Artwork", `F${row.id}_1.ithmb`)
    await Bun.write(dest, concat(blocks))
    written.push(dest)
  }
  return written
}

type AlbumGroup = {
  key: string
  hasArtwork: boolean
  tracks: SyntheticTrack[]
}

function albumGroups(tracks: readonly SyntheticTrack[]): AlbumGroup[] {
  const buckets = new Map<string, SyntheticTrack[]>()
  let i = 0
  while (i < tracks.length) {
    const track = tracks[i]
    i += 1
    if (!track) {
      continue
    }
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
    list.sort((left, right) => left.path.localeCompare(right.path))
    groups.push({
      key,
      hasArtwork: list.some((track) => track.artwork),
      tracks: list,
    })
  }
  groups.sort((left, right) => left.key.localeCompare(right.key))
  return groups
}

function encodeFlatAlbum(
  index: number,
  rows: ReadonlyArray<{ id: number, width: number, height: number, blockBytes: number }>,
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>()
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    i += 1
    if (!row) {
      continue
    }
    const rgb = new Uint8Array(row.width * row.height * 3)
    const r = (index * 40) & 0xff
    const g = (index * 80) & 0xff
    const b = (index * 120) & 0xff
    let pixel = 0
    const count = row.width * row.height
    while (pixel < count) {
      rgb[pixel * 3] = r
      rgb[pixel * 3 + 1] = g
      rgb[pixel * 3 + 2] = b
      pixel += 1
    }
    out.set(row.id, rgb888ToRgb565Le(rgb, row.width, row.height, row.blockBytes))
  }
  return out
}

async function writeSha256Sums(outDir: string, files: readonly string[]): Promise<void> {
  const lines: string[] = []
  const sorted = [...files].sort((left, right) => left.localeCompare(right))
  let i = 0
  while (i < sorted.length) {
    const file = sorted[i]
    i += 1
    if (!file) {
      continue
    }
    const rel = `./${file.slice(outDir.length).replace(/^\//u, "")}`
    const bytes = new Uint8Array(await Bun.file(file).bytes())
    const hash = createHash("sha256").update(bytes).digest("hex")
    lines.push(`${hash}  ${rel}`)
  }
  await Bun.write(join(outDir, "SHA256SUMS"), `${lines.join("\n")}\n`)
}

function devicePathFor(sha256: string, extension: string): string {
  const folder = Number.parseInt(sha256.slice(0, 8), 16) % FOLDER_COUNT
  const name = sha256.slice(0, 16)
  return `iPod_Control/Music/F${String(folder).padStart(2, "0")}/${name}.${extension}`
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".")
  if (dot < 0) {
    return "bin"
  }
  return path.slice(dot + 1).toLowerCase()
}

function colonPath(devicePath: string): string {
  return `:${devicePath.replaceAll("/", ":")}`
}

function mhbdOf(sections: Chunk[]): Chunk {
  const header = new Uint8Array(MHBD_HEADER)
  writeFourCc(header, 0, "mhbd")
  writeU32(header, 12, 1)
  writeU32(header, 16, VERSION)
  writeU32(header, 20, sections.length)
  return { id: "mhbd", header, children: sections, body: empty(), padding: empty() }
}

function mhsdOf(type: number, child: Chunk): Chunk {
  const header = new Uint8Array(MHSD_HEADER)
  writeFourCc(header, 0, "mhsd")
  writeU32(header, 12, type)
  return { id: "mhsd", header, children: [child], body: empty(), padding: empty() }
}

function mhltOf(tracks: Chunk[]): Chunk {
  const header = new Uint8Array(MHLT_HEADER)
  writeFourCc(header, 0, "mhlt")
  return { id: "mhlt", header, children: tracks, body: empty(), padding: empty() }
}

function mhlpOf(playlists: Chunk[]): Chunk {
  const header = new Uint8Array(MHLP_HEADER)
  writeFourCc(header, 0, "mhlp")
  return { id: "mhlp", header, children: playlists, body: empty(), padding: empty() }
}

function playlistList(tracks: readonly SyntheticTrack[]): Chunk {
  const items = tracks.map((_track, index) => mhipOf(index + 1))
  return mhlpOf([mhypOf("Library", items, 1n)])
}

function podcastPlaylistList(): Chunk {
  return mhlpOf([mhypOf("Podcasts", [], 2n)])
}

function mhypOf(name: string, items: Chunk[], persistentId: bigint): Chunk {
  const header = new Uint8Array(MHYP_HEADER)
  writeFourCc(header, 0, "mhyp")
  writeU32(header, 12, 1)
  writeU32(header, 16, items.length)
  header[MHYP_MASTER_FLAG] = 1
  writeU64(header, MHYP_PERSISTENT_ID, persistentId)
  writeU16(header, MHYP_STRING_MHOD_COUNT, 1)
  return {
    id: "mhyp",
    header,
    children: [stringMhod(1, name), ...items],
    body: empty(),
    padding: empty(),
  }
}

function mhipOf(trackId: number): Chunk {
  const header = new Uint8Array(MHIP_HEADER)
  writeFourCc(header, 0, "mhip")
  /* This mhip holds no child mhod, so the count stays 0. */
  writeU32(header, 12, 0)
  writeU32(header, 24, trackId)
  return { id: "mhip", header, children: [], body: empty(), padding: empty() }
}

function mhitOf(track: SyntheticTrack, trackId: number): Chunk {
  const mhods = [
    stringMhod(1, track.title),
    stringMhod(4, track.artist),
    stringMhod(22, track.albumArtist),
    stringMhod(3, track.album),
    stringMhod(2, colonPath(track.devicePath)),
  ]
  const header = new Uint8Array(MHIT_HEADER)
  writeFourCc(header, 0, "mhit")
  writeU32(header, 12, mhods.length)
  writeU32(header, 16, trackId)
  writeU32(header, 20, 1)
  const extension = extensionOf(track.devicePath)
  writeReversedFourCc(header, MHIT_FILE_TYPE, fileTypeCodeFor(extension))
  const format = formatBytesFor(extension)
  header[MHIT_TYPE_1] = format.type1
  header[MHIT_TYPE_2] = format.type2
  writeU32(header, 36, track.size)
  writeU32(header, 40, Math.round(track.durationSeconds * 1000))
  writeU32(header, 44, track.track)
  writeU32(header, 92, track.disc)
  writeU64(header, 112, track.dbid)
  header[164] = track.artwork ? 1 : 2
  writeU32(header, MHIT_MEDIA_TYPE, MEDIA_TYPE_AUDIO)
  writeU32(header, MHIT_UNKNOWN_D0, 1)
  writeU16(header, MHIT_GAPLESS_TRACK_FLAG, 1)
  writeU16(header, MHIT_GAPLESS_ALBUM_FLAG, 0)
  if (track.gapless) {
    writeU32(header, 184, track.gapless.encoderDelay)
    writeU64(header, 188, BigInt(track.gapless.sampleCount))
    writeU32(header, 200, track.gapless.encoderPadding)
  }
  return { id: "mhit", header, children: mhods, body: empty(), padding: empty() }
}

function stringMhod(type: number, text: string): Chunk {
  const encoded = encodeUtf16le(text)
  const body = new Uint8Array(16 + encoded.byteLength)
  writeU32(body, 0, 1)
  writeU32(body, 4, encoded.byteLength)
  writeU32(body, 8, 1)
  body.set(encoded, 16)
  const header = new Uint8Array(MHOD_HEADER)
  writeFourCc(header, 0, "mhod")
  writeU32(header, 12, type)
  return { id: "mhod", header, children: [], body, padding: empty() }
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  const view = new DataView(out.buffer)
  let i = 0
  while (i < text.length) {
    view.setUint16(i * 2, text.charCodeAt(i), true)
    i += 1
  }
  return out
}

function empty(): Uint8Array {
  return new Uint8Array(0)
}

/* The firmware stores the file type code least significant byte first. */
function writeReversedFourCc(bytes: Uint8Array, offset: number, code: string): void {
  let i = 0
  while (i < 4) {
    bytes[offset + i] = code.charCodeAt(3 - i)
    i += 1
  }
}

function writeFourCc(bytes: Uint8Array, offset: number, id: string): void {
  bytes[offset] = id.charCodeAt(0)
  bytes[offset + 1] = id.charCodeAt(1)
  bytes[offset + 2] = id.charCodeAt(2)
  bytes[offset + 3] = id.charCodeAt(3)
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  let i = 0
  while (i < parts.length) {
    total += parts[i]?.byteLength ?? 0
    i += 1
  }
  const out = new Uint8Array(total)
  let offset = 0
  i = 0
  while (i < parts.length) {
    const part = parts[i]
    i += 1
    if (!part) {
      continue
    }
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
