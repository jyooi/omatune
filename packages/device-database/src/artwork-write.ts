/*
 * ArtworkDB writer for one mhii per Track that has Artwork.
 * Thumbnail bytes live in ithmb files named F<formatId>_1.ithmb.
 *
 * Layout matches the synthetic builder in tests/artwork-build.ts
 * and the ipodlinux Artwork Database notes.
 */

import type { Artworkdb } from "./artwork.ts";
import { writeU16, writeU32 } from "./bytes.ts";
import { serializeChunk, type Chunk } from "./chunk.ts";

export type ArtworkThumbSpec = {
  readonly formatId: number;
  readonly offset: number;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly fileName: string;
};

export type ArtworkImageSpec = {
  readonly dbid: bigint;
  readonly imageId: number;
  readonly thumbs: ReadonlyArray<ArtworkThumbSpec>;
};

export type ArtworkFileSpec = {
  readonly formatId: number;
  readonly imageSize: number;
};

const MHFD_HEADER = 132;
const MHSD_HEADER = 96;
const LIST_HEADER = 92;
const MHII_HEADER = 152;
const MHNI_HEADER = 76;
const MHIF_HEADER = 124;
const MHOD_HEADER = 24;

export function buildArtworkdb(
  images: ReadonlyArray<ArtworkImageSpec>,
  files: ReadonlyArray<ArtworkFileSpec>,
): Artworkdb {
  const mhiis = images.map((image) => mhiiOf(image));
  const mhifs = files.map((file) => mhifOf(file));
  const sections = [
    mhsdOf(1, listOf("mhli", mhiis)),
    mhsdOf(2, listOf("mhla", [])),
    mhsdOf(3, listOf("mhlf", mhifs)),
  ];
  return { chunk: mhfdOf(sections) };
}

function mhfdOf(sections: Chunk[]): Chunk {
  const header = new Uint8Array(MHFD_HEADER);
  writeFourCc(header, 0, "mhfd");
  writeU32(header, 16, 2);
  writeU32(header, 20, sections.length);
  writeU32(header, 48, 2);
  return { id: "mhfd", header, children: sections, body: empty(), padding: empty() };
}

function mhsdOf(type: number, child: Chunk): Chunk {
  const header = new Uint8Array(MHSD_HEADER);
  writeFourCc(header, 0, "mhsd");
  writeU32(header, 12, type);
  return { id: "mhsd", header, children: [child], body: empty(), padding: empty() };
}

function listOf(id: "mhli" | "mhla" | "mhlf", children: Chunk[]): Chunk {
  const header = new Uint8Array(LIST_HEADER);
  writeFourCc(header, 0, id);
  return { id, header, children, body: empty(), padding: empty() };
}

function mhiiOf(image: ArtworkImageSpec): Chunk {
  const thumbs = image.thumbs.map((thumb) => containerMhod(mhniOf(thumb)));
  const header = new Uint8Array(MHII_HEADER);
  writeFourCc(header, 0, "mhii");
  writeU32(header, 12, thumbs.length);
  writeU32(header, 16, image.imageId);
  writeU64(header, 20, image.dbid);
  return { id: "mhii", header, children: thumbs, body: empty(), padding: empty() };
}

function mhniOf(thumb: ArtworkThumbSpec): Chunk {
  const name = artworkStringMhod(3, thumb.fileName);
  const header = new Uint8Array(MHNI_HEADER);
  writeFourCc(header, 0, "mhni");
  writeU32(header, 12, 1);
  writeU32(header, 16, thumb.formatId);
  writeU32(header, 20, thumb.offset);
  writeU32(header, 24, thumb.size);
  writeU16(header, 32, thumb.height);
  writeU16(header, 34, thumb.width);
  writeU32(header, 40, thumb.size);
  return { id: "mhni", header, children: [name], body: empty(), padding: empty() };
}

function mhifOf(file: ArtworkFileSpec): Chunk {
  const header = new Uint8Array(MHIF_HEADER);
  writeFourCc(header, 0, "mhif");
  writeU32(header, 16, file.formatId);
  writeU32(header, 20, file.imageSize);
  return { id: "mhif", header, children: [], body: empty(), padding: empty() };
}

function containerMhod(child: Chunk): Chunk {
  const header = new Uint8Array(MHOD_HEADER);
  writeFourCc(header, 0, "mhod");
  writeU16(header, 12, 2);
  return {
    id: "mhod",
    header,
    children: [],
    body: serializeChunk(child),
    padding: empty(),
  };
}

function artworkStringMhod(type: number, text: string): Chunk {
  const encoded = encodeUtf16le(text);
  const body = new Uint8Array(12 + encoded.byteLength);
  writeU32(body, 0, encoded.byteLength);
  writeU32(body, 4, 2);
  body.set(encoded, 12);
  const header = new Uint8Array(MHOD_HEADER);
  writeFourCc(header, 0, "mhod");
  writeU16(header, 12, type);
  return { id: "mhod", header, children: [], body, padding: empty() };
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return out;
}

function empty(): Uint8Array {
  return new Uint8Array(0);
}

function writeFourCc(bytes: Uint8Array, offset: number, id: string): void {
  bytes[offset] = id.charCodeAt(0);
  bytes[offset + 1] = id.charCodeAt(1);
  bytes[offset + 2] = id.charCodeAt(2);
  bytes[offset + 3] = id.charCodeAt(3);
}

function writeU64(bytes: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  view.setBigUint64(0, value, true);
}
