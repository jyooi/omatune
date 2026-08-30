import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
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
