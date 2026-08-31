import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { transcodeFlacToAlac } from "./transcode.ts"

/**
 * Proves the ALAC output is real audio by decoding it with an independent
 * decoder and comparing the samples to the source.
 *
 * ffmpeg is the independent decoder. It is not a runtime dependency of
 * omatune, so these tests state that plainly and skip when it is absent.
 */

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const LIBRARY = join(ROOT, "fixtures", "audio", "library", "lossless-suite")
const CEILING = { sampleRate: 48000, bitsPerSample: 16 }
const FFMPEG = Bun.which("ffmpeg")
const FFPROBE = Bun.which("ffprobe")

const EMPTY_TAGS = {
  title: null,
  artist: null,
  album: null,
  albumArtist: null,
  track: null,
  trackTotal: null,
  disc: null,
  discTotal: null,
  compilation: false,
  artworkBytes: null,
  artworkMime: null,
}

const work = mkdtempSync(join(tmpdir(), "omatune-round-trip-"))
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

function decodeToPcm(input: string, extra: ReadonlyArray<string> = []): Int16Array {
  const out = join(work, `${Bun.hash(input + extra.join(" ")).toString(16)}.raw`)
  const result = Bun.spawnSync(
    [FFMPEG as string, "-v", "error", "-y", "-i", input, ...extra, "-f", "s16le", "-c:a", "pcm_s16le", out],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed: ${new TextDecoder().decode(result.stderr)}`)
  }
  const bytes = readFileSync(out)
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
}

async function transcodeFixture(name: string): Promise<string> {
  const source = new Uint8Array(readFileSync(join(LIBRARY, name)))
  const result = await transcodeFlacToAlac({ source, tags: EMPTY_TAGS, ceiling: CEILING })
  const path = join(work, `${name}.m4a`)
  await Bun.write(path, result.bytes)
  return path
}

test.skipIf(!FFMPEG)("a Track at the ceiling decodes back to the exact source samples", async () => {
  const transcoded = await transcodeFixture("01-standard.flac")
  const source = decodeToPcm(join(LIBRARY, "01-standard.flac"))
  const output = decodeToPcm(transcoded)
  expect(output.length).toBe(source.length)
  expect(Array.from(output)).toEqual(Array.from(source))
})

test.skipIf(!FFMPEG)("a hi-res Track lands within one bit of an independent resampler", async () => {
  const transcoded = await transcodeFixture("02-hires.flac")
  const reference = decodeToPcm(join(LIBRARY, "02-hires.flac"), [
    "-af",
    "aresample=48000:resampler=soxr:precision=28",
  ])
  const output = decodeToPcm(transcoded)
  expect(output.length).toBe(reference.length)

  /* The two filters differ in how they start and stop, so the comparison
   * skips the edges and measures the steady state. */
  const margin = 2000
  let worst = 0
  for (let i = margin; i < output.length - margin; i += 1) {
    const delta = Math.abs((output[i] as number) - (reference[i] as number))
    if (delta > worst) {
      worst = delta
    }
  }
  // One least-significant bit is the dither. Anything more is a filter fault.
  expect(worst).toBeLessThanOrEqual(1)
})

test.skipIf(!FFMPEG)("content above the output Nyquist is removed, not folded back", async () => {
  // A 30 kHz tone at 96 kHz sits above the 24 kHz Nyquist of a 48 kHz output.
  // Without an anti-alias filter it would reappear at 18 kHz at full scale.
  const flac = join(work, "tone-30k.flac")
  const made = Bun.spawnSync(
    [
      FFMPEG as string, "-v", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=30000:sample_rate=96000:duration=1",
      "-ac", "1", "-c:a", "flac", flac,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  expect(made.exitCode).toBe(0)

  const source = new Uint8Array(readFileSync(flac))
  const result = await transcodeFlacToAlac({ source, tags: EMPTY_TAGS, ceiling: CEILING })
  const path = join(work, "tone-30k.m4a")
  await Bun.write(path, result.bytes)

  const output = decodeToPcm(path)
  const middle = output.subarray(6000, output.length - 6000)
  let peak = 0
  for (const sample of middle) {
    const value = Math.abs(sample)
    if (value > peak) {
      peak = value
    }
  }
  // Only the dither survives. A folded tone would peak near full scale.
  expect(peak).toBeLessThanOrEqual(4)
})

test.skipIf(!FFMPEG || !FFPROBE)("the muxed file reports the codec, rate, and duration it holds", async () => {
  const transcoded = await transcodeFixture("02-hires.flac")
  const probe = Bun.spawnSync(
    [
      FFPROBE as string, "-v", "error",
      "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample",
      "-show_entries", "format=duration",
      "-of", "default=nw=1", transcoded,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const text = probe.stdout.toString()
  expect(text).toContain("codec_name=alac")
  expect(text).toContain("sample_rate=48000")
  expect(text).toContain("channels=1")
  expect(text).toContain("bits_per_raw_sample=16")
  expect(text).toContain("duration=2.000000")
})
