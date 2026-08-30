import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { encode } from "jpeg-js"
import { lookupByLibgpodKey } from "@omatune/device-database"
import { writeDeviceArtwork } from "./artwork.ts"

const CLASSIC = lookupByLibgpodKey("CLASSIC_2")
const MINI = lookupByLibgpodKey("MINI_1")

test("writes one ArtworkDB row per Track with Artwork and skips the rest", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-"))
  const cache = join(root, "cache")
  const mount = join(root, "mount")
  const cover = pngSolid(4, 4, [196, 30, 58])
  const result = await writeDeviceArtwork({
    mountPoint: mount,
    family: CLASSIC,
    cacheDir: cache,
    tracks: [
      track("tone-suite/01-pregap.mp3", "1", "Bjork", "Tone Suite", cover),
      track("tone-suite/05-uncovered.mp3", "2", "Bjork", "Tone Suite", null),
      track("dual-disc/d1-01-left.m4a", "3", "Bjork", "Dual Disc", cover),
    ],
  })
  expect([...result.dbidsWithArtwork].sort()).toEqual(["1", "3"])
  expect(result.hashes.get("tone-suite/05-uncovered.mp3")).toBeNull()
  const bytes = new Uint8Array(
    await Bun.file(join(mount, "iPod_Control", "Artwork", "ArtworkDB")).arrayBuffer(),
  )
  const { imageItems, parseArtworkdb, mhiiDbid, thumbnailsOf, artworkFormatRows } = await import(
    "@omatune/device-database"
  )
  const db = parseArtworkdb(bytes)
  const items = imageItems(db)
  expect(items).toHaveLength(2)
  expect(items.map((item) => mhiiDbid(item).toString()).sort()).toEqual(["1", "3"])
  const rows = artworkFormatRows[CLASSIC.family] ?? []
  expect(rows.length).toBe(3)
  for (const row of rows) {
    const ithmb = new Uint8Array(
      await Bun.file(join(mount, "iPod_Control", "Artwork", `F${row.id}_1.ithmb`)).arrayBuffer(),
    )
    expect(ithmb.byteLength).toBe(row.blockBytes * 2)
    const thumbs = thumbnailsOf(items[0]!)
    const thumb = thumbs.find((entry) => entry.formatId === row.id)
    expect(thumb?.size).toBe(row.blockBytes)
    expect(thumb?.width).toBe(row.width)
    expect(thumb?.height).toBe(row.height)
  }
})

test("a tight space budget skips Artwork with disk_full and writes no files", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-full-"))
  const result = await writeDeviceArtwork({
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    spaceRemaining: 100,
    tracks: [track("tone-suite/01-pregap.mp3", "1", "Bjork", "Tone Suite", pngSolid(4, 4, [196, 30, 58]))],
  })
  expect(result.wrote).toBe(false)
  expect(result.dbidsWithArtwork.size).toBe(0)
  expect(result.skipped).toEqual([{ path: "tone-suite/01-pregap.mp3", reason: "disk_full" }])
  expect(await Bun.file(join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")).exists()).toBe(
    false,
  )
})

test("a family without a colour screen writes no Artwork", async () => {
  if (!MINI) {
    throw new Error("missing mini family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-mini-"))
  const result = await writeDeviceArtwork({
    mountPoint: join(root, "mount"),
    family: MINI,
    cacheDir: join(root, "cache"),
    tracks: [track("a.mp3", "1", "A", "B", pngSolid(2, 2, [1, 2, 3]))],
  })
  expect(result.dbidsWithArtwork.size).toBe(0)
  expect(await Bun.file(join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")).exists()).toBe(
    false,
  )
})

test("a Track whose cover cannot be decoded is Skipped-for-artwork", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-sof2-"))
  const result = await writeDeviceArtwork({
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a/01.mp3", "1", "A", "Album", sof2Jpeg())],
  })
  expect(result.dbidsWithArtwork.size).toBe(0)
  expect(result.skipped).toEqual([{ path: "a/01.mp3", reason: "progressive_jpeg" }])
  expect(result.wrote).toBe(true)
  const { imageItems, parseArtworkdb } = await import("@omatune/device-database")
  const bytes = new Uint8Array(
    await Bun.file(join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")).arrayBuffer(),
  )
  expect(imageItems(parseArtworkdb(bytes))).toHaveLength(0)
  const second = await writeDeviceArtwork({
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a/01.mp3", "1", "A", "Album", sof2Jpeg())],
    priorHashes: result.hashes,
  })
  expect(second.wrote).toBe(false)
})

test("an Album falls back to the next path-sorted Track with a decodable cover", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-fallback-"))
  const result = await writeDeviceArtwork({
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [
      track("a/01.mp3", "1", "A", "Album", sof2Jpeg()),
      track("a/02.mp3", "2", "A", "Album", baselineJpeg()),
    ],
  })
  expect(result.skipped).toEqual([{ path: "a/01.mp3", reason: "progressive_jpeg" }])
  expect([...result.dbidsWithArtwork]).toEqual(["2"])
  const { imageItems, mhiiDbid, parseArtworkdb } = await import("@omatune/device-database")
  const bytes = new Uint8Array(
    await Bun.file(join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")).arrayBuffer(),
  )
  const items = imageItems(parseArtworkdb(bytes))
  expect(items).toHaveLength(1)
  expect(mhiiDbid(items[0]!).toString()).toBe("2")
})

test("matching Ledger hashes skip a Device Artwork rewrite", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-skip-"))
  const cover = pngSolid(4, 4, [46, 139, 87])
  const input = {
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a.mp3", "9", "A", "B", cover)],
  }
  const first = await writeDeviceArtwork(input)
  expect(first.wrote).toBe(true)
  const dbPath = join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")
  const before = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  const second = await writeDeviceArtwork({
    ...input,
    priorHashes: first.hashes,
  })
  expect(second.wrote).toBe(false)
  expect(new Uint8Array(await Bun.file(dbPath).arrayBuffer())).toEqual(before)
})

