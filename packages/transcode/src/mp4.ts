/**
 * A minimal MPEG-4 muxer for ALAC audio.
 *
 * The output carries exactly what an iPod and the tag reader in
 * `packages/core/src/tags.ts` need: one audio track with an `alac` sample
 * entry, the sample tables, and the iTunes metadata atoms.
 *
 * Every field is fixed or derived from the input, so muxing the same stream
 * twice produces the same bytes. The Transcode Cache depends on that.
 */

export type Mp4Tags = {
  readonly title: string | null
  readonly artist: string | null
  readonly album: string | null
  readonly albumArtist: string | null
  readonly track: number | null
  readonly trackTotal: number | null
  readonly disc: number | null
  readonly discTotal: number | null
  readonly compilation: boolean
  readonly artworkBytes: Uint8Array | null
  readonly artworkMime: string | null
}

export type Mp4Input = {
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number
  readonly framesPerPacket: number
  readonly magicCookie: Uint8Array
  readonly packets: ReadonlyArray<{ readonly bytes: Uint8Array; readonly frames: number }>
  /** Frames the file should present. Trailing filter tail beyond this is trimmed. */
  readonly totalFrames: number
  readonly tags: Mp4Tags
}

const MOVIE_TIMESCALE = 1000

/* iTunes data atom type codes. */
const DATA_BINARY = 0
const DATA_UTF8 = 1
const DATA_JPEG = 13
const DATA_PNG = 14
const DATA_SIGNED = 21

function u8(values: ReadonlyArray<number>): Uint8Array {
  return Uint8Array.from(values)
}

function u16(value: number): Uint8Array {
  return u8([(value >> 8) & 0xff, value & 0xff])
}

