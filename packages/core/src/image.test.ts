import { expect, test } from "bun:test"
import { crc32, deflateSync } from "node:zlib"
import { encode } from "jpeg-js"
import { decodeEmbeddedImage, resizeRgba, rgbaToRgb888 } from "./image.ts"

test("decodes an 8-bit RGB PNG", () => {
  const png = pngSolid(2, 2, [196, 30, 58])
  const result = decodeEmbeddedImage(png)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }
  expect(result.image.width).toBe(2)
  expect(result.image.height).toBe(2)
  expect(Array.from(result.image.rgba.subarray(0, 3))).toEqual([196, 30, 58])
  expect(result.image.rgba[3]).toBe(255)
})

test("decodes a baseline JPEG", () => {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let i = 0; i < 8 * 8; i += 1) {
    rgba[i * 4] = 30
    rgba[i * 4 + 1] = 144
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = 255
  }
  const jpeg = encode({ data: rgba, width: 8, height: 8 }, 100)
  const result = decodeEmbeddedImage(new Uint8Array(jpeg.data))
  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }
  expect(result.image.width).toBe(8)
  expect(result.image.height).toBe(8)
})

test("marks progressive JPEG as skipped for Artwork", () => {
  const bytes = Uint8Array.of(
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
  const result = decodeEmbeddedImage(bytes)
  expect(result).toEqual({ ok: false, reason: "progressive_jpeg" })
})

test("resizes RGBA with bilinear sampling", () => {
  const src = {
    width: 1,
    height: 1,
    rgba: Uint8Array.of(10, 20, 30, 255),
  }
  const out = resizeRgba(src, 2, 2)
  expect(out.width).toBe(2)
  expect(out.height).toBe(2)
  expect(Array.from(out.rgba.subarray(0, 4))).toEqual([10, 20, 30, 255])
  expect(rgbaToRgb888(out.rgba)).toEqual(Uint8Array.of(10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30))
})

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
