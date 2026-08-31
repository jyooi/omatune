import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeFlacToAlac, TranscodeError } from "./engine.ts"

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const LIBRARY = join(ROOT, "fixtures", "audio", "library", "lossless-suite")
const CEILING = { sampleRate: 48000, bitsPerSample: 16 }

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(LIBRARY, name)))
}

test("a source at the ceiling keeps its rate and its depth", async () => {
  const stream = await encodeFlacToAlac(fixture("01-standard.flac"), CEILING)
  expect(stream.sourceRate).toBe(44100)
  expect(stream.sourceBits).toBe(16)
  expect(stream.outputRate).toBe(44100)
  expect(stream.outputBits).toBe(16)
  expect(stream.bitPerfect).toBe(true)
  expect(stream.frames).toBe(stream.sourceFrames)
  expect(stream.packets.length).toBeGreaterThan(0)
})

test("a source above the ceiling comes down to it", async () => {
  const stream = await encodeFlacToAlac(fixture("02-hires.flac"), CEILING)
  expect(stream.sourceRate).toBe(96000)
  expect(stream.sourceBits).toBe(24)
  expect(stream.outputRate).toBe(48000)
  expect(stream.outputBits).toBe(16)
  expect(stream.bitPerfect).toBe(false)
  // Half the rate means half the frames, and no filter tail beyond them.
  expect(stream.frames).toBe(stream.sourceFrames / 2)
})

test("the magic cookie carries the ALAC config in big-endian order", async () => {
  const stream = await encodeFlacToAlac(fixture("01-standard.flac"), CEILING)
  const cookie = stream.magicCookie
  expect(cookie.length).toBe(24)
  const view = new DataView(cookie.buffer, cookie.byteOffset, cookie.byteLength)
  expect(view.getUint32(0, false)).toBe(4096) // frameLength
  expect(cookie[4]).toBe(0) // compatibleVersion
  expect(cookie[5]).toBe(16) // bitDepth
  expect(cookie[9]).toBe(1) // numChannels
  expect(view.getUint32(12, false)).toBeGreaterThan(0) // maxFrameBytes
  expect(view.getUint32(20, false)).toBe(44100) // sampleRate
})

test("the same source and ceiling always produce the same packets", async () => {
  const source = fixture("02-hires.flac")
  const first = await encodeFlacToAlac(source, CEILING)
  const second = await encodeFlacToAlac(source, CEILING)
  expect(second.packets.length).toBe(first.packets.length)
  for (let i = 0; i < first.packets.length; i += 1) {
    expect(second.packets[i]?.bytes).toEqual(first.packets[i]?.bytes as Uint8Array)
  }
  expect(second.magicCookie).toEqual(first.magicCookie)
})

test("a damaged stream reports a Transcode error instead of writing audio", async () => {
  const source = fixture("01-standard.flac")
  const damaged = Uint8Array.from(source)
  // Overwrite well past the headers so the decoder reaches a bad frame.
  damaged.fill(0xff, Math.floor(damaged.length / 2), damaged.length - 16)
  await expect(encodeFlacToAlac(damaged, CEILING)).rejects.toBeInstanceOf(TranscodeError)
})

test("bytes that are not FLAC are refused", async () => {
  await expect(encodeFlacToAlac(new Uint8Array(64), CEILING)).rejects.toBeInstanceOf(TranscodeError)
})