function u32(value: number): Uint8Array {
  return u8([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0xff
  }
  return out
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let length = 0
  for (const part of parts) {
    length += part.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function box(type: string, ...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const body = concat(parts)
  return concat([u32(body.length + 8), ascii(type), body])
}

function fullBox(type: string, version: number, flags: number, ...parts: ReadonlyArray<Uint8Array>) {
  return box(type, u8([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts)
}

function zeros(count: number): Uint8Array {
  return new Uint8Array(count)
}

/* The unity display matrix every audio-only file carries. */
const UNITY_MATRIX = concat([
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x00010000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
])

function ftyp(): Uint8Array {
  return box("ftyp", ascii("M4A "), u32(0), ascii("M4A "), ascii("mp42"), ascii("isom"))
}

function mvhd(durationMs: number): Uint8Array {
  return fullBox(
    "mvhd",
    0,
    0,
    u32(0),
    u32(0),
    u32(MOVIE_TIMESCALE),
    u32(durationMs),
    u32(0x00010000),
    u16(0x0100),
    zeros(10),
    UNITY_MATRIX,
    zeros(24),
    u32(2),
  )
}

function tkhd(durationMs: number): Uint8Array {
  return fullBox(
    "tkhd",
    0,
    0x000007,
    u32(0),
    u32(0),
    u32(1),
    u32(0),
    u32(durationMs),
    zeros(8),
    u16(0),
    u16(1),
    u16(0x0100),
    u16(0),
    UNITY_MATRIX,
    u32(0),
    u32(0),
  )
}

function mdhd(sampleRate: number, frames: number): Uint8Array {
  // 0x55c4 spells "und" in the packed five-bit language code.
  return fullBox("mdhd", 0, 0, u32(0), u32(0), u32(sampleRate), u32(frames), u16(0x55c4), u16(0))
}

function hdlr(handler: string, name: string): Uint8Array {
  return fullBox("hdlr", 0, 0, u32(0), ascii(handler), zeros(12), ascii(name), u8([0]))
}

function dinf(): Uint8Array {
  // The self-contained flag says the media lives in this same file.
  const url = fullBox("url ", 0, 1)
  return box("dinf", fullBox("dref", 0, 0, u32(1), url))
}

function alacSampleEntry(input: Mp4Input): Uint8Array {
  const child = fullBox("alac", 0, 0, input.magicCookie)
  return box(
    "alac",
    zeros(6),
    u16(1),
    u16(0),
    u16(0),
    u32(0),
    u16(input.channels),
    u16(input.bitsPerSample),
    u16(0),
    u16(0),
    // The sample rate is 16.16 fixed point, which holds every rate the
    // ceiling allows.
    u32((input.sampleRate & 0xffff) << 16),
    child,
  )
}

/* One entry per run of packets that hold the same frame count. The final
 * packet usually holds fewer frames, and the total is trimmed so the file
 * presents exactly the frames the source carried. */
function sttsEntries(input: Mp4Input): ReadonlyArray<{ count: number; delta: number }> {
  const entries: { count: number; delta: number }[] = []
  let remaining = input.totalFrames
  for (const packet of input.packets) {
    const delta = packet.frames < remaining ? packet.frames : remaining
    remaining -= delta
    const last = entries[entries.length - 1]
    if (last && last.delta === delta) {
      last.count += 1
    } else {
      entries.push({ count: 1, delta })
    }
  }
  return entries
}

function stbl(input: Mp4Input, mdatOffset: number): Uint8Array {
  const stsd = fullBox("stsd", 0, 0, u32(1), alacSampleEntry(input))

  const entries = sttsEntries(input)
  const stts = fullBox(
    "stts",
    0,
    0,
    u32(entries.length),
    ...entries.flatMap((entry) => [u32(entry.count), u32(entry.delta)]),
  )

  const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(input.packets.length), u32(1))
  const stsz = fullBox(
    "stsz",
    0,
    0,
    u32(0),
    u32(input.packets.length),
    ...input.packets.map((packet) => u32(packet.bytes.length)),
  )
  const stco = fullBox("stco", 0, 0, u32(1), u32(mdatOffset))
  return box("stbl", stsd, stts, stsc, stsz, stco)
}

function textAtom(type: string, value: string): Uint8Array {
  return box(type, fullBox("data", 0, DATA_UTF8, u32(0), new TextEncoder().encode(value)))
}

function binaryAtom(type: string, flag: number, payload: Uint8Array): Uint8Array {
  return box(type, fullBox("data", 0, flag, u32(0), payload))
}

function freeformAtom(name: string, value: string): Uint8Array {
  return box(
    "----",
    fullBox("mean", 0, 0, ascii("com.apple.iTunes")),
    fullBox("name", 0, 0, ascii(name)),
    fullBox("data", 0, DATA_UTF8, u32(0), new TextEncoder().encode(value)),
  )
}

/* iTunes writes gapless data as twelve hexadecimal fields. Field one is the
 * encoder delay, field two the padding, and field three the frame count.
 * ALAC has no codec delay, so only the frame count carries information. */
export function itunSmpb(frames: number): string {
  const hex8 = "00000000"
  const count = frames.toString(16).toUpperCase().padStart(16, "0")
  return ` ${hex8} ${hex8} ${hex8} ${count} ${Array(8).fill(hex8).join(" ")}`
}

function ilst(input: Mp4Input): Uint8Array {
  const tags = input.tags
  const parts: Uint8Array[] = []
  if (tags.title) {
    parts.push(textAtom("©nam", tags.title))
  }
  if (tags.artist) {
    parts.push(textAtom("©ART", tags.artist))
  }
  if (tags.album) {
    parts.push(textAtom("©alb", tags.album))
  }
  if (tags.albumArtist) {
    parts.push(textAtom("aART", tags.albumArtist))
  }
  if (tags.track !== null) {
    parts.push(
      binaryAtom(
        "trkn",
        DATA_BINARY,
        concat([u16(0), u16(tags.track), u16(tags.trackTotal ?? 0), u16(0)]),
      ),
    )
  }
  if (tags.disc !== null) {
    parts.push(
      binaryAtom("disk", DATA_BINARY, concat([u16(0), u16(tags.disc), u16(tags.discTotal ?? 0)])),
    )
  }
  if (tags.compilation) {
    parts.push(binaryAtom("cpil", DATA_SIGNED, u8([1])))
  }
  if (tags.artworkBytes && tags.artworkBytes.length > 0) {
    const flag = tags.artworkMime === "image/png" ? DATA_PNG : DATA_JPEG
    parts.push(binaryAtom("covr", flag, tags.artworkBytes))
  }
  parts.push(freeformAtom("iTunSMPB", itunSmpb(input.totalFrames)))
  return box("ilst", ...parts)
}

function udta(input: Mp4Input): Uint8Array {
  const meta = fullBox("meta", 0, 0, hdlr("mdir", "appl"), ilst(input))
  return box("udta", meta)
}

function moov(input: Mp4Input, mdatOffset: number): Uint8Array {
  const durationMs = Math.round((input.totalFrames / input.sampleRate) * MOVIE_TIMESCALE)
  const minf = box("minf", fullBox("smhd", 0, 0, u16(0), u16(0)), dinf(), stbl(input, mdatOffset))
  const mdia = box("mdia", mdhd(input.sampleRate, input.totalFrames), hdlr("soun", "SoundHandler"), minf)
  const trak = box("trak", tkhd(durationMs), mdia)
  return box("moov", mvhd(durationMs), trak, udta(input))
}

/**
 * Builds one `.m4a` file around the ALAC packets.
 *
 * The chunk offset table needs the size of `moov`, and `moov` holds that
 * table, so the layout is built twice. The second pass changes only the
 * offset value, which keeps the size identical.
 */
export function buildAlacM4a(input: Mp4Input): Uint8Array {
  const header = ftyp()
  const probe = moov(input, 0)
  const mdatOffset = header.length + probe.length + 8
  const finalMoov = moov(input, mdatOffset)
  if (finalMoov.length !== probe.length) {
    throw new Error("The moov box changed size between passes.")
  }
  const audio = concat(input.packets.map((packet) => packet.bytes))
  return concat([header, finalMoov, box("mdat", audio)])
}
