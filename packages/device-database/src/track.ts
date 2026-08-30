import { readU8, readU16, readU32, readU64 } from "./bytes.ts";
import type { Chunk } from "./chunk.ts";
import { mhodType, mhsdType, type Itunesdb } from "./codec.ts";

const MHOD_TITLE = 1;
const MHOD_LOCATION = 2;
const MHOD_ALBUM = 3;
const MHOD_ARTIST = 4;
const MHOD_ALBUM_ARTIST = 22;

const STRING_MHOD_TYPES = new Set([
  MHOD_TITLE,
  MHOD_LOCATION,
  MHOD_ALBUM,
  MHOD_ARTIST,
  MHOD_ALBUM_ARTIST,
]);

export type PlayData = {
  playCount: number;
  skipCount: number;
  rating: number;
  lastPlayed: number;
  lastSkipped: number;
  bookmark: number;
};

export type Gapless = {
  pregap: number;
  sampleCount: bigint;
  postgap: number;
  gaplessData: number;
  gaplessTrackFlag: number;
  gaplessAlbumFlag: number;
};

export type Track = {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  disc: number;
  trackNumber: number;
  duration: number;
  size: number;
  devicePath: string;
  dbid: bigint;
  hasArtwork: boolean;
  playData: PlayData;
  gapless: Gapless;
};

export function tracksOf(db: Itunesdb): Track[] {
  const tracks: Track[] = [];
  for (const section of db.chunk.children) {
    if (section.id !== "mhsd" || mhsdType(section) !== 1) {
      continue;
    }
    for (const list of section.children) {
      if (list.id !== "mhlt") {
        continue;
      }
      for (const item of list.children) {
        if (item.id === "mhit") {
          tracks.push(trackFromMhit(item));
        }
      }
    }
  }
  return tracks;
}

export function trackFromMhit(chunk: Chunk): Track {
  const header = chunk.header;
  const strings = stringMhods(chunk);
  return {
    title: strings.get(MHOD_TITLE) ?? "",
    artist: strings.get(MHOD_ARTIST) ?? "",
    albumArtist: strings.get(MHOD_ALBUM_ARTIST) ?? "",
    album: strings.get(MHOD_ALBUM) ?? "",
    disc: u32At(header, 92),
    trackNumber: u32At(header, 44),
    duration: u32At(header, 40),
    size: u32At(header, 36),
    devicePath: strings.get(MHOD_LOCATION) ?? "",
    dbid: u64At(header, 112),
    hasArtwork: u8At(header, 164) === 1,
    playData: {
      playCount: u32At(header, 80),
      skipCount: u32At(header, 156),
      rating: u8At(header, 31),
      lastPlayed: u32At(header, 88),
      lastSkipped: u32At(header, 160),
      bookmark: u32At(header, 108),
    },
    gapless: {
      pregap: u32At(header, 184),
      sampleCount: u64At(header, 188),
      postgap: u32At(header, 200),
      gaplessData: u32At(header, 248),
      gaplessTrackFlag: u16At(header, 256),
      gaplessAlbumFlag: u16At(header, 258),
    },
  };
}

function stringMhods(chunk: Chunk): Map<number, string> {
  const out = new Map<number, string>();
  for (const child of chunk.children) {
    if (child.id !== "mhod") {
      continue;
    }
    const type = mhodType(child);
    if (!STRING_MHOD_TYPES.has(type)) {
      continue;
    }
    out.set(type, decodeStringMhod(child));
  }
  return out;
}

function decodeStringMhod(chunk: Chunk): string {
  if (chunk.body.byteLength < 16) {
    return "";
  }
  const byteLength = readU32(chunk.body, 4);
  const textStart = 16;
  const textEnd = Math.min(textStart + byteLength, chunk.body.byteLength);
  const text = chunk.body.subarray(textStart, textEnd);
  return new TextDecoder("utf-16le").decode(text);
}

function u8At(header: Uint8Array, offset: number): number {
  if (header.byteLength <= offset) {
    return 0;
  }
  return readU8(header, offset);
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

function u64At(header: Uint8Array, offset: number): bigint {
  if (header.byteLength < offset + 8) {
    return 0n;
  }
  return readU64(header, offset);
}
