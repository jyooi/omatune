/*
 * Decode embedded Artwork to RGBA and resize it.
 *
 * JPEG uses jpeg-js, a pure JavaScript baseline decoder with no WASM
 * and no native addon, so a compiled bun binary can load it.
 * jpeg-js does not decode progressive JPEG. This module returns
 * progressive_jpeg for SOF2. The caller skips Artwork for that Track.
 *
 * PNG inflate uses node:zlib. The decoder accepts 8-bit non-interlaced
 * colour types 0, 2, 3, 4, and 6. It rejects 16-bit and Adam7 files.
 *
 * Resize stretches with bilinear sampling to the family thumbnail size.
 */

import { inflateSync } from "node:zlib"
import { decode as decodeJpegBytes } from "jpeg-js"

export type ImageRgba = {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export type DecodeImageFailure = {
  readonly ok: false
  readonly reason: "progressive_jpeg" | "unsupported" | "corrupt"
}

export type DecodeImageResult = { readonly ok: true; readonly image: ImageRgba } | DecodeImageFailure

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

export function decodeEmbeddedImage(bytes: Uint8Array): DecodeImageResult {
  if (isPng(bytes)) {
    return decodePng(bytes)
  }
  if (isJpeg(bytes)) {
    return decodeJpeg(bytes)
  }
  return { ok: false, reason: "unsupported" }
}

export function resizeRgba(image: ImageRgba, width: number, height: number): ImageRgba {
  if (width <= 0 || height <= 0) {
    return { width, height, rgba: new Uint8Array(0) }
  }
  if (image.width === width && image.height === height) {
    return { width, height, rgba: image.rgba.slice() }
  }
  const out = new Uint8Array(width * height * 4)
  const xScale = image.width / width
  const yScale = image.height / height
  for (let y = 0; y < height; y += 1) {
    const srcY = (y + 0.5) * yScale - 0.5
    const y0 = clamp(Math.floor(srcY), 0, image.height - 1)
    const y1 = clamp(y0 + 1, 0, image.height - 1)
    const fy = srcY - y0
    for (let x = 0; x < width; x += 1) {
      const srcX = (x + 0.5) * xScale - 0.5
      const x0 = clamp(Math.floor(srcX), 0, image.width - 1)
      const x1 = clamp(x0 + 1, 0, image.width - 1)
      const fx = srcX - x0
      const dst = (y * width + x) * 4
      for (let c = 0; c < 4; c += 1) {
        const p00 = image.rgba[(y0 * image.width + x0) * 4 + c] ?? 0
        const p10 = image.rgba[(y0 * image.width + x1) * 4 + c] ?? 0
        const p01 = image.rgba[(y1 * image.width + x0) * 4 + c] ?? 0
        const p11 = image.rgba[(y1 * image.width + x1) * 4 + c] ?? 0
        const top = p00 + (p10 - p00) * fx
        const bottom = p01 + (p11 - p01) * fx
        out[dst + c] = Math.round(top + (bottom - top) * fy)
      }
    }
  }
  return { width, height, rgba: out }
}

export function rgbaToRgb888(rgba: Uint8Array): Uint8Array {
  const pixels = Math.floor(rgba.byteLength / 4)
  const rgb = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i += 1) {
    rgb[i * 3] = rgba[i * 4] ?? 0
    rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0
    rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0
  }
  return rgb
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) {
    return false
  }
  for (let i = 0; i < PNG_SIG.length; i += 1) {
    if (bytes[i] !== PNG_SIG[i]) {
      return false
    }
  }
  return true
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function decodeJpeg(bytes: Uint8Array): DecodeImageResult {
  const sof = jpegSofMarker(bytes)
  if (sof === 0xc2) {
    return { ok: false, reason: "progressive_jpeg" }
  }
  if (sof !== 0xc0) {
    return { ok: false, reason: "unsupported" }
  }
  try {
    const decoded = decodeJpegBytes(bytes, { useTArray: true, maxMemoryUsageInMB: 32 })
    if (decoded.width <= 0 || decoded.height <= 0) {
      return { ok: false, reason: "corrupt" }
    }
    return {
      ok: true,
      image: {
        width: decoded.width,
        height: decoded.height,
        rgba: new Uint8Array(decoded.data),
      },
    }
  } catch {
    return { ok: false, reason: "corrupt" }
  }
}

function jpegSofMarker(bytes: Uint8Array): number | null {
  let i = 2
  while (i + 3 < bytes.byteLength) {
    if (bytes[i] !== 0xff) {
      return null
    }
    let marker = bytes[i + 1] ?? 0
    while (marker === 0xff) {
      i += 1
      if (i + 1 >= bytes.byteLength) {
        return null
      }
      marker = bytes[i + 1] ?? 0
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      i += 2
      continue
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      i += 2
      continue
    }
    if (marker === 0xda) {
      return null
    }
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (sof) {
      return marker
    }
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
    if (length < 2) {
      return null
    }
    i += 2 + length
  }
  return null
}

