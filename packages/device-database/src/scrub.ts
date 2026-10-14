/*
 * Scrub a Device Database Fixture.
 *
 * The Scrub replaces UTF-16 and UTF-8 strings with same-length placeholders.
 * The Scrub replaces library and Track persistent ids with keyed values.
 * The Scrub fills every byte of each ithmb block with a flat colour plus index.
 * The Scrub signs the iTunesDB with hash58 under FAKE_SERIAL.
 */

import { createHash, createHmac } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import {
  imageItems,
  parseArtworkdb,
  serializeArtworkdb,
  thumbnailsOf,
  type Artworkdb,
} from "./artwork.ts"
import { readU64, writeU64 } from "./bytes.ts"
import { parseChunk, serializeChunk, type Chunk } from "./chunk.ts"
import {
  mhodType as itunesMhodType,
  parseItunesdb,
  serializeItunesdb,
} from "./codec.ts"
import { artworkFormatRow, artworkFormatRows } from "./model/format-table.ts"
import { lookupByLibgpodKey } from "./model/lookup.ts"
import { signItunesdbForFamily } from "./signature.ts"

export const FAKE_SERIAL = "000A270000000001"
export const SCRUB_HMAC_KEY = "omatune-public-fixture-v1"

const LIBRARY_ID_OFFSET = 0x18
const TRACK_DBID_OFFSET = 112
const PLAYLIST_ID_OFFSET = 0x1c
const MHII_DBID_OFFSET = 20
const MHIA_ID_OFFSET = 16
const ITHMB_NAME = /^:F\d+_\d+\.ithmb$/u

export type ScrubKind = "itunes" | "artwork"
export type ScrubCounters = Map<string, number>

export function remapPersistentId(value: bigint, salt: string): bigint {
  if (value === 0n) {
    return 0n
  }
  const hmac = createHmac("sha256", SCRUB_HMAC_KEY)
  hmac.update(salt)
  hmac.update(value.toString(16).padStart(16, "0"))
  const digest = hmac.digest()
  const mapped = digest.readBigUInt64LE(0)
  return mapped === 0n ? 1n : mapped
}

export function placeholderText(kind: string, index: number, length: number): string {
  if (length <= 0) {
    return ""
  }
  const label = `${kind} ${String(index).padStart(4, "0")}`
  if (label.length === length) {
    return label
  }
  if (label.length < length) {
    return label.padEnd(length, " ")
  }
  return label.slice(0, length)
}

export function pathPlaceholder(index: number, length: number, original: string): string {
  if (length <= 0) {
    return ""
  }
  const ext = extensionOf(original)
  if (length < ext.length + 3) {
    return placeholderText("Path", index, length)
  }
  const folder = String(index % 100).padStart(2, "0")
  const hex = index.toString(16).toUpperCase().padStart(4, "0")
  const stem = `F${folder}/${hex}`
  const withColon = original.startsWith(":") ? `:${stem.replaceAll("/", ":")}` : stem
  return fit(withColon, length - ext.length) + ext
}

export function scrubItunesdbBytes(bytes: Uint8Array): Uint8Array {
  const db = parseItunesdb(bytes)
  const counters: ScrubCounters = new Map()
  const chunk = scrubChunk(db.chunk, "itunes", counters)
  return serializeItunesdb({ chunk })
}

export function scrubArtworkdbBytes(bytes: Uint8Array): Uint8Array {
  const db = parseArtworkdb(bytes)
  const counters: ScrubCounters = new Map()
  const chunk = scrubChunk(db.chunk, "artwork", counters)
  return serializeArtworkdb({ chunk })
}

export function scrubIthmb(
  bytes: Uint8Array,
  width: number,
  height: number,
  blockBytes: number,
): Uint8Array {
  const out = bytes.slice()
  const blockCount = Math.floor(out.byteLength / blockBytes)
  let index = 0
  while (index < blockCount) {
    const start = index * blockBytes
    const colour = rgb565FromIndex(index)
    const view = new DataView(out.buffer, out.byteOffset + start, blockBytes)
    let offset = 0
    while (offset + 1 < blockBytes) {
      view.setUint16(offset, colour, true)
      offset += 2
    }
    if (offset < blockBytes) {
      out[start + offset] = colour & 0xff
    }
    index += 1
  }
  return out
}

