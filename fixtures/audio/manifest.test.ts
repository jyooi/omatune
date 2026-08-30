import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackTags } from "./read-tags.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

type GaplessManifest = {
  role: "pregap" | "postgap";
  encoderDelay: number;
  encoderPadding: number;
  sampleCount: number;
};

type TrackManifest = {
  path: string;
  codec: "mp3" | "aac" | "alac";
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  track: number;
  trackTotal: number;
  disc: number;
  discTotal: number;
  compilation: boolean;
  artwork: boolean;
  durationSeconds: number;
  gapless: GaplessManifest | null;
};

type Manifest = {
  counts: {
    tracks: number;
    albums: number;
    albumArtists: number;
    tracksWithArtwork: number;
  };
  tracks: TrackManifest[];
};

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as Manifest;

describe("Verification Library manifest", () => {
  test("files exist and tags match the manifest", () => {
    expect(manifest.tracks.length).toBe(manifest.counts.tracks);
    const albums = new Set(manifest.tracks.map((track) => `${track.albumArtist}\0${track.album}`));
    const albumArtists = new Set(manifest.tracks.map((track) => track.albumArtist));
    const withArtwork = manifest.tracks.filter((track) => track.artwork);
    expect(albums.size).toBe(manifest.counts.albums);
    expect(albumArtists.size).toBe(manifest.counts.albumArtists);
    expect(withArtwork.length).toBe(manifest.counts.tracksWithArtwork);

    for (const expected of manifest.tracks) {
      const path = join(ROOT, expected.path);
      expect(existsSync(path)).toBe(true);
      const tags = readTrackTags(new Uint8Array(readFileSync(path)));
      expect(tags.codec).toBe(expected.codec);
      expect(tags.title).toBe(expected.title);
      expect(tags.artist).toBe(expected.artist);
      expect(tags.album).toBe(expected.album);
      expect(tags.albumArtist).toBe(expected.albumArtist);
      expect(tags.track).toBe(expected.track);
      expect(tags.trackTotal).toBe(expected.trackTotal);
      expect(tags.disc).toBe(expected.disc);
      expect(tags.discTotal).toBe(expected.discTotal);
      expect(tags.compilation).toBe(expected.compilation);
      expect(tags.hasArtwork).toBe(expected.artwork);
      if (expected.artwork) {
        expect(tags.artworkBytes).not.toBeNull();
        expect((tags.artworkBytes ?? []).length).toBeGreaterThan(0);
      } else {
        expect(tags.artworkBytes).toBeNull();
      }
      if (expected.gapless) {
        expect(tags.gapless).not.toBeNull();
        expect(tags.gapless?.encoderDelay).toBe(expected.gapless.encoderDelay);
        expect(tags.gapless?.encoderPadding).toBe(expected.gapless.encoderPadding);
        expect(tags.gapless?.sampleCount).toBe(BigInt(expected.gapless.sampleCount));
      }
    }
  });

  test("tags exercise album-artist NFC, compilation, and multi-disc rules", () => {
    const bjork = "Björk";
    expect(bjork).toBe(bjork.normalize("NFC"));
    expect(Buffer.from(bjork, "utf8")).toEqual(Buffer.from([0x42, 0x6a, 0xc3, 0xb6, 0x72, 0x6b]));

    const nfcArtists = manifest.tracks.filter((track) => track.albumArtist === bjork);
    expect(nfcArtists.length).toBeGreaterThan(0);
    for (const track of nfcArtists) {
      const tags = readTrackTags(new Uint8Array(readFileSync(join(ROOT, track.path))));
      expect(tags.albumArtist).toBe(bjork);
      expect(tags.albumArtist).toBe(tags.albumArtist?.normalize("NFC"));
    }

    const compilation = manifest.tracks.filter((track) => track.compilation);
    expect(compilation.length).toBeGreaterThan(0);
    expect(compilation.every((track) => track.albumArtist === "Various Artists")).toBe(true);

    const multiDisc = manifest.tracks.filter((track) => (track.discTotal ?? 0) > 1);
    const discs = new Set(multiDisc.map((track) => track.disc));
    expect(discs.has(1)).toBe(true);
    expect(discs.has(2)).toBe(true);
  });

  test("one Album exists per codec and Artwork is distinct per Album", () => {
    const byAlbum = new Map<string, TrackManifest[]>();
    for (const track of manifest.tracks) {
      const key = `${track.albumArtist}\0${track.album}`;
      const list = byAlbum.get(key) ?? [];
      list.push(track);
      byAlbum.set(key, list);
    }
    const codecs = new Set<string>();
    for (const tracks of byAlbum.values()) {
      const codec = new Set(tracks.map((track) => track.codec));
      expect(codec.size).toBe(1);
      codecs.add([...codec][0] ?? "");
    }
    expect(codecs.has("mp3")).toBe(true);
    expect(codecs.has("aac")).toBe(true);
    expect(codecs.has("alac")).toBe(true);

    const artByAlbum = new Map<string, string>();
    for (const track of manifest.tracks) {
      if (!track.artwork) {
        continue;
      }
      const tags = readTrackTags(new Uint8Array(readFileSync(join(ROOT, track.path))));
      const digest = Buffer.from(tags.artworkBytes ?? []).toString("hex");
      const key = `${track.albumArtist}\0${track.album}`;
      const prior = artByAlbum.get(key);
      if (prior) {
        expect(digest).toBe(prior);
      } else {
        artByAlbum.set(key, digest);
      }
    }
    expect(new Set(artByAlbum.values()).size).toBe(artByAlbum.size);
  });
});

describe("Verification Library generate script", () => {
  test("fails with a clear message when ffmpeg is missing", () => {
    const emptyPath = join(ROOT, ".empty-path");
    const result = Bun.spawnSync([process.execPath, join(ROOT, "generate.ts")], {
      cwd: ROOT,
      env: { ...process.env, PATH: emptyPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(stderr.includes("ffmpeg")).toBe(true);
  });
});
