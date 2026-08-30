import {
  concatBytes,
  copySlice,
  readFourCc,
  readU32,
  writeU32,
} from "./bytes.ts";
import { ItunesdbParseError } from "./error.ts";

export const LIST_IDS = new Set(["mhlt", "mhlp", "mhla"]);

export type ChunkId =
  | "mhbd"
  | "mhsd"
  | "mhlt"
  | "mhit"
  | "mhod"
  | "mhlp"
  | "mhyp"
  | "mhip"
  | "mhla"
  | "mhia"
  | string;

export type Chunk = {
  id: ChunkId;
  header: Uint8Array;
  children: Chunk[];
  body: Uint8Array;
  padding: Uint8Array;
};

export type ParsedChunk = {
  chunk: Chunk;
  size: number;
};

export function parseChunk(bytes: Uint8Array, offset = 0): ParsedChunk {
  const id = readFourCc(bytes, offset);
  const headerLength = readU32(bytes, offset + 4);
  if (headerLength < 12) {
    throw new ItunesdbParseError(
      `${id} header length ${headerLength} is below 12`,
      offset,
    );
  }
  if (offset + headerLength > bytes.byteLength) {
    throw new ItunesdbParseError(
      `${id} header overruns buffer at ${offset}`,
      offset,
    );
  }
  const field8 = readU32(bytes, offset + 8);
  const header = copySlice(bytes, offset, offset + headerLength);

  if (id === "mhod") {
    if (offset + field8 > bytes.byteLength) {
      throw new ItunesdbParseError(
        `mhod total length ${field8} overruns buffer at ${offset}`,
        offset,
      );
    }
    if (field8 < headerLength) {
      throw new ItunesdbParseError(
        `mhod total length ${field8} is below header length`,
        offset,
      );
    }
    return {
      chunk: {
        id,
        header,
        children: [],
        body: copySlice(bytes, offset + headerLength, offset + field8),
        padding: new Uint8Array(0),
      },
      size: field8,
    };
  }

  if (LIST_IDS.has(id)) {
    const children: Chunk[] = [];
    let pos = offset + headerLength;
    for (let i = 0; i < field8; i += 1) {
      const child = parseChunk(bytes, pos);
      children.push(child.chunk);
      pos += child.size;
    }
    return {
      chunk: {
        id,
        header,
        children,
        body: new Uint8Array(0),
        padding: new Uint8Array(0),
      },
      size: pos - offset,
    };
  }

  if (offset + field8 > bytes.byteLength) {
    throw new ItunesdbParseError(
      `${id} total length ${field8} overruns buffer at ${offset}`,
      offset,
    );
  }
  if (field8 < headerLength) {
    throw new ItunesdbParseError(
      `${id} total length ${field8} is below header length`,
      offset,
    );
  }
  const children: Chunk[] = [];
  let pos = offset + headerLength;
  const end = offset + field8;
  while (pos + 12 <= end) {
    const child = parseChunk(bytes, pos);
    if (pos + child.size > end) {
      throw new ItunesdbParseError(
        `${id} child overruns parent at ${pos}`,
        pos,
      );
    }
    children.push(child.chunk);
    pos += child.size;
  }
  const padding = copySlice(bytes, pos, end);
  return {
    chunk: {
      id,
      header,
      children,
      body: new Uint8Array(0),
      padding,
    },
    size: field8,
  };
}

export function serializeChunk(chunk: Chunk): Uint8Array {
  const childrenBytes = concatBytes(chunk.children.map(serializeChunk));
  const header = chunk.header.slice();
  writeU32(header, 4, header.byteLength);
  if (chunk.id === "mhod") {
    writeU32(header, 8, header.byteLength + chunk.body.byteLength);
    return concatBytes([header, chunk.body]);
  }
  if (LIST_IDS.has(chunk.id)) {
    writeU32(header, 8, chunk.children.length);
    return concatBytes([header, childrenBytes]);
  }
  writeU32(
    header,
    8,
    header.byteLength + childrenBytes.byteLength + chunk.padding.byteLength,
  );
  return concatBytes([header, childrenBytes, chunk.padding]);
}

export function parseNamedChunk(
  id: string,
  bytes: Uint8Array,
  offset = 0,
): ParsedChunk {
  const parsed = parseChunk(bytes, offset);
  if (parsed.chunk.id !== id) {
    throw new ItunesdbParseError(
      `expected ${id}, found ${parsed.chunk.id}`,
      offset,
    );
  }
  return parsed;
}
