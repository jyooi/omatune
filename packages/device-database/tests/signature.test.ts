import { describe, expect, test } from "bun:test";
import {
  HASH58_LENGTH,
  HASH58_OFFSET,
  HASH72_LENGTH,
  HASH72_OFFSET,
  firewireIdFromSerial,
  hashingScheme,
  lookupByLibgpodKey,
  parseItunesdb,
  signItunesdb,
  signItunesdbForFamily,
  ItunesdbSignatureError,
} from "../src/index.ts";
import { mhbd, mhsd, mhlt, mhitWith } from "./build.ts";

const serial = "0011223344556677";
const otherSerial = "7766554433221100";

const sampleTrack = {
  title: "Alpha",
  artist: "Beta",
  albumArtist: "Gamma",
  album: "Delta",
  location: ":iPod_Control:Music:F00:alpha.mp3",
  disc: 1,
  trackNumber: 1,
  duration: 1000,
  size: 2000,
  dbid: 0x1122334455667788n,
  hasArtwork: false,
  playCount: 0,
  skipCount: 0,
  rating: 0,
  lastPlayed: 0,
  lastSkipped: 0,
  bookmark: 0,
  pregap: 0,
  sampleCount: 0n,
  postgap: 0,
  gaplessData: 0,
  gaplessTrackFlag: 0,
  gaplessAlbumFlag: 0,
};

function sampleDb(options?: { hash58?: Uint8Array; hash72?: Uint8Array }): Uint8Array {
  return mhbd([mhsd(1, mhlt([mhitWith(sampleTrack)]))], options);
}

describe("iTunesDB signature", () => {
  test("hash58 is a pure function from bytes plus serial to bytes", () => {
    const bytes = sampleDb();
    const snapshot = bytes.slice();
    const first = signItunesdb(bytes, serial, "hash58");
    const second = signItunesdb(bytes, serial, "hash58");
    expect(first).toEqual(second);
    expect(bytes).toEqual(snapshot);
    expect(first.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(
      bytes.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH),
    );
    expect(hashingScheme(parseItunesdb(first))).toBe(1);
    expect(first.slice(0x18, 0x20)).toEqual(bytes.slice(0x18, 0x20));
    expect(first.slice(0x32, 0x46)).toEqual(bytes.slice(0x32, 0x46));
    expect(first.slice(HASH72_OFFSET, HASH72_OFFSET + HASH72_LENGTH)).toEqual(
      bytes.slice(HASH72_OFFSET, HASH72_OFFSET + HASH72_LENGTH),
    );
  });

  test("a modified iTunesDB produces a different hash58", () => {
    const bytes = sampleDb();
    const signed = signItunesdb(bytes, serial, "hash58");
    const changed = bytes.slice();
    const poke = HASH58_OFFSET + HASH58_LENGTH + 8;
    const prior = changed[poke] ?? 0;
    changed[poke] = prior ^ 0x01;
    const other = signItunesdb(changed, serial, "hash58");
    expect(other.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(
      signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH),
    );
    expect(signItunesdb(bytes, otherSerial, "hash58").slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(
      signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH),
    );
  });

  test("a family with no signature zeroes the slots", () => {
    const mini = lookupByLibgpodKey("MINI_1");
    if (!mini) {
      throw new Error("missing mini family");
    }
    expect(mini.signature).toBe("none");
    const bytes = sampleDb({
      hash58: new Uint8Array(20).fill(0xaa),
      hash72: new Uint8Array(46).fill(0xbb),
    });
    const signed = signItunesdbForFamily(bytes, serial, mini);
    expect(hashingScheme(parseItunesdb(signed))).toBe(0);
    expect(signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).toEqual(new Uint8Array(20));
    expect(signed.slice(HASH72_OFFSET, HASH72_OFFSET + HASH72_LENGTH)).toEqual(new Uint8Array(46));
  });

  test("classic family selects hash58", () => {
    const classic = lookupByLibgpodKey("CLASSIC_2");
    if (!classic) {
      throw new Error("missing classic family");
    }
    expect(classic.signature).toBe("hash58");
    const bytes = sampleDb();
    const signed = signItunesdbForFamily(bytes, serial, classic);
    expect(hashingScheme(parseItunesdb(signed))).toBe(1);
    expect(signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(new Uint8Array(20));
  });

  test("hash72 and hashAB throw", () => {
    const bytes = sampleDb();
    expect(() => signItunesdb(bytes, serial, "hash72")).toThrow(ItunesdbSignatureError);
    expect(() => signItunesdb(bytes, serial, "hashAB")).toThrow(ItunesdbSignatureError);
  });

  test("FireWire ID must be 16 hex digits", () => {
    expect(firewireIdFromSerial("0x0011223344556677")).toEqual(
      firewireIdFromSerial("0011223344556677"),
    );
    expect(() => firewireIdFromSerial("zz")).toThrow(ItunesdbSignatureError);
  });
});