export function signScrubbedItunesdb(bytes: Uint8Array, modelKey: string): Uint8Array {
  const family = lookupByLibgpodKey(modelKey)
  if (!family) {
    throw new Error(`Unknown model key ${modelKey}`)
  }
  if (family.signature !== "hash58") {
    throw new Error(`Scrub signs hash58 only. ${modelKey} uses ${family.signature}`)
  }
  return signItunesdbForFamily(bytes, FAKE_SERIAL, family)
}

export async function scrubMount(
  mount: string,
  outDir: string,
  modelKey: string,
): Promise<string[]> {
  const layout = await detectLayout(mount)
  const written: string[] = []
  await mkdir(join(outDir, "iTunes"), { recursive: true })
  await mkdir(join(outDir, "Artwork"), { recursive: true })

  const itunesBytes = new Uint8Array(await Bun.file(layout.itunesdb).bytes())
  const scrubbedItunes = signScrubbedItunesdb(scrubItunesdbBytes(itunesBytes), modelKey)
  const itunesOut = join(outDir, "iTunes", "iTunesDB")
  await Bun.write(itunesOut, scrubbedItunes)
  written.push(itunesOut)

  if (layout.playCounts) {
    const playOut = join(outDir, "iTunes", "Play Counts")
    await Bun.write(playOut, await Bun.file(layout.playCounts).bytes())
    written.push(playOut)
  }

  if (layout.artworkdb) {
    const artworkBytes = new Uint8Array(await Bun.file(layout.artworkdb).bytes())
    const scrubbedArtwork = scrubArtworkdbBytes(artworkBytes)
    const artworkOut = join(outDir, "Artwork", "ArtworkDB")
    await Bun.write(artworkOut, scrubbedArtwork)
    written.push(artworkOut)
    const family = lookupByLibgpodKey(modelKey)
    const familyName = family?.family ?? ""
    const db = parseArtworkdb(scrubbedArtwork)
    await writeScrubbedIthmb(layout.artworkDir, outDir, db, familyName, written)
  }

  await writeSha256Sums(outDir, written)
  return written
}

async function writeScrubbedIthmb(
  sourceDir: string,
  outDir: string,
  db: Artworkdb,
  familyName: string,
  written: string[],
): Promise<void> {
  const seen = new Set<string>()
  const images = imageItems(db)
  let imageIndex = 0
  while (imageIndex < images.length) {
    const image = images[imageIndex]
    imageIndex += 1
    if (!image) {
      continue
    }
    const thumbs = thumbnailsOf(image)
    let thumbIndex = 0
    while (thumbIndex < thumbs.length) {
      const thumb = thumbs[thumbIndex]
      thumbIndex += 1
      if (!thumb) {
        continue
      }
      const fileName = basename(thumb.fileName.replaceAll(":", "/"))
      if (fileName.length === 0 || seen.has(fileName)) {
        continue
      }
      seen.add(fileName)
      const source = join(sourceDir, fileName)
      if (!(await Bun.file(source).exists())) {
        continue
      }
      const format = artworkFormatRow(familyName, thumb.formatId)
      const bytes = new Uint8Array(await Bun.file(source).bytes())
      const scrubbed = format
        ? scrubIthmb(bytes, format.width, format.height, format.blockBytes)
        : scrubIthmb(bytes, thumb.width, thumb.height, thumb.size)
      const dest = join(outDir, "Artwork", fileName)
      await Bun.write(dest, scrubbed)
      written.push(dest)
    }
  }
  const rows = artworkFormatRows[familyName] ?? []
  let rowIndex = 0
  while (rowIndex < rows.length) {
    const row = rows[rowIndex]
    rowIndex += 1
    if (!row) {
      continue
    }
    const fileName = `F${row.id}_1.ithmb`
    if (seen.has(fileName)) {
      continue
    }
    const source = join(sourceDir, fileName)
    if (!(await Bun.file(source).exists())) {
      continue
    }
    const bytes = new Uint8Array(await Bun.file(source).bytes())
    const dest = join(outDir, "Artwork", fileName)
    await Bun.write(dest, scrubIthmb(bytes, row.width, row.height, row.blockBytes))
    written.push(dest)
  }
}

