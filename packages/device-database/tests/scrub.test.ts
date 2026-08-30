import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  HASH58_LENGTH,
  HASH58_OFFSET,
  parseItunesdb,
  serializeItunesdb,
  tracksOf,
} from "../src/index.ts"
import {
  FAKE_SERIAL,
  pathPlaceholder,
  placeholderText,
  remapPersistentId,
  scrubItunesdbBytes,
  scrubIthmb,
  scrubMount,
  signScrubbedItunesdb,
} from "../src/scrub.ts"
import { mhbd, mhlt, mhitWith, mhsd, opaqueMhod } from "./build.ts"
import { publicFixture } from "./fixture-paths.ts"

function countByte(bytes: Uint8Array, value: number): number {
  let n = 0
  let i = 0
  while (i < bytes.byteLength) {
    if (bytes[i] === value) {
      n += 1
    }
    i += 1
  }
  return n
}

function sampleTrack(overrides?: { title?: string, artist?: string, album?: string, location?: string, dbid?: bigint }) {
  return {
    title: overrides?.title ?? "Alpha Song",
    artist: overrides?.artist ?? "Beta Artist",
    albumArtist: "Gamma",
    album: overrides?.album ?? "Delta Album",
    location: overrides?.location ?? ":iPod_Control:Music:F00:alpha.mp3",
    disc: 1,
    trackNumber: 1,
    duration: 1000,
    size: 2048,
    dbid: overrides?.dbid ?? 0x1111n,
    hasArtwork: false,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    lastPlayed: 0,
    lastSkipped: 0,
    bookmark: 0,
    pregap: 0,
    sampleCount: 0n,
    postgap: 0,
    gaplessData: 0,
    gaplessTrackFlag: 0,
    gaplessAlbumFlag: 0,
  }
}

describe("scrub placeholders", () => {
  test("same-length Artist and Album labels", () => {
    expect(placeholderText("Artist", 42, 11)).toBe("Artist 0042")
    expect(placeholderText("Album", 7, 10)).toBe("Album 0007")
    expect(placeholderText("Artist", 1, 4).length).toBe(4)
    expect(placeholderText("Title", 3, 20).length).toBe(20)
  })

  test("path placeholder keeps length and extension", () => {
    const original = ":iPod_Control:Music:F00:alpha.mp3"
    const text = pathPlaceholder(12, original.length, original)
    expect(text.length).toBe(original.length)
    expect(text.endsWith(".mp3")).toBe(true)
  })

  test("keyed ids are stable and not zero", () => {
    const first = remapPersistentId(0xabcdefn, "track")
    const second = remapPersistentId(0xabcdefn, "track")
    expect(first).toBe(second)
    expect(first).not.toBe(0n)
    expect(remapPersistentId(0n, "track")).toBe(0n)
  })
})

