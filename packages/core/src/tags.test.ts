import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readTrackTags } from "./tags.ts"

const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")
const PREGAP = join(LIBRARY, "tone-suite/01-pregap.mp3")
const ALPHA = join(LIBRARY, "field-recordings/01-alpha.m4a")

const LAME_GAPLESS = {
  encoderDelay: 576,
  encoderPadding: 1080,
  sampleCount: 88200n,
}

const SMPB =
  " 00000000 000004D2 00000038 00000000000186A0 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000"

test("scanner reads LAME delay, padding, and sample count from the gapless pair", () => {
  const tags = readTrackTags(new Uint8Array(readFileSync(PREGAP)))
  expect(tags.gapless).toEqual(LAME_GAPLESS)
})

test("scanner prefers an iTunSMPB COMM frame over LAME", () => {
  const original = new Uint8Array(readFileSync(PREGAP))
  const bytes = insertId3Frame(original, "COMM", commBody("iTunSMPB", SMPB))
  const tags = readTrackTags(bytes)
  expect(tags.gapless).toEqual({
    encoderDelay: 1234,
    encoderPadding: 56,
    sampleCount: 100000n,
  })
})

test("scanner reads an iTunSMPB TXXX frame", () => {
  const original = new Uint8Array(readFileSync(PREGAP))
  const bytes = insertId3Frame(original, "TXXX", txxxBody("iTunSMPB", SMPB))
  const tags = readTrackTags(bytes)
  expect(tags.gapless).toEqual({
    encoderDelay: 1234,
    encoderPadding: 56,
    sampleCount: 100000n,
  })
})

test("scanner reads iTunSMPB from an m4a atom", () => {
  const smpb =
    " 00000000 00000840 000001C0 0000000000042A00 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000"
  const tags = readTrackTags(m4aWithItunSmpb(smpb))
  expect(tags.gapless).toEqual({
    encoderDelay: 0x840,
    encoderPadding: 0x1c0,
    sampleCount: 0x42a00n,
  })
})

test("m4a without iTunSMPB has no gapless data", () => {
  const tags = readTrackTags(new Uint8Array(readFileSync(ALPHA)))
  expect(tags.gapless).toBeNull()
})

test("FLAC STREAMINFO past 2^32 samples reports the full duration", () => {
  const bytes = new Uint8Array(42)
  bytes[0] = 0x66
  bytes[1] = 0x4c
  bytes[2] = 0x61
  bytes[3] = 0x43
  bytes[4] = 0x80
  bytes[7] = 34
  bytes[18] = 0x0a
  bytes[19] = 0xc4
  bytes[20] = 0x42
  bytes[21] = 0xf1
  bytes[22] = 0x00
  bytes[23] = 0x00
  bytes[24] = 0xac
  bytes[25] = 0x44
  const tags = readTrackTags(bytes)
  expect(tags.durationSeconds).toBe((4294967296 + 44100) / 44100)
})

function insertId3Frame(bytes: Uint8Array, id: string, body: Uint8Array): Uint8Array {
  const version = bytes[3] ?? 0
  const frame = new Uint8Array(10 + body.length)
  frame[0] = id.charCodeAt(0)
  frame[1] = id.charCodeAt(1)
  frame[2] = id.charCodeAt(2)
  frame[3] = id.charCodeAt(3)
  if (version >= 4) {
    writeSynchsafe(frame, 4, body.length)
  } else {
    writeU32be(frame, 4, body.length)
  }
  frame.set(body, 10)
  const oldSize = synchsafe(bytes.subarray(6, 10))
  const out = new Uint8Array(bytes.length + frame.length)
  out.set(bytes.subarray(0, 10), 0)
  out.set(frame, 10)
  out.set(bytes.subarray(10), 10 + frame.length)
  writeSynchsafe(out, 6, oldSize + frame.length)
  return out
}

function commBody(description: string, text: string): Uint8Array {
  const out = new Uint8Array(1 + 3 + description.length + 1 + text.length)
  out[0] = 0
  out[1] = 101
  out[2] = 110
  out[3] = 103
  let i = 4
  for (let j = 0; j < description.length; j += 1) {
    out[i] = description.charCodeAt(j)
    i += 1
  }
  out[i] = 0
  i += 1
  for (let j = 0; j < text.length; j += 1) {
    out[i] = text.charCodeAt(j)
    i += 1
  }
  return out
}

function txxxBody(description: string, text: string): Uint8Array {
  const out = new Uint8Array(1 + description.length + 1 + text.length)
  out[0] = 0
  let i = 1
  for (let j = 0; j < description.length; j += 1) {
    out[i] = description.charCodeAt(j)
    i += 1
  }
  out[i] = 0
  i += 1
  for (let j = 0; j < text.length; j += 1) {
    out[i] = text.charCodeAt(j)
    i += 1
  }
  return out
}

function m4aWithItunSmpb(text: string): Uint8Array {
  const textBytes = new TextEncoder().encode(text)
  const dataPayload = new Uint8Array(8 + textBytes.length)
  writeU32be(dataPayload, 0, 1)
  dataPayload.set(textBytes, 8)
  const mean = atom("mean", paddedName("com.apple.iTunes"))
  const name = atom("name", paddedName("iTunSMPB"))
  const data = atom("data", dataPayload)
  const freeform = atom("----", concat(mean, name, data))
  const ilst = atom("ilst", freeform)
  const meta = atom("meta", concat(new Uint8Array(4), ilst))
  const udta = atom("udta", meta)
  const moov = atom("moov", udta)
  const ftyp = atom("ftyp", new TextEncoder().encode("M4A isom"))
  return concat(ftyp, moov)
}

function paddedName(value: string): Uint8Array {
  const text = new TextEncoder().encode(value)
  const out = new Uint8Array(4 + text.length)
  out.set(text, 4)
  return out
}

function atom(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  writeU32be(out, 0, out.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(body, 8)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function synchsafe(bytes: Uint8Array): number {
  return ((bytes[0] ?? 0) << 21) | ((bytes[1] ?? 0) << 14) | ((bytes[2] ?? 0) << 7) | (bytes[3] ?? 0)
}

function writeSynchsafe(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 21) & 0x7f
  bytes[offset + 1] = (value >> 14) & 0x7f
  bytes[offset + 2] = (value >> 7) & 0x7f
  bytes[offset + 3] = value & 0x7f
}

function writeU32be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}
