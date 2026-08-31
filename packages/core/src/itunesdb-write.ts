import {
  parseItunesdb,
  serializeItunesdb,
  tracksOf,
  type Chunk,
  type Itunesdb,
  type Track,
} from "@omatune/device-database"
import type { LedgerEntry } from "./ledger.ts"
import { ZERO_PLAY_DATA, type HostPlayData } from "./play-data.ts"
import type { SelectedTrack } from "./rules.ts"

const MHBD_HEADER = 0xf4
const MHSD_HEADER = 96
const MHLT_HEADER = 92
const MHLP_HEADER = 92
const MHIT_HEADER = 624
const MHOD_HEADER = 24
const MHYP_HEADER = 184
const MHIP_HEADER = 76
const VERSION = 0x30
const MHOD_BODY_PREFIX = 16
const STRING_UTF16_BYTES = 512
const RESERVE_ALIGN = 512

export type ItunesdbTrack = {
  readonly libraryPath: string
  readonly devicePath: string
  readonly size: number
  readonly dbid: bigint
  readonly selected: SelectedTrack
  readonly hasArtwork: boolean
  readonly playData: HostPlayData
}

export function buildItunesdb(tracks: ReadonlyArray<ItunesdbTrack>): Itunesdb {
  const mhits = tracks.map((track, index) => mhitOf(track, index + 1))
  const items = tracks.map((track, index) => mhipOf(index + 1))
  const trackSection = mhsdOf(1, mhltOf(mhits))
  const playlistSection = mhsdOf(2, mhlpOf([mhypOf("Library", items)]))
  return { chunk: mhbdOf([trackSection, playlistSection]) }
}

export function serializeSignedLayout(tracks: ReadonlyArray<ItunesdbTrack>): Uint8Array {
  return serializeItunesdb(buildItunesdb(tracks))
}

export function itunesdbReserveBytes(trackCount: number): number {
  const count = Math.max(0, Math.floor(trackCount))
  const mhod = MHOD_HEADER + MHOD_BODY_PREFIX + STRING_UTF16_BYTES
  const fixed =
    MHBD_HEADER + 2 * MHSD_HEADER + MHLT_HEADER + MHLP_HEADER + MHYP_HEADER + mhod
  const perTrack = MHIT_HEADER + MHIP_HEADER + 5 * mhod
  return roundUp(fixed, RESERVE_ALIGN) + roundUp(perTrack, RESERVE_ALIGN) * count
}

export function readItunesdbTracks(bytes: Uint8Array): Track[] {
  return tracksOf(parseItunesdb(bytes))
}

export function colonPath(devicePath: string): string {
  return `:${devicePath.replaceAll("/", ":")}`
}

export function tracksForDatabase(
  entries: ReadonlyArray<LedgerEntry>,
  selectedByPath: ReadonlyMap<string, SelectedTrack>,
  artworkDbids: ReadonlySet<string> = new Set(),
  playDataByHash: ReadonlyMap<string, HostPlayData> = new Map(),
): ItunesdbTrack[] {
  const out: ItunesdbTrack[] = []
  for (const entry of entries) {
    const selected = selectedByPath.get(entry.libraryPath)
    if (!selected) {
      continue
    }
    out.push({
      libraryPath: entry.libraryPath,
      devicePath: entry.devicePath,
      size: entry.transcodedSize ?? entry.size,
      dbid: BigInt(entry.dbid),
      selected,
      hasArtwork: artworkDbids.has(entry.dbid),
      playData: playDataByHash.get(entry.sha256) ?? { ...ZERO_PLAY_DATA, path: entry.libraryPath },
    })
  }
  return out
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

function mhypOf(name: string, items: Chunk[]): Chunk {
  const header = new Uint8Array(MHYP_HEADER)
  writeFourCc(header, 0, "mhyp")
  writeU32(header, 12, 1)
  writeU32(header, 16, items.length)
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
  writeU32(header, 12, 1)
  writeU32(header, 24, trackId)
  return { id: "mhip", header, children: [], body: empty(), padding: empty() }
}

function mhitOf(track: ItunesdbTrack, trackId: number): Chunk {
  const tags = track.selected.tags
  const title = (tags.title ?? fileName(track.libraryPath)).trim()
  const artist = (tags.artist ?? "").trim()
  const album = (tags.album ?? "").trim()
  const albumArtist = track.selected.albumArtist
  const mhods = [
    stringMhod(1, title),
    stringMhod(4, artist),
    stringMhod(22, albumArtist),
    stringMhod(3, album),
    stringMhod(2, colonPath(track.devicePath)),
  ]
  const header = new Uint8Array(MHIT_HEADER)
  writeFourCc(header, 0, "mhit")
  writeU32(header, 12, mhods.length)
  writeU32(header, 16, trackId)
  writeU32(header, 20, 1)
  writeU32(header, 24, 1)
  writeU32(header, 36, track.size)
  writeU32(header, 40, durationMs(tags.durationSeconds))
  writeU32(header, 44, tags.track ?? 0)
  header[31] = track.playData.rating & 0xff
  writeU32(header, 80, track.playData.playCount)
  writeU32(header, 88, track.playData.lastPlayed)
  writeU32(header, 92, tags.disc ?? 0)
  writeU32(header, 108, track.playData.bookmark)
  writeU64(header, 112, track.dbid)
  writeU32(header, 156, track.playData.skipCount)
  writeU32(header, 160, track.playData.lastSkipped)
  header[164] = track.hasArtwork ? 1 : 2
  const gapless = tags.gapless
  if (gapless) {
    writeU32(header, 184, gapless.encoderDelay)
    writeU64(header, 188, gapless.sampleCount)
    writeU32(header, 200, gapless.encoderPadding)
    writeU16(header, 256, 1)
    writeU16(header, 258, 1)
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

function durationMs(seconds: number | null): number {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 0
  }
  return Math.round(seconds * 1000)
}

function fileName(path: string): string {
  const base = path.split("/").pop() ?? path
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return base
  }
  return base.slice(0, dot)
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(i * 2, text.charCodeAt(i), true)
  }
  return out
}

function empty(): Uint8Array {
  return new Uint8Array(0)
}

function roundUp(value: number, unit: number): number {
  if (value <= 0) {
    return 0
  }
  return Math.ceil(value / unit) * unit
}

function writeFourCc(bytes: Uint8Array, offset: number, id: string): void {
  bytes[offset] = id.charCodeAt(0)
  bytes[offset + 1] = id.charCodeAt(1)
  bytes[offset + 2] = id.charCodeAt(2)
  bytes[offset + 3] = id.charCodeAt(3)
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2)
  view.setUint16(0, value, true)
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
  view.setUint32(0, value >>> 0, true)
}

function writeU64(bytes: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  view.setBigUint64(0, value, true)
}
