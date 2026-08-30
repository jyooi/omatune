/*
 * Clean-room iTunesDB container codec.
 *
 * Sources:
 * - ipodlinux wiki ITunesDB File, Wayback 2016:
 *   https://web.archive.org/web/2016/http://www.ipodlinux.org/ITunesDB/iTunesDB_File.html
 * - ipodlinux wiki ITunesDB, Wayback 2012:
 *   https://web.archive.org/web/2012/http://ipodlinux.org/wiki/ITunesDB
 * - Repo research notes on branch research/device-database-format-map:
 *   docs/research/device-database-format-map.md
 *
 * Little endian. Unknown header bytes and unknown mhod types stay opaque.
 * Hash slots at 0x58 (20 bytes) and 0x72 (46 bytes) stay opaque.
 */

import { copySlice, readU16, readU32 } from "./bytes.ts";
import {
  parseNamedChunk,
  serializeChunk,
  type Chunk,
  type ParsedChunk,
} from "./chunk.ts";
import { ItunesdbParseError } from "./error.ts";

export const HASH58_OFFSET = 0x58;
export const HASH58_LENGTH = 20;
export const HASH72_OFFSET = 0x72;
export const HASH72_LENGTH = 46;
export const VERSION_OFFSET = 16;

export type Itunesdb = {
  chunk: Chunk;
};

export function parseMhbd(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhbd", bytes, offset);
}

export function parseMhsd(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhsd", bytes, offset);
}

export function parseMhlt(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhlt", bytes, offset);
}

export function parseMhit(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhit", bytes, offset);
}

export function parseMhod(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhod", bytes, offset);
}

export function parseMhlp(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhlp", bytes, offset);
}

export function parseMhyp(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhyp", bytes, offset);
}

export function parseMhip(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhip", bytes, offset);
}

export function serializeMhbd(chunk: Chunk): Uint8Array {
  return serializeNamed("mhbd", chunk);
}

export function serializeMhsd(chunk: Chunk): Uint8Array {
  return serializeNamed("mhsd", chunk);
}

export function serializeMhlt(chunk: Chunk): Uint8Array {
  return serializeNamed("mhlt", chunk);
}

export function serializeMhit(chunk: Chunk): Uint8Array {
  return serializeNamed("mhit", chunk);
}

export function serializeMhod(chunk: Chunk): Uint8Array {
  return serializeNamed("mhod", chunk);
}

export function serializeMhlp(chunk: Chunk): Uint8Array {
  return serializeNamed("mhlp", chunk);
}

export function serializeMhyp(chunk: Chunk): Uint8Array {
  return serializeNamed("mhyp", chunk);
}

export function serializeMhip(chunk: Chunk): Uint8Array {
  return serializeNamed("mhip", chunk);
}

export function parseItunesdb(bytes: Uint8Array): Itunesdb {
  const parsed = parseMhbd(bytes, 0);
  if (parsed.size !== bytes.byteLength) {
    throw new ItunesdbParseError(
      `mhbd size ${parsed.size} does not match buffer ${bytes.byteLength}`,
      0,
    );
  }
  return { chunk: parsed.chunk };
}

export function serializeItunesdb(db: Itunesdb): Uint8Array {
  return serializeMhbd(db.chunk);
}

export function databaseVersion(db: Itunesdb): number {
  return readU32(db.chunk.header, VERSION_OFFSET);
}

export function hash58(db: Itunesdb): Uint8Array {
  return hashSlot(db.chunk.header, HASH58_OFFSET, HASH58_LENGTH);
}

export function hash72(db: Itunesdb): Uint8Array {
  return hashSlot(db.chunk.header, HASH72_OFFSET, HASH72_LENGTH);
}

function serializeNamed(id: string, chunk: Chunk): Uint8Array {
  if (chunk.id !== id) {
    throw new ItunesdbParseError(`expected ${id}, found ${chunk.id}`, 0);
  }
  return serializeChunk(chunk);
}

function hashSlot(header: Uint8Array, offset: number, length: number): Uint8Array {
  if (header.byteLength < offset + length) {
    return new Uint8Array(length);
  }
  return copySlice(header, offset, offset + length);
}

export function mhsdType(chunk: Chunk): number {
  return readU32(chunk.header, 12);
}

export function mhodType(chunk: Chunk): number {
  return readU32(chunk.header, 12);
}

export function hashingScheme(db: Itunesdb): number {
  if (db.chunk.header.byteLength < 50) {
    return 0;
  }
  return readU16(db.chunk.header, 48);
}
