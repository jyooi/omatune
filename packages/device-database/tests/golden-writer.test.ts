/*
 * Structural net for the writer against a genuine CLASSIC_2 Fixture.
 *
 * PR #22 already held media type, file type, format bytes, gapless flags,
 * the master playlist flag, and mhod counts to firmwareProblems. This file
 * is the remaining field-class net: section types 1, 2, and 3, the master
 * playlist persistent id, and the mhbd hash slots.
 *
 * Comparison is structural. iTunes writes mhla and mhsd 5. omatune omits
 * those on purpose, so this test must not demand them.
 *
 * The CLASSIC_2 Device Checklist is already complete (HUF-275).
 */

import { describe, expect, test } from "bun:test";
import {
  HASH58_LENGTH,
  HASH72_LENGTH,
  MHIT_FILE_TYPE,
  MHIT_TYPE_1,
  MHIT_TYPE_2,
  MHYP_MASTER_FLAG,
  MHYP_PERSISTENT_ID,
  buildSyntheticItunesdb,
  firmwareProblems,
  hash58,
  hash72,
  mhsdType,
  parseItunesdb,
  type Itunesdb,
  type SyntheticTrack,
} from "../src/index.ts";
import { goldenCases, itunesdbPath } from "./fixture-paths.ts";

const cases = goldenCases();
const skip = cases.length === 0;

describe("S2 golden writer", () => {
  test.skipIf(skip)(
    skip
      ? "Fixture iTunesDB field classes (skipped: no Fixture is present)"
      : "Fixture iTunesDB files break no firmware rule and may include iTunes-only sections",
    async () => {
      for (const fixture of cases) {
        const db = parseItunesdb(await Bun.file(itunesdbPath(fixture.dir)).bytes());
        expect(problemLines(fixture.name, db)).toEqual([]);
        const types = sectionTypes(db);
        expect(types).toContain(1);
        expect(types).toContain(2);
        expect(types).toContain(3);
        expect(types.includes(4) || types.includes(5) || hasList(db, "mhla")).toBe(true);
        expect(hash58(db).byteLength).toBe(HASH58_LENGTH);
        expect(hash72(db).byteLength).toBe(HASH72_LENGTH);
        expect(masterPlaylists(db).length).toBeGreaterThan(0);
        for (const playlist of masterPlaylists(db)) {
          expect(playlist.header[MHYP_MASTER_FLAG]).toBe(1);
          expect(persistentId(playlist.header)).not.toBe(0n);
        }
      }
    },
  );

  test.skipIf(skip)(
    skip
      ? "writer field classes (skipped: no Fixture is present)"
      : "writer output carries every firmware field class and omits mhla and mhsd 5",
    () => {
      const db = buildSyntheticItunesdb([syntheticTrack(1, "mp3"), syntheticTrack(2, "m4a")]);
      expect(problemLines("writer", db)).toEqual([]);
      const types = sectionTypes(db);
      expect(types).toContain(1);
      expect(types).toContain(2);
      expect(types).toContain(3);
      expect(types).not.toContain(4);
      expect(types).not.toContain(5);
      expect(hasList(db, "mhla")).toBe(false);
      expect(hash58(db).byteLength).toBe(HASH58_LENGTH);
      expect(hash72(db).byteLength).toBe(HASH72_LENGTH);
      const masters = masterPlaylists(db);
      expect(masters.length).toBeGreaterThan(0);
      for (const playlist of masters) {
        expect(playlist.header[MHYP_MASTER_FLAG]).toBe(1);
        expect(persistentId(playlist.header)).not.toBe(0n);
      }
      expect(fileTypeOf(db, 0)).toEqual({ code: "MP3 ", type1: 0, type2: 1 });
      expect(fileTypeOf(db, 1)).toEqual({ code: "M4A ", type1: 1, type2: 0 });
    },
  );
});

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

function problemLines(name: string, db: Itunesdb): string[] {
  return firmwareProblems(db).map((problem) => `${name} ${problem.where}: ${problem.detail}`);
}

function sectionTypes(db: Itunesdb): number[] {
  return db.chunk.children.filter((chunk) => chunk.id === "mhsd").map((chunk) => mhsdType(chunk));
}

function hasList(db: Itunesdb, id: string): boolean {
  for (const section of db.chunk.children) {
    if (section.children.some((child) => child.id === id)) {
      return true;
    }
  }
  return false;
}

function masterPlaylists(db: Itunesdb) {
  const out: Array<(typeof db.chunk.children)[number]> = [];
  for (const section of db.chunk.children) {
    for (const list of section.children) {
      for (const playlist of list.children) {
        if (playlist.id === "mhyp" && playlist.header[MHYP_MASTER_FLAG] === 1) {
          out.push(playlist);
        }
      }
    }
  }
  return out;
}

function persistentId(header: Uint8Array): bigint {
  if (header.byteLength < MHYP_PERSISTENT_ID + 8) {
    return 0n;
  }
  const view = new DataView(header.buffer, header.byteOffset + MHYP_PERSISTENT_ID, 8);
  return view.getBigUint64(0, true);
}

function fileTypeOf(db: Itunesdb, index: number): { code: string; type1: number; type2: number } {
  for (const section of db.chunk.children) {
    if (section.id !== "mhsd" || mhsdType(section) !== 1) {
      continue;
    }
    for (const list of section.children) {
      const mhit = list.children.filter((child) => child.id === "mhit")[index];
      if (!mhit) {
        throw new Error(`missing mhit ${index}`);
      }
      const header = mhit.header;
      return {
        code: String.fromCharCode(
          header[MHIT_FILE_TYPE + 3] ?? 0,
          header[MHIT_FILE_TYPE + 2] ?? 0,
          header[MHIT_FILE_TYPE + 1] ?? 0,
          header[MHIT_FILE_TYPE] ?? 0,
        ),
        type1: header[MHIT_TYPE_1] ?? 0,
        type2: header[MHIT_TYPE_2] ?? 0,
      };
    }
  }
  throw new Error("missing track section");
}
