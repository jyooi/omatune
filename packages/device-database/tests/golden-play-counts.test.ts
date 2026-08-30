import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  parseItunesdb,
  parsePlayCounts,
  playCountsForTracks,
  serializePlayCounts,
  tracksOf,
} from "../src/index.ts";
import { goldenCases, itunesdbPath, playCountsPath } from "./fixture-paths.ts";

const cases = goldenCases().filter((fixture) => existsSync(playCountsPath(fixture.dir)));
const skip = cases.length === 0;

describe("S2 golden Play Counts", () => {
  test.skipIf(skip)(
    skip
      ? "parses Fixture Play Counts files (skipped: no Fixture is present)"
      : "parses Fixture Play Counts files, serialises, and matches every byte",
    async () => {
      for (const fixture of cases) {
        const bytes = await Bun.file(playCountsPath(fixture.dir)).bytes();
        const parsed = parsePlayCounts(bytes);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
          throw new Error(parsed.error.message);
        }
        const out = serializePlayCounts(parsed.value);
        expect(firstMismatch(bytes, out)).toBe(-1);
        expect(out.byteLength).toBe(bytes.byteLength);
        expect(parsed.value.entryLength).toBe(0x1c);
        expect(parsed.value.entries.length).toBeGreaterThan(0);
        const itunesdb = parseItunesdb(await Bun.file(itunesdbPath(fixture.dir)).bytes());
        const tracks = tracksOf(itunesdb);
        const mapped = playCountsForTracks(parsed.value, tracks);
        expect(mapped.length).toBe(tracks.length);
        expect(mapped.length).toBe(parsed.value.entries.length);
        const first = mapped[0];
        if (!first) {
          throw new Error(`missing mapped entry in ${fixture.name}`);
        }
        expect(typeof first.entry.playCount).toBe("number");
        expect(typeof first.entry.lastPlayed).toBe("number");
        expect(typeof first.entry.bookmark).toBe("number");
        expect(typeof first.entry.rating).toBe("number");
        expect(typeof first.entry.unknown).toBe("number");
        expect(typeof first.entry.skipCount).toBe("number");
        expect(typeof first.entry.lastSkipped).toBe("number");
      }
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