function decodePng(bytes: Uint8Array): DecodeImageResult {
  try {
    return parsePng(bytes)
  } catch {
    return { ok: false, reason: "corrupt" }
  }
}

function parsePng(bytes: Uint8Array): DecodeImageResult {
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = 0
  const idat: Uint8Array[] = []
  let palette: Uint8Array | null = null
  let seenHeader = false
  while (pos + 12 <= bytes.byteLength) {
    const length = readU32be(bytes, pos)
    const type = ascii(bytes.subarray(pos + 4, pos + 8))
    const start = pos + 8
    const end = start + length
    if (end + 4 > bytes.byteLength) {
      return { ok: false, reason: "corrupt" }
    }
    const data = bytes.subarray(start, end)
    if (type === "IHDR") {
      if (data.byteLength < 13) {
        return { ok: false, reason: "corrupt" }
      }
      width = readU32be(data, 0)
      height = readU32be(data, 4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      interlace = data[12] ?? 0
      seenHeader = true
    } else if (type === "PLTE") {
      palette = data.slice()
    } else if (type === "IDAT") {
      idat.push(data.slice())
    } else if (type === "IEND") {
      break
    }
    pos = end + 4
  }
  if (!seenHeader || width <= 0 || height <= 0) {
    return { ok: false, reason: "corrupt" }
  }
  if (bitDepth !== 8 || interlace !== 0) {
    return { ok: false, reason: "unsupported" }
  }
  if (colorType !== 0 && colorType !== 2 && colorType !== 3 && colorType !== 4 && colorType !== 6) {
    return { ok: false, reason: "unsupported" }
  }
  const compressed = concat(idat)
  const raw = new Uint8Array(inflateSync(Buffer.from(compressed)))
  const bpp = bytesPerPixel(colorType)
  const stride = 1 + width * bpp
  if (raw.byteLength < stride * height) {
    return { ok: false, reason: "corrupt" }
  }
  const unfiltered = unfilter(raw, width, height, bpp)
  const rgba = expandRgba(unfiltered, width, height, colorType, palette)
  if (!rgba) {
    return { ok: false, reason: "corrupt" }
  }
  return { ok: true, image: { width, height, rgba } }
}

function bytesPerPixel(colorType: number): number {
  if (colorType === 0 || colorType === 3) {
    return 1
  }
  if (colorType === 4) {
    return 2
  }
  if (colorType === 2) {
    return 3
  }
  return 4
}

function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dest = out.subarray(y * stride, y * stride + stride)
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride)
    for (let i = 0; i < stride; i += 1) {
      const x = row[i] ?? 0
      const a = i >= bpp ? (dest[i - bpp] ?? 0) : 0
      const b = prev ? (prev[i] ?? 0) : 0
      const c = prev && i >= bpp ? (prev[i - bpp] ?? 0) : 0
      let value = x
      if (filter === 1) {
        value = (x + a) & 0xff
      } else if (filter === 2) {
        value = (x + b) & 0xff
      } else if (filter === 3) {
        value = (x + Math.floor((a + b) / 2)) & 0xff
      } else if (filter === 4) {
        value = (x + paeth(a, b, c)) & 0xff
      }
      dest[i] = value
    }
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  }
  if (pb <= pc) {
    return b
  }
  return c
}

function expandRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | null,
): Uint8Array | null {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4
    if (colorType === 0) {
      const g = raw[i] ?? 0
      rgba[o] = g
      rgba[o + 1] = g
      rgba[o + 2] = g
      rgba[o + 3] = 255
    } else if (colorType === 2) {
      rgba[o] = raw[i * 3] ?? 0
      rgba[o + 1] = raw[i * 3 + 1] ?? 0
      rgba[o + 2] = raw[i * 3 + 2] ?? 0
      rgba[o + 3] = 255
    } else if (colorType === 3) {
      const index = raw[i] ?? 0
      if (!palette || index * 3 + 2 >= palette.byteLength) {
        return null
      }
      rgba[o] = palette[index * 3] ?? 0
      rgba[o + 1] = palette[index * 3 + 1] ?? 0
      rgba[o + 2] = palette[index * 3 + 2] ?? 0
      rgba[o + 3] = 255
    } else if (colorType === 4) {
      const g = raw[i * 2] ?? 0
      rgba[o] = g
      rgba[o + 1] = g
      rgba[o + 2] = g
      rgba[o + 3] = raw[i * 2 + 1] ?? 0
    } else {
      rgba[o] = raw[i * 4] ?? 0
      rgba[o + 1] = raw[i * 4 + 1] ?? 0
      rgba[o + 2] = raw[i * 4 + 2] ?? 0
      rgba[o + 3] = raw[i * 4 + 3] ?? 0
    }
  }
  return rgba
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0
  for (const part of parts) {
    total += part.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}
