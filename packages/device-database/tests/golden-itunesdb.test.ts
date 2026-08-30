import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  databaseVersion,
  hash58,
  hash72,
  parseItunesdb,
  serializeItunesdb,
  tracksOf,
} from "../src/index.ts";

const packageRoot = join(import.meta.dir, "..");
const fixturePath = join(
  packageRoot,
  "..",
  "..",
  "fixtures",
  "device",
  "ipod-classic-120gb",
  "iTunes",
  "iTunesDB",
);
const fixturePresent = existsSync(fixturePath);
const goldenTitle = fixturePresent
  ? "parses the Fixture iTunesDB, serialises, and matches every byte"
  : "parses the Fixture iTunesDB, serialises, and matches every byte (skipped: private Fixture is absent)";

describe("S2 golden iTunesDB", () => {
  test.skipIf(!fixturePresent)(goldenTitle, async () => {
    const bytes = await Bun.file(fixturePath).bytes();
    const db = parseItunesdb(bytes);
    const out = serializeItunesdb(db);
    const mismatch = firstMismatch(bytes, out);
    expect(mismatch).toBe(-1);
    expect(out.byteLength).toBe(bytes.byteLength);
    expect(databaseVersion(db)).toBeGreaterThan(0);
    expect(hash58(db).byteLength).toBe(20);
    expect(hash72(db).byteLength).toBe(46);
    const tracks = tracksOf(db);
    expect(tracks.length).toBeGreaterThan(0);
    const track = tracks[0];
    if (!track) {
      throw new Error("missing Track");
    }
    expect(typeof track.title).toBe("string");
    expect(typeof track.artist).toBe("string");
    expect(typeof track.albumArtist).toBe("string");
    expect(typeof track.album).toBe("string");
    expect(typeof track.devicePath).toBe("string");
    expect(typeof track.disc).toBe("number");
    expect(typeof track.trackNumber).toBe("number");
    expect(typeof track.duration).toBe("number");
    expect(typeof track.size).toBe("number");
    expect(typeof track.dbid).toBe("bigint");
    expect(typeof track.hasArtwork).toBe("boolean");
    expect(typeof track.playData.playCount).toBe("number");
    expect(typeof track.playData.skipCount).toBe("number");
    expect(typeof track.playData.rating).toBe("number");
    expect(typeof track.playData.lastPlayed).toBe("number");
    expect(typeof track.playData.lastSkipped).toBe("number");
    expect(typeof track.playData.bookmark).toBe("number");
    expect(typeof track.gapless.pregap).toBe("number");
    expect(typeof track.gapless.sampleCount).toBe("bigint");
    expect(typeof track.gapless.postgap).toBe("number");
    expect(typeof track.gapless.gaplessData).toBe("number");
    expect(typeof track.gapless.gaplessTrackFlag).toBe("number");
    expect(typeof track.gapless.gaplessAlbumFlag).toBe("number");
    expect(track.devicePath.startsWith(":")).toBe(true);
  });

  test.skipIf(!fixturePresent)(
    "Fixture gapless fields survive parse and re-serialise",
    async () => {
      const bytes = await Bun.file(fixturePath).bytes();
      const parsed = parseItunesdb(bytes);
      const first = tracksOf(parsed);
      const second = tracksOf(parseItunesdb(serializeItunesdb(parsed)));
      expect(second.map((track) => track.gapless)).toEqual(first.map((track) => track.gapless));
    },
  );
});

function firstMismatch(left: Uint8Array, right: Uint8Array): number {
  const limit = Math.min(left.byteLength, right.byteLength);
  for (let i = 0; i < limit; i += 1) {
    if (left[i] !== right[i]) {
      return i;
    }
  }
  if (left.byteLength !== right.byteLength) {
    return limit;
  }
  return -1;
}
