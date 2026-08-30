import { describe, expect, test } from "bun:test";
import {
  parsePlayCounts,
  playCountsForTracks,
  serializePlayCounts,
} from "../src/index.ts";
import { concat, fourCc, u32 } from "./build.ts";

function mhdp(entries: Uint8Array[], entryLength = 0x1c, headerLength = 0x60): Uint8Array {
  const header = new Uint8Array(headerLength);
  header.set(fourCc("mhdp"), 0);
  header.set(u32(headerLength), 4);
  header.set(u32(entryLength), 8);
  header.set(u32(entries.length), 12);
  return concat(header, ...entries);
}

function entry(fields: {
  playCount: number;
  lastPlayed: number;
  bookmark: number;
  rating: number;
  unknown: number;
  skipCount: number;
  lastSkipped: number;
}): Uint8Array {
  return concat(
    u32(fields.playCount),
    u32(fields.lastPlayed),
    u32(fields.bookmark),
    u32(fields.rating),
    u32(fields.unknown),
    u32(fields.skipCount),
    u32(fields.lastSkipped),
  );
}

const sample = {
  playCount: 3,
  lastPlayed: 100,
  bookmark: 50,
  rating: 80,
  unknown: 7,
  skipCount: 2,
  lastSkipped: 200,
};

describe("Play Counts codec", () => {
  test("round-trips a synthetic file byte for byte", () => {
    const bytes = mhdp([
      entry(sample),
      entry({ ...sample, playCount: 1, rating: 20 }),
    ]);
    const parsed = parsePlayCounts(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("parse failed");
    }
    expect(serializePlayCounts(parsed.value)).toEqual(bytes);
    expect(parsed.value.entryLength).toBe(0x1c);
    expect(parsed.value.entries).toHaveLength(2);
    expect(parsed.value.entries[0]).toMatchObject(sample);
  });

  test("maps entries to Track order by position", () => {
    const bytes = mhdp([
      entry(sample),
      entry({ ...sample, playCount: 9 }),
    ]);
    const parsed = parsePlayCounts(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("parse failed");
    }
    const tracks = [{ title: "First" }, { title: "Second" }];
    const mapped = playCountsForTracks(parsed.value, tracks);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]?.track.title).toBe("First");
    expect(mapped[0]?.entry.playCount).toBe(3);
    expect(mapped[1]?.track.title).toBe("Second");
    expect(mapped[1]?.entry.playCount).toBe(9);
  });

  test("returns a typed error for bad magic", () => {
    const bytes = mhdp([entry(sample)]);
    bytes[0] = "x".charCodeAt(0);
    const parsed = parsePlayCounts(bytes);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected error");
    }
    expect(parsed.error.name).toBe("PlayCountsParseError");
    expect(parsed.error.reason).toBe("bad-magic");
  });

  test("returns a typed error for a short header", () => {
    const parsed = parsePlayCounts(fourCc("mhdp"));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected error");
    }
    expect(parsed.error.reason).toBe("bad-header-length");
  });

  test("returns a typed error for a zero entry length", () => {
    const bytes = mhdp([], 0);
    const parsed = parsePlayCounts(bytes);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected error");
    }
    expect(parsed.error.reason).toBe("bad-entry-length");
  });

  test("returns a typed error when size does not match", () => {
    const bytes = mhdp([entry(sample)]);
    const parsed = parsePlayCounts(bytes.subarray(0, bytes.byteLength - 4));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected error");
    }
    expect(parsed.error.reason).toBe("size-mismatch");
  });

  test("does not throw on corrupt input", () => {
    expect(() => parsePlayCounts(new Uint8Array(0))).not.toThrow();
    expect(() => parsePlayCounts(fourCc("xxxx"))).not.toThrow();
  });
});
