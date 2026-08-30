import { ItunesdbParseError } from "./error.ts";

export function readU8(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) {
    throw new ItunesdbParseError(`need 1 byte at ${offset}`, offset);
  }
  return value;
}

export function readU16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 2 bytes at ${offset}`, offset);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
  return view.getUint16(0, true);
}

export function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 4 bytes at ${offset}`, offset);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, true);
}

export function readU64(bytes: Uint8Array, offset: number): bigint {
  if (offset + 8 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 8 bytes at ${offset}`, offset);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

export function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  if (offset + 2 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 2 bytes at ${offset}`, offset);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
  view.setUint16(0, value, true);
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  if (offset + 4 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 4 bytes at ${offset}`, offset);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  view.setUint32(0, value, true);
}

export function readFourCc(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.byteLength) {
    throw new ItunesdbParseError(`need 4 bytes at ${offset}`, offset);
  }
  return String.fromCharCode(
    readU8(bytes, offset),
    readU8(bytes, offset + 1),
    readU8(bytes, offset + 2),
    readU8(bytes, offset + 3),
  );
}

export function copySlice(bytes: Uint8Array, start: number, end: number): Uint8Array {
  if (start < 0 || end > bytes.byteLength || start > end) {
    throw new ItunesdbParseError(`invalid slice ${start}..${end}`, start);
  }
  return bytes.slice(start, end);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
