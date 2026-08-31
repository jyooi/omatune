import { encodeFlacToAlac, TRANSCODE_MODULE_VERSION, type AudioCeiling } from "./engine.ts"
import { buildAlacM4a, type Mp4Tags } from "./mp4.ts"

export type TranscodeInput = {
  readonly source: Uint8Array
  readonly tags: Mp4Tags
  readonly ceiling: AudioCeiling
}

export type TranscodeOutput = {
  readonly bytes: Uint8Array
  readonly sourceRate: number
  readonly sourceBits: number
  readonly channels: number
  readonly outputRate: number
  readonly outputBits: number
  readonly frames: number
  /** True when the samples came through unchanged, with no resampling or dither. */
  readonly bitPerfect: boolean
}

/**
 * Turns one FLAC Track into an ALAC `.m4a` the iPod plays.
 *
 * The Library file never changes. Tags and Artwork carry over whole, so the
 * result is a full citizen in the Device Database.
 */
export async function transcodeFlacToAlac(input: TranscodeInput): Promise<TranscodeOutput> {
  const stream = await encodeFlacToAlac(input.source, input.ceiling)

  /* The filter tail can run a frame or two past the source, so the file
   * presents exactly the frames the source declared. A source that declares
   * none keeps everything the encoder produced. */
  const expected =
    stream.sourceFrames > 0
      ? Math.ceil((stream.sourceFrames * stream.outputRate) / stream.sourceRate)
      : stream.frames
  const totalFrames = expected < stream.frames ? expected : stream.frames

  const bytes = buildAlacM4a({
    sampleRate: stream.outputRate,
    channels: stream.sourceChannels,
    bitsPerSample: stream.outputBits,
    framesPerPacket: stream.framesPerPacket,
    magicCookie: stream.magicCookie,
    packets: stream.packets,
    totalFrames,
    tags: input.tags,
  })

  return {
    bytes,
    sourceRate: stream.sourceRate,
    sourceBits: stream.sourceBits,
    channels: stream.sourceChannels,
    outputRate: stream.outputRate,
    outputBits: stream.outputBits,
    frames: totalFrames,
    bitPerfect: stream.bitPerfect,
  }
}

export { TRANSCODE_MODULE_VERSION }
export type { AudioCeiling, Mp4Tags }
