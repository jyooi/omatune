import wasmPath from "./wasm/transcode.wasm" with { type: "file" }

/* Bumped whenever the module, the glue, or the resampler changes.
 * The Transcode Cache key carries this value, so a bump retires every
 * cached Transcode without any migration step. */
export const TRANSCODE_MODULE_VERSION = 1

export type AudioCeiling = {
  readonly sampleRate: number
  readonly bitsPerSample: number
}

export type AlacPacket = {
  readonly bytes: Uint8Array
  readonly frames: number
}

export type AlacStream = {
  /** Sample rate, channel count, and depth of the FLAC source. */
  readonly sourceRate: number
  readonly sourceChannels: number
  readonly sourceBits: number
  /** Sample rate and depth the encoder wrote, after the ceiling applies. */
  readonly outputRate: number
  readonly outputBits: number
  /** Frames the source declared, zero when the source did not declare any. */
  readonly sourceFrames: number
  readonly framesPerPacket: number
  /** The ALACSpecificConfig bytes that belong in the `alac` box. */
  readonly magicCookie: Uint8Array
  readonly packets: ReadonlyArray<AlacPacket>
  readonly frames: number
  /** True when the output carries the source samples unchanged. */
  readonly bitPerfect: boolean
}

export class TranscodeError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = "TranscodeError"
    this.code = code
  }
}

const STATUS_TEXT: Record<number, string> = {
  [-1]: "The FLAC decoder did not start.",
  [-2]: "The FLAC stream is damaged.",
  [-3]: "The Track has too many channels.",
  [-4]: "The Transcode engine ran out of memory.",
  [-5]: "The ALAC encoder refused the stream.",
  [-6]: "The Track declares no sample rate.",
}

let modulePromise: Promise<WebAssembly.Module> | null = null

async function loadModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    modulePromise = Bun.file(wasmPath)
      .bytes()
      .then((bytes) => new WebAssembly.Module(bytes))
  }
  return modulePromise
}

/* wasi-libc pulls these in through stdio, and the module never calls them on
 * any path that matters. Each stub reports the WASI code for "not supported"
 * so a surprise call fails loudly instead of returning wrong bytes. */
const WASI_ENOTSUP = 58

function wasiStubs(): Record<string, (...args: number[]) => number> {
  return {
    clock_time_get: () => WASI_ENOTSUP,
    fd_close: () => WASI_ENOTSUP,
    fd_fdstat_get: () => WASI_ENOTSUP,
    fd_prestat_get: () => WASI_ENOTSUP,
    fd_prestat_dir_name: () => WASI_ENOTSUP,
    fd_read: () => WASI_ENOTSUP,
    fd_seek: () => WASI_ENOTSUP,
    fd_write: () => WASI_ENOTSUP,
    proc_exit: () => {
      throw new TranscodeError("The Transcode engine stopped.", -4)
    },
  }
}

/**
 * Decodes one FLAC source and re-encodes it as ALAC packets.
 *
 * The engine downsamples and dithers only when the source is above the
 * ceiling. A source at or below the ceiling comes back bit-perfect.
 */
export async function encodeFlacToAlac(
  source: Uint8Array,
  ceiling: AudioCeiling,
): Promise<AlacStream> {
  const module = await loadModule()

  let readOffset = 0
  const packets: AlacPacket[] = []
  let info: {
    sourceRate: number
    sourceChannels: number
    sourceBits: number
    outputRate: number
    outputBits: number
    framesPerPacket: number
    sourceFrames: number
    magicCookie: Uint8Array
  } | null = null

  let memory: WebAssembly.Memory | null = null
  const view = (): Uint8Array => new Uint8Array(memory!.buffer)

  const imports: WebAssembly.Imports = {
    omatune: {
      read(dst: number, want: number): number {
        const remaining = source.length - readOffset
        const take = remaining < want ? remaining : want
        if (take > 0) {
          view().set(source.subarray(readOffset, readOffset + take), dst)
          readOffset += take
        }
        return take
      },
      info(
        sourceRate: number,
        sourceChannels: number,
        sourceBits: number,
        outputRate: number,
        outputBits: number,
        framesPerPacket: number,
        framesLow: number,
        framesHigh: number,
        cookie: number,
        cookieLength: number,
      ): void {
        info = {
          sourceRate,
          sourceChannels,
          sourceBits,
          outputRate,
          outputBits,
          framesPerPacket,
          sourceFrames: framesHigh * 0x1_0000_0000 + (framesLow >>> 0),
          magicCookie: view().slice(cookie, cookie + cookieLength),
        }
      },
      packet(data: number, length: number, frames: number): void {
        packets.push({ bytes: view().slice(data, data + length), frames })
      },
    },
    wasi_snapshot_preview1: wasiStubs(),
  }

  const instance = await WebAssembly.instantiate(module, imports)
  const exports = instance.exports as {
    memory: WebAssembly.Memory
    _initialize: () => void
    om_transcode: (rate: number, bits: number) => number
  }
  memory = exports.memory
  exports._initialize()

  const status = exports.om_transcode(ceiling.sampleRate, ceiling.bitsPerSample)
  if (status !== 0) {
    throw new TranscodeError(
      STATUS_TEXT[status] ?? `The Transcode engine failed with status ${status}.`,
      status,
    )
  }
  if (!info) {
    throw new TranscodeError("The FLAC stream carries no stream info.", -2)
  }

  const settled = info as NonNullable<typeof info>
  const frames = packets.reduce((sum, packet) => sum + packet.frames, 0)
  return {
    sourceRate: settled.sourceRate,
    sourceChannels: settled.sourceChannels,
    sourceBits: settled.sourceBits,
    outputRate: settled.outputRate,
    outputBits: settled.outputBits,
    sourceFrames: settled.sourceFrames,
    framesPerPacket: settled.framesPerPacket,
    magicCookie: settled.magicCookie,
    packets,
    frames,
    bitPerfect:
      settled.sourceRate === settled.outputRate && settled.sourceBits <= settled.outputBits,
  }
}
