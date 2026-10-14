/*
 * Clean-room ArtworkDB container codec.
 *
 * Sources:
 * - ipodlinux wiki Artwork Database on ITunesDB:
 *   http://www.ipodlinux.org/ITunesDB/
 * - Repo research notes on branch research/device-database-format-map:
 *   docs/research/device-database-format-map.md
 *
 * Little endian. Unknown header bytes stay opaque.
 * Type 2 mhod rows hold mhni children with ithmb file ids and offsets.
 */

import { readU16, readU32, readU64 } from "./bytes.ts";
import {
  parseChunk,
  parseNamedChunk,
  serializeChunk,
  type Chunk,
  type ParsedChunk,
} from "./chunk.ts";
import { ItunesdbParseError } from "./error.ts";

export type Artworkdb = {
  chunk: Chunk;
};

export type ArtworkThumb = {
  formatId: number;
  offset: number;
  size: number;
  width: number;
  height: number;
  fileName: string;
};

export type ArtworkFile = {
  formatId: number;
  imageSize: number;
};

export function parseMhfd(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhfd", bytes, offset);
}

export function parseMhii(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhii", bytes, offset);
}

export function parseMhni(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhni", bytes, offset);
}

export function parseMhif(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhif", bytes, offset);
}

export function parseMhli(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhli", bytes, offset);
}

export function parseMhlf(bytes: Uint8Array, offset = 0): ParsedChunk {
  return parseNamedChunk("mhlf", bytes, offset);
}

export function serializeMhfd(chunk: Chunk): Uint8Array {
  return serializeNamed("mhfd", chunk);
}

export function serializeMhii(chunk: Chunk): Uint8Array {
  return serializeNamed("mhii", chunk);
}

export function serializeMhni(chunk: Chunk): Uint8Array {
  return serializeNamed("mhni", chunk);
}

export function serializeMhif(chunk: Chunk): Uint8Array {
  return serializeNamed("mhif", chunk);
}

export function serializeMhli(chunk: Chunk): Uint8Array {
  return serializeNamed("mhli", chunk);
}

export function serializeMhlf(chunk: Chunk): Uint8Array {
  return serializeNamed("mhlf", chunk);
}

export function parseArtworkdb(bytes: Uint8Array): Artworkdb {
  const parsed = parseMhfd(bytes, 0);
  if (parsed.size !== bytes.byteLength) {
    throw new ItunesdbParseError(
      `mhfd size ${parsed.size} does not match buffer ${bytes.byteLength}`,
      0,
    );
  }
  return { chunk: parsed.chunk };
}

export function serializeArtworkdb(db: Artworkdb): Uint8Array {
  return serializeMhfd(db.chunk);
}

export function imageItems(db: Artworkdb): Chunk[] {
  return listChildren(db, 1, "mhli", "mhii");
}

export function fileItems(db: Artworkdb): Chunk[] {
  return listChildren(db, 3, "mhlf", "mhif");
}

export function mhiiDbid(chunk: Chunk): bigint {
  if (chunk.header.byteLength < 28) {
    return 0n;
  }
  return readU64(chunk.header, 20);
}

export function mhifFormatId(chunk: Chunk): number {
  return u32At(chunk.header, 16);
}

export function mhifImageSize(chunk: Chunk): number {
  return u32At(chunk.header, 20);
}

export function artworkFiles(db: Artworkdb): ArtworkFile[] {
  return fileItems(db).map((item) => ({
    formatId: mhifFormatId(item),
    imageSize: mhifImageSize(item),
  }));
}

export function thumbnailsOf(mhii: Chunk): ArtworkThumb[] {
  const thumbs: ArtworkThumb[] = [];
  for (const child of mhii.children) {
    if (child.id !== "mhod" || mhodType(child) !== 2) {
      continue;
    }
    if (child.body.byteLength < 12) {
      continue;
    }
    const nested = parseChunk(child.body, 0);
    if (nested.chunk.id !== "mhni") {
      continue;
    }
    thumbs.push(thumbFromMhni(nested.chunk));
  }
  return thumbs;
}

function thumbFromMhni(chunk: Chunk): ArtworkThumb {
  return {
    formatId: u32At(chunk.header, 16),
    offset: u32At(chunk.header, 20),
    size: u32At(chunk.header, 24),
    height: u16At(chunk.header, 32),
    width: u16At(chunk.header, 34),
    fileName: fileNameOf(chunk),
  };
}

function fileNameOf(mhni: Chunk): string {
  for (const child of mhni.children) {
    if (child.id !== "mhod" || mhodType(child) !== 3) {
      continue;
    }
    return decodeArtworkString(child);
  }
  return "";
}

function decodeArtworkString(chunk: Chunk): string {
  if (chunk.body.byteLength < 12) {
    return "";
  }
  const byteLength = readU32(chunk.body, 0);
  const encoding = readU32(chunk.body, 4);
  const textStart = 12;
  const textEnd = Math.min(textStart + byteLength, chunk.body.byteLength);
  const text = chunk.body.subarray(textStart, textEnd);
  if (encoding === 2) {
    return new TextDecoder("utf-16le").decode(text);
  }
  return new TextDecoder("utf-8").decode(text);
}

function listChildren(
  db: Artworkdb,
  sectionType: number,
  listId: string,
  itemId: string,
): Chunk[] {
  const items: Chunk[] = [];
  for (const section of db.chunk.children) {
    if (section.id !== "mhsd" || mhsdType(section) !== sectionType) {
      continue;
    }
    for (const list of section.children) {
      if (list.id !== listId) {
        continue;
      }
      for (const item of list.children) {
        if (item.id === itemId) {
          items.push(item);
        }
      }
    }
  }
  return items;
}

function serializeNamed(id: string, chunk: Chunk): Uint8Array {
  if (chunk.id !== id) {
    throw new ItunesdbParseError(`expected ${id}, found ${chunk.id}`, 0);
  }
  return serializeChunk(chunk);
}

function mhsdType(chunk: Chunk): number {
  return u32At(chunk.header, 12);
}

function mhodType(chunk: Chunk): number {
  return u16At(chunk.header, 12);
}

function u16At(header: Uint8Array, offset: number): number {
  if (header.byteLength < offset + 2) {
    return 0;
  }
  return readU16(header, offset);
}

function u32At(header: Uint8Array, offset: number): number {
  if (header.byteLength < offset + 4) {
    return 0;
  }
  return readU32(header, offset);
}
