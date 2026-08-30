import { describe, expect, test } from "bun:test";
import {
  databaseVersion,
  hash58,
  hash72,
  mhodType,
  parseItunesdb,
  parseMhip,
  parseMhit,
  parseMhlp,
  parseMhod,
  parseMhyp,
  serializeItunesdb,
  serializeMhip,
  serializeMhit,
  serializeMhlp,
  serializeMhod,
  serializeMhyp,
  tracksOf,
} from "../src/index.ts";
import {
  mhbd,
  mhip,
  mhlp,
  mhlt,
  mhitWith,
  mhsd,
  mhyp,
  opaqueMhod,
  u32,
} from "./build.ts";

const sampleTrack = {
  title: "Alpha",
  artist: "Beta",
  albumArtist: "Gamma",
  album: "Delta",
  location: ":iPod_Control:Music:F00:alpha.mp3",
  disc: 2,
  trackNumber: 7,
  duration: 123456,
  size: 987654,
  dbid: 0x1122334455667788n,
  hasArtwork: true,
  playCount: 4,
  skipCount: 1,
  rating: 80,
  lastPlayed: 3000000000,
  lastSkipped: 3000000001,
  bookmark: 512,
  pregap: 2112,
  sampleCount: 99999n,
  postgap: 776,
  gaplessData: 42,
  gaplessTrackFlag: 1,
  gaplessAlbumFlag: 1,
};

describe("iTunesDB codec", () => {
  test("round-trips a synthetic database byte for byte", () => {
    const unknown = opaqueMhod(99, Uint8Array.of(1, 2, 3, 4, 5));
    const position = opaqueMhod(100, u32(1));
    const bytes = mhbd(
      [
        mhsd(
          1,
          mhlt([
            mhitWith({
              ...sampleTrack,
              extraMhods: [unknown],
            }),
          ]),
        ),
        mhsd(2, mhlp([mhyp("Library", [mhip(1, position)])])),
      ],
      {
        version: 0x30,
        hash58: new Uint8Array(20).map((_, i) => i + 1),
        hash72: new Uint8Array(46).map((_, i) => 50 + i),
      },
    );
    const db = parseItunesdb(bytes);
    const out = serializeItunesdb(db);
    expect(out).toEqual(bytes);
    expect(databaseVersion(db)).toBe(0x30);
    expect(hash58(db)).toEqual(new Uint8Array(20).map((_, i) => i + 1));
    expect(hash72(db)).toEqual(new Uint8Array(46).map((_, i) => 50 + i));
  });

  test("exposes Track fields the Device Database needs", () => {
    const bytes = mhbd([mhsd(1, mhlt([mhitWith(sampleTrack)]))]);
    const tracks = tracksOf(parseItunesdb(bytes));
    expect(tracks).toHaveLength(1);
    const track = tracks[0];
    if (!track) {
      throw new Error("missing Track");
    }
    expect(track.title).toBe("Alpha");
    expect(track.artist).toBe("Beta");
    expect(track.albumArtist).toBe("Gamma");
    expect(track.album).toBe("Delta");
    expect(track.disc).toBe(2);
    expect(track.trackNumber).toBe(7);
    expect(track.duration).toBe(123456);
    expect(track.size).toBe(987654);
    expect(track.devicePath).toBe(":iPod_Control:Music:F00:alpha.mp3");
    expect(track.dbid).toBe(0x1122334455667788n);
    expect(track.hasArtwork).toBe(true);
    expect(track.playData).toEqual({
      playCount: 4,
      skipCount: 1,
      rating: 80,
      lastPlayed: 3000000000,
      lastSkipped: 3000000001,
      bookmark: 512,
    });
    expect(track.gapless).toEqual({
      pregap: 2112,
      sampleCount: 99999n,
      postgap: 776,
      gaplessData: 42,
      gaplessTrackFlag: 1,
      gaplessAlbumFlag: 1,
    });
  });

  test("round-trips an unknown mhod type untouched", () => {
    const payload = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0);
    const bytes = opaqueMhod(102, payload);
    const parsed = parseMhod(bytes);
    expect(mhodType(parsed.chunk)).toBe(102);
    expect(parsed.chunk.body).toEqual(payload);
    expect(serializeMhod(parsed.chunk)).toEqual(bytes);
  });

  test("round-trips unknown bytes in an mhit header", () => {
    const track = mhitWith(sampleTrack);
    track[300] = 0xab;
    track[301] = 0xcd;
    const parsed = parseMhit(track);
    expect(serializeMhit(parsed.chunk)).toEqual(track);
  });

  test("named chunk parsers reject the wrong identifier", () => {
    const bytes = opaqueMhod(1, u32(0));
    expect(() => parseMhit(bytes)).toThrow();
  });

  test("round-trips mhlp, mhyp, and mhip", () => {
    const position = opaqueMhod(100, u32(3));
    const item = mhip(9, position);
    const playlist = mhyp("Queue", [item]);
    const list = mhlp([playlist]);
    expect(serializeMhlp(parseMhlp(list).chunk)).toEqual(list);
    expect(serializeMhyp(parseMhyp(playlist).chunk)).toEqual(playlist);
    expect(serializeMhip(parseMhip(item).chunk)).toEqual(item);
  });
});