test("a corrupt ArtworkDB is rewritten when Ledger hashes still match", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-corrupt-"))
  const cover = pngSolid(4, 4, [46, 139, 87])
  const input = {
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a.mp3", "9", "A", "B", cover)],
  }
  const first = await writeDeviceArtwork(input)
  const dbPath = join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")
  await Bun.write(dbPath, "marker")
  const second = await writeDeviceArtwork({
    ...input,
    priorHashes: first.hashes,
  })
  expect(second.wrote).toBe(true)
  expect(second.dbidsWithArtwork.has("9")).toBe(true)
  const { imageItems, parseArtworkdb } = await import("@omatune/device-database")
  const bytes = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  expect(imageItems(parseArtworkdb(bytes))).toHaveLength(1)
})

test("a missing ArtworkDB is rewritten when Ledger hashes still match", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-repair-"))
  const cover = pngSolid(4, 4, [46, 139, 87])
  const input = {
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a.mp3", "9", "A", "B", cover)],
  }
  const first = await writeDeviceArtwork(input)
  const dbPath = join(root, "mount", "iPod_Control", "Artwork", "ArtworkDB")
  await Bun.file(dbPath).unlink()
  const second = await writeDeviceArtwork({
    ...input,
    priorHashes: first.hashes,
  })
  expect(second.wrote).toBe(true)
  expect(second.dbidsWithArtwork.has("9")).toBe(true)
  const { imageItems, parseArtworkdb } = await import("@omatune/device-database")
  const bytes = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  expect(imageItems(parseArtworkdb(bytes))).toHaveLength(1)
})

test("an unchanged cover reads the host cache and skips a second encode", async () => {
  if (!CLASSIC) {
    throw new Error("missing classic family")
  }
  const root = await mkdtemp(join(tmpdir(), "omatune-art-cache-"))
  const cover = pngSolid(4, 4, [46, 139, 87])
  const input = {
    mountPoint: join(root, "mount"),
    family: CLASSIC,
    cacheDir: join(root, "cache"),
    tracks: [track("a.mp3", "9", "A", "B", cover)],
  }
  const first = await writeDeviceArtwork(input)
  expect(first.dbidsWithArtwork.has("9")).toBe(true)
  const cacheFiles: string[] = []
  for await (const file of new Bun.Glob("**/*").scan({ cwd: join(root, "cache"), onlyFiles: true })) {
    cacheFiles.push(file)
  }
  expect(cacheFiles.length).toBe(3)
  const second = await writeDeviceArtwork({
    ...input,
    mountPoint: join(root, "mount2"),
  })
  expect(second.dbidsWithArtwork.has("9")).toBe(true)
})

function track(
  libraryPath: string,
  dbid: string,
  albumArtist: string,
  album: string,
  artworkBytes: Uint8Array | null,
) {
  return { libraryPath, dbid, albumArtist, album, artworkBytes }
}

function sof2Jpeg(): Uint8Array {
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc2,
    0x00,
    0x11,
    0x08,
    0x00,
    0x08,
    0x00,
    0x08,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  )
}

function baselineJpeg(): Uint8Array {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < 8 * 8; i += 1) {
    rgba[i * 4] = 30
    rgba[i * 4 + 1] = 144
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = 255
  }
  return new Uint8Array(encode({ data: rgba, width: 8, height: 8 }, 100).data)
}

function pngSolid(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const [r, g, b] = rgb
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < width; x += 1) {
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = deflateSync(raw, { level: 9 })
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
