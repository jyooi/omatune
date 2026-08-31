/*
 * Unit cover for the rules in src/firmware.ts.
 *
 * The golden test proves the rules match genuine iTunes output. These tests
 * prove each rule still fires when a writer breaks it.
 */

import { describe, expect, test } from "bun:test";
import {
  MHIT_GAPLESS_ALBUM_FLAG,
  MHIT_MEDIA_TYPE,
  MHYP_MASTER_FLAG,
  buildSyntheticItunesdb,
  fileTypeCodeFor,
  firmwareProblems,
  firmwareReadable,
  formatBytesFor,
  parseItunesdb,
  serializeItunesdb,
  type SyntheticTrack,
} from "../src/index.ts";

function syntheticTrack(index: number, extension: string): SyntheticTrack {
  return {
    path: `library/album/${index}.${extension}`,
    codec: extension === "mp3" ? "mp3" : "alac",
    title: `Track ${index}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    track: index,
    disc: 1,
    artwork: false,
    durationSeconds: 2,
    gapless: null,
    size: 1000 + index,
    devicePath: `iPod_Control/Music/F00/${index}.${extension}`,
    dbid: BigInt(index + 1),
    sha256: "0".repeat(64),
  };
}

function database(extension = "m4a") {
  return buildSyntheticItunesdb([syntheticTrack(1, extension), syntheticTrack(2, extension)]);
}

function rulesFired(bytes: Uint8Array): string[] {
  return [...new Set(firmwareProblems(parseItunesdb(bytes)).map((problem) => problem.rule))].sort();
}

/* Finds every mhit header start, so a test can poke one field on each. */
function mhitOffsets(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= bytes.byteLength; i += 1) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x68 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x74) {
      out.push(i);
    }
  }
  return out;
}

describe("firmware rules", () => {
  test("a database from the current writer breaks no rule", () => {
    expect(firmwareReadable(database())).toBe(true);
  });

  test("a zero media type is reported on every Track", () => {
    const bytes = serializeItunesdb(database());
    for (const offset of mhitOffsets(bytes)) {
      bytes.fill(0, offset + MHIT_MEDIA_TYPE, offset + MHIT_MEDIA_TYPE + 4);
    }
    expect(rulesFired(bytes)).toEqual(["media-type"]);
  });

  test("a set gapless album flag is reported", () => {
    const bytes = serializeItunesdb(database());
    for (const offset of mhitOffsets(bytes)) {
      bytes[offset + MHIT_GAPLESS_ALBUM_FLAG] = 1;
    }
    expect(rulesFired(bytes)).toEqual(["gapless-album-flag"]);
  });

  test("a playlist without the master flag is reported", () => {
    const db = database();
    for (const section of db.chunk.children) {
      for (const list of section.children) {
        for (const playlist of list.children) {
          if (playlist.id === "mhyp") {
            playlist.header[MHYP_MASTER_FLAG] = 0;
          }
        }
      }
    }
    expect(rulesFired(serializeItunesdb(db))).toEqual(["master-playlist"]);
  });

  test("an mhip that claims a child mhod it does not hold is reported", () => {
    const db = database();
    for (const section of db.chunk.children) {
      for (const list of section.children) {
        for (const playlist of list.children) {
          for (const item of playlist.children) {
            if (item.id === "mhip") {
              item.header[12] = 1;
            }
          }
        }
      }
    }
    expect(rulesFired(serializeItunesdb(db))).toEqual(["mhod-count"]);
  });

  test("the file type code follows the Device file extension", () => {
    expect(fileTypeCodeFor("mp3")).toBe("MP3 ");
    expect(fileTypeCodeFor(".m4a")).toBe("M4A ");
    expect(fileTypeCodeFor("M4A")).toBe("M4A ");
    expect(formatBytesFor("mp3")).toEqual({ type1: 0, type2: 1 });
    expect(formatBytesFor("m4a")).toEqual({ type1: 1, type2: 0 });
  });
});
