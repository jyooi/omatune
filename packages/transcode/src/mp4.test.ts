import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readTrackTags } from "../../core/src/tags.ts"
import { buildAlacM4a, itunSmpb } from "./mp4.ts"
import { transcodeFlacToAlac } from "./transcode.ts"

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const LIBRARY = join(ROOT, "fixtures", "audio", "library", "lossless-suite")
const CEILING = { sampleRate: 48000, bitsPerSample: 16 }

const COVER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

const TAGS = {
  title: "Standard",
  artist: "Björk",
  album: "Lossless Suite",
  albumArtist: "Björk",
  track: 1,
  trackTotal: 2,
  disc: 1,
  discTotal: 1,
  compilation: false,
  artworkBytes: COVER,
  artworkMime: "image/png",
}

function atomNames(bytes: Uint8Array): string[] {
  const names: string[] = []
  let pos = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (pos + 8 <= bytes.length) {
    const size = view.getUint32(pos, false)
    if (size < 8 || pos + size > bytes.length) {
      break
    }
    names.push(new TextDecoder("latin1").decode(bytes.subarray(pos + 4, pos + 8)))
    pos += size
  }
  return names
}

async function transcodeFixture(name: string, tags = TAGS) {
  const source = new Uint8Array(readFileSync(join(LIBRARY, name)))
  return transcodeFlacToAlac({ source, tags, ceiling: CEILING })
}

test("the file starts with ftyp then moov then mdat", async () => {
  const result = await transcodeFixture("01-standard.flac")
  expect(atomNames(result.bytes)).toEqual(["ftyp", "moov", "mdat"])
})

test("the tag reader reads a transcoded file back whole", async () => {
  const result = await transcodeFixture("01-standard.flac")
  const tags = readTrackTags(result.bytes)
  expect(tags.codec).toBe("alac")
  expect(tags.title).toBe("Standard")
  expect(tags.artist).toBe("Björk")
  expect(tags.album).toBe("Lossless Suite")
  expect(tags.albumArtist).toBe("Björk")
  expect(tags.track).toBe(1)
  expect(tags.trackTotal).toBe(2)
  expect(tags.disc).toBe(1)
  expect(tags.discTotal).toBe(1)
  expect(tags.compilation).toBe(false)
  expect(tags.hasArtwork).toBe(true)
  expect(tags.artworkMime).toBe("image/png")
  expect(tags.artworkBytes).toEqual(COVER)
  expect(tags.durationSeconds).toBeCloseTo(2, 3)
})

test("a compilation Track keeps its compilation flag", async () => {
  const result = await transcodeFixture("01-standard.flac", {
    ...TAGS,
    compilation: true,
    albumArtist: "Various Artists",
  })
  const tags = readTrackTags(result.bytes)
  expect(tags.compilation).toBe(true)
  expect(tags.albumArtist).toBe("Various Artists")
})

test("a Track with no Artwork carries no cover atom", async () => {
  const result = await transcodeFixture("01-standard.flac", {
    ...TAGS,
    artworkBytes: null,
    artworkMime: null,
  })
  const tags = readTrackTags(result.bytes)
  expect(tags.hasArtwork).toBe(false)
  expect(tags.artworkBytes).toBeNull()
})

test("gapless data reports the frame count with no codec delay", () => {
  // The tag reader takes the delay, the padding, and the count from fields
  // one, two, and three.
  const parts = itunSmpb(88200).trim().split(/\s+/)
  expect(parts).toHaveLength(12)
  expect(Number.parseInt(parts[1] ?? "", 16)).toBe(0)
  expect(Number.parseInt(parts[2] ?? "", 16)).toBe(0)
  expect(Number.parseInt(parts[3] ?? "", 16)).toBe(88200)
})

test("a transcoded Track reads back its own gapless frame count", async () => {
  const result = await transcodeFixture("01-standard.flac")
  const tags = readTrackTags(result.bytes)
  expect(tags.gapless).not.toBeNull()
  expect(tags.gapless?.encoderDelay).toBe(0)
  expect(tags.gapless?.encoderPadding).toBe(0)
  expect(tags.gapless?.sampleCount).toBe(BigInt(result.frames))
})

test("the sample table trims the tail to the frames the source held", () => {
  const packets = [
    { bytes: Uint8Array.from([1, 2, 3]), frames: 4096 },
    { bytes: Uint8Array.from([4, 5]), frames: 4096 },
  ]
  const bytes = buildAlacM4a({
    sampleRate: 44100,
    channels: 2,
    bitsPerSample: 16,
    framesPerPacket: 4096,
    magicCookie: new Uint8Array(24),
    packets,
    totalFrames: 5000,
    tags: { ...TAGS, artworkBytes: null, artworkMime: null },
  })
  const text = new TextDecoder("latin1").decode(bytes)
  const stts = text.indexOf("stts")
  expect(stts).toBeGreaterThan(0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(stts + 8, false)
  expect(count).toBe(2)
  expect(view.getUint32(stts + 12, false)).toBe(1)
  expect(view.getUint32(stts + 16, false)).toBe(4096)
  expect(view.getUint32(stts + 20, false)).toBe(1)
  expect(view.getUint32(stts + 24, false)).toBe(904)
})

test("muxing the same stream twice produces the same bytes", async () => {
  const first = await transcodeFixture("02-hires.flac")
  const second = await transcodeFixture("02-hires.flac")
  expect(second.bytes).toEqual(first.bytes)
})