describe("scrub iTunesDB", () => {
  test("replaces strings and dbid and keeps byte length", () => {
    const bytes = mhbd([
      mhsd(1, mhlt([
        mhitWith(sampleTrack({ title: "Secret", artist: "Owner", album: "Private", dbid: 99n })),
      ])),
    ])
    const out = scrubItunesdbBytes(bytes)
    expect(out.byteLength).toBe(bytes.byteLength)
    const db = parseItunesdb(out)
    const round = serializeItunesdb(db)
    expect(round.byteLength).toBe(out.byteLength)
    const tracks = tracksOf(db)
    expect(tracks.length).toBe(1)
    const track = tracks[0]
    if (!track) {
      throw new Error("missing Track")
    }
    expect(track.title.includes("Secret")).toBe(false)
    expect(track.artist.includes("Owner")).toBe(false)
    expect(track.album.includes("Private")).toBe(false)
    expect(track.title.length).toBe("Secret".length)
    expect(track.artist.length).toBe("Owner".length)
    expect(track.album.length).toBe("Private".length)
    expect(track.dbid).toBe(remapPersistentId(99n, "track"))
    expect(track.devicePath.startsWith(":")).toBe(true)
  })

  test("leaves opaque mhod bodies in place", () => {
    const payload = new Uint8Array(32).fill(0x5a)
    const bytes = mhbd([
      mhsd(1, mhlt([
        mhitWith({
          ...sampleTrack(),
          extraMhods: [opaqueMhod(100, payload)],
        }),
      ])),
    ])
    const out = scrubItunesdbBytes(bytes)
    expect(countByte(out, 0x5a)).toBeGreaterThan(8)
  })

  test("hash58 uses the fake serial", () => {
    const bytes = mhbd([mhsd(1, mhlt([mhitWith(sampleTrack())]))])
    const scrubbed = scrubItunesdbBytes(bytes)
    const signed = signScrubbedItunesdb(scrubbed, "CLASSIC_2")
    expect(signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(
      new Uint8Array(HASH58_LENGTH),
    )
    expect(FAKE_SERIAL).toBe("000A270000000001")
  })
})

describe("scrub ithmb", () => {
  test("fills every byte of each block with a flat colour", () => {
    const width = 2
    const height = 2
    const blockBytes = 16
    const bytes = new Uint8Array(blockBytes * 2)
    bytes.fill(0xff)
    const out = scrubIthmb(bytes, width, height, blockBytes)
    expect(out.byteLength).toBe(bytes.byteLength)
    let index = 0
    while (index < 2) {
      const view = new DataView(out.buffer, index * blockBytes, blockBytes)
      const colour = view.getUint16(0, true)
      let offset = 0
      while (offset < blockBytes) {
        expect(view.getUint16(offset, true)).toBe(colour)
        offset += 2
      }
      index += 1
    }
  })

  test("public CLASSIC_2 F1061 ithmb has no leftover tail pixels", async () => {
    const path = join(publicFixture().dir, "Artwork", "F1061_1.ithmb")
    const bytes = new Uint8Array(await Bun.file(path).bytes())
    const blockBytes = 6160
    expect(bytes.byteLength % blockBytes).toBe(0)
    let index = 0
    const blockCount = bytes.byteLength / blockBytes
    while (index < blockCount) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + index * blockBytes, blockBytes)
      const colour = view.getUint16(0, true)
      let offset = 0
      while (offset < blockBytes) {
        expect(view.getUint16(offset, true)).toBe(colour)
        offset += 2
      }
      index += 1
    }
  })
})

describe("scrub mount", () => {
  test("writes iTunesDB Play Counts Artwork and SHA256SUMS", async () => {
    const root = await mkdtemp(join(tmpdir(), "omatune-scrub-"))
    const outDir = join(root, "out")
    const mount = join(root, "mount")
    const itunesDir = join(mount, "iTunes")
    await Bun.write(join(itunesDir, "iTunesDB"), mhbd([mhsd(1, mhlt([mhitWith(sampleTrack())]))]))
    await Bun.write(join(itunesDir, "Play Counts"), new Uint8Array([1, 2, 3, 4]))
    await Bun.write(join(itunesDir, "Extras.itdb"), new Uint8Array([9, 9]))
    await Bun.write(join(mount, "Device", "Users"), new Uint8Array([7, 7]))
    const written = await scrubMount(mount, outDir, "CLASSIC_2")
    expect(written.some((path) => path.endsWith("iTunesDB"))).toBe(true)
    expect(written.some((path) => path.endsWith("Play Counts"))).toBe(true)
    const extras = Bun.file(join(outDir, "iTunes", "Extras.itdb"))
    const users = Bun.file(join(outDir, "Device", "Users"))
    expect(await extras.exists()).toBe(false)
    expect(await users.exists()).toBe(false)
    const sums = await Bun.file(join(outDir, "SHA256SUMS")).text()
    expect(sums.includes("./iTunes/iTunesDB")).toBe(true)
    const parsed = parseItunesdb(new Uint8Array(await Bun.file(join(outDir, "iTunes", "iTunesDB")).bytes()))
    expect(tracksOf(parsed).length).toBe(1)
  })
})