async function writeSha256Sums(outDir: string, files: readonly string[]): Promise<void> {
  const lines: string[] = []
  const sorted = [...files].sort((left, right) => left.localeCompare(right))
  let fileIndex = 0
  while (fileIndex < sorted.length) {
    const file = sorted[fileIndex]
    fileIndex += 1
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

type Layout = {
  itunesdb: string
  playCounts: string | null
  artworkdb: string | null
  artworkDir: string
}

async function detectLayout(mount: string): Promise<Layout> {
  const candidates = [
    join(mount, "iTunes", "iTunesDB"),
    join(mount, "iPod_Control", "iTunes", "iTunesDB"),
  ]
  let candidateIndex = 0
  while (candidateIndex < candidates.length) {
    const itunesdb = candidates[candidateIndex]
    candidateIndex += 1
    if (!itunesdb) {
      continue
    }
    if (await Bun.file(itunesdb).exists()) {
      const itunesDir = dirname(itunesdb)
      const root = dirname(itunesDir)
      const playCounts = join(itunesDir, "Play Counts")
      const artworkDir = join(root, "Artwork")
      const artworkdb = join(artworkDir, "ArtworkDB")
      return {
        itunesdb,
        playCounts: (await Bun.file(playCounts).exists()) ? playCounts : null,
        artworkdb: (await Bun.file(artworkdb).exists()) ? artworkdb : null,
        artworkDir,
      }
    }
  }
  throw new Error(`No iTunesDB under ${mount}`)
}

function scrubChunk(chunk: Chunk, kind: ScrubKind, counters: ScrubCounters): Chunk {
  const header = chunk.header.slice()
  remapHeaderIds(chunk.id, header, kind)
  const children = chunk.children.map((child) => scrubChunk(child, kind, counters))
  let body = chunk.body.slice()
  if (chunk.id === "mhod") {
    body = scrubMhodBody(header, body, kind, counters)
  }
  return {
    id: chunk.id,
    header,
    children,
    body,
    padding: chunk.padding.slice(),
  }
}

function remapHeaderIds(id: string, header: Uint8Array, kind: ScrubKind): void {
  if (id === "mhbd" && header.byteLength >= LIBRARY_ID_OFFSET + 8) {
    writeU64(header, LIBRARY_ID_OFFSET, remapPersistentId(readU64(header, LIBRARY_ID_OFFSET), "library"))
  }
  if (id === "mhit" && header.byteLength >= TRACK_DBID_OFFSET + 8) {
    writeU64(header, TRACK_DBID_OFFSET, remapPersistentId(readU64(header, TRACK_DBID_OFFSET), "track"))
  }
  if (id === "mhyp" && header.byteLength >= PLAYLIST_ID_OFFSET + 8) {
    writeU64(header, PLAYLIST_ID_OFFSET, remapPersistentId(readU64(header, PLAYLIST_ID_OFFSET), "playlist"))
  }
  if (id === "mhia" && header.byteLength >= MHIA_ID_OFFSET + 8) {
    writeU64(header, MHIA_ID_OFFSET, remapPersistentId(readU64(header, MHIA_ID_OFFSET), "album"))
  }
  if (kind === "artwork" && id === "mhii" && header.byteLength >= MHII_DBID_OFFSET + 8) {
    writeU64(header, MHII_DBID_OFFSET, remapPersistentId(readU64(header, MHII_DBID_OFFSET), "track"))
  }
}

function scrubMhodBody(
  header: Uint8Array,
  body: Uint8Array,
  kind: ScrubKind,
  counters: ScrubCounters,
): Uint8Array {
  if (kind === "artwork") {
    return scrubArtworkMhodBody(header, body, counters)
  }
  return scrubItunesStringBody(header, body, counters)
}

function scrubItunesStringBody(
  header: Uint8Array,
  body: Uint8Array,
  counters: ScrubCounters,
): Uint8Array {
  if (body.byteLength < 16) {
    return body
  }
  const type = itunesMhodType({ id: "mhod", header, children: [], body, padding: new Uint8Array(0) })
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const position = view.getUint32(0, true)
  const byteLength = view.getUint32(4, true)
  const encoding = view.getUint32(8, true)
  if (position !== 1 || (encoding !== 1 && encoding !== 2)) {
    return body
  }
  if (16 + byteLength > body.byteLength) {
    return body
  }
  const textBytes = body.subarray(16, 16 + byteLength)
  const out = body.slice()
  const kind = kindName(type)
  const index = nextIndex(counters, kind)
  const replaced =
    encoding === 2
      ? replaceUtf8(textBytes, kind, index)
      : replaceUtf16(textBytes, type, index)
  out.set(replaced, 16)
  return out
}

function scrubArtworkMhodBody(
  header: Uint8Array,
  body: Uint8Array,
  counters: ScrubCounters,
): Uint8Array {
  const type = artworkMhodType(header)
  if (type === 2 && body.byteLength >= 12) {
    try {
      const nested = parseChunk(body, 0)
      const scrubbed = scrubChunk(nested.chunk, "artwork", counters)
      return serializeChunk(scrubbed)
    } catch {
      return body
    }
  }
  if (body.byteLength < 12) {
    return body
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const byteLength = view.getUint32(0, true)
  const encoding = view.getUint32(4, true)
  if (encoding !== 1 && encoding !== 2) {
    return body
  }
  if (12 + byteLength > body.byteLength) {
    return body
  }
  const textBytes = body.subarray(12, 12 + byteLength)
  if (encoding === 2) {
    const original = decodeUtf16(textBytes)
    if (ITHMB_NAME.test(original)) {
      return body
    }
  }
  const out = body.slice()
  const kind = kindName(type)
  const index = nextIndex(counters, kind)
  const replaced =
    encoding === 1 ? replaceUtf8(textBytes, kind, index) : replaceUtf16(textBytes, type, index)
  out.set(replaced, 12)
  return out
}

function replaceUtf16(bytes: Uint8Array, type: number, index: number): Uint8Array {
  const length = Math.floor(bytes.byteLength / 2)
  const original = decodeUtf16(bytes)
  const text = type === 2 ? pathPlaceholder(index, length, original) : placeholderText(kindName(type), index, length)
  return encodeUtf16(text, bytes.byteLength)
}

function replaceUtf8(bytes: Uint8Array, kind: string, index: number): Uint8Array {
  const text = placeholderText(kind, index, bytes.byteLength)
  const encoded = new TextEncoder().encode(text)
  const out = new Uint8Array(bytes.byteLength)
  out.set(encoded.subarray(0, bytes.byteLength))
  if (encoded.byteLength < bytes.byteLength) {
    out.fill(0x20, encoded.byteLength)
  }
  return out
}

function encodeUtf16(text: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength)
  const view = new DataView(out.buffer)
  const units = Math.floor(byteLength / 2)
  let i = 0
  while (i < units) {
    view.setUint16(i * 2, text.charCodeAt(i) || 0x20, true)
    i += 1
  }
  return out
}

function decodeUtf16(bytes: Uint8Array): string {
  return new TextDecoder("utf-16le").decode(bytes)
}

function kindName(type: number): string {
  switch (type) {
    case 1:
      return "Title"
    case 2:
      return "Path"
    case 3:
    case 200:
      return "Album"
    case 4:
    case 22:
    case 23:
    case 27:
    case 201:
      return "Artist"
    case 5:
      return "Genre"
    case 6:
      return "File"
    case 12:
    case 28:
      return "Composer"
    case 13:
      return "Group"
    default:
      return "Text"
  }
}

function nextIndex(counters: ScrubCounters, kind: string): number {
  const next = (counters.get(kind) ?? 0) + 1
  counters.set(kind, next)
  return next
}

function artworkMhodType(header: Uint8Array): number {
  if (header.byteLength < 14) {
    return 0
  }
  return (header[12] ?? 0) | ((header[13] ?? 0) << 8)
}

function rgb565FromIndex(index: number): number {
  const r = (index * 13) & 0x1f
  const g = (index * 7) & 0x3f
  const b = (index * 17) & 0x1f
  return (r << 11) | (g << 5) | b
}

function extensionOf(path: string): string {
  const match = /\.[A-Za-z0-9]{1,4}$/u.exec(path)
  return match?.[0] ?? ""
}

function fit(text: string, length: number): string {
  if (text.length === length) {
    return text
  }
  if (text.length < length) {
    return text.padEnd(length, " ")
  }
  return text.slice(0, length)
}
