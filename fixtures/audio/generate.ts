import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { parseId3, readTrackTags, type Codec } from "./read-tags.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(ROOT, "manifest.json");

const BJORK = "Björk";
const VARIOUS = "Various Artists";
const DURATION_SECONDS = 2;
const SAMPLE_RATE = 44100;
const LAME_DELAY = 576;

type ArtworkKey = "tone" | "field" | "dual";

type TrackSpec = {
  path: string;
  codec: Codec;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  track: number;
  trackTotal: number;
  disc: number;
  discTotal: number;
  compilation: boolean;
  artwork: ArtworkKey | null;
  frequency: number;
  gaplessRole: "pregap" | "postgap" | null;
};

const TRACKS: TrackSpec[] = [
  {
    path: "library/tone-suite/01-pregap.mp3",
    codec: "mp3",
    title: "Pregap",
    artist: BJORK,
    album: "Tone Suite",
    albumArtist: BJORK,
    track: 1,
    trackTotal: 5,
    disc: 1,
    discTotal: 1,
    compilation: false,
    artwork: "tone",
    frequency: 440,
    gaplessRole: "pregap",
  },
  {
    path: "library/tone-suite/02-postgap.mp3",
    codec: "mp3",
    title: "Postgap",
    artist: BJORK,
    album: "Tone Suite",
    albumArtist: BJORK,
    track: 2,
    trackTotal: 5,
    disc: 1,
    discTotal: 1,
    compilation: false,
    artwork: "tone",
    frequency: 440,
    gaplessRole: "postgap",
  },
  {
    path: "library/tone-suite/03-steady.mp3",
    codec: "mp3",
    title: "Steady",
    artist: BJORK,
    album: "Tone Suite",
    albumArtist: BJORK,
    track: 3,
    trackTotal: 5,
    disc: 1,
    discTotal: 1,
    compilation: false,
    artwork: "tone",
    frequency: 494,
    gaplessRole: null,
  },
  {
    path: "library/tone-suite/04-fifth.mp3",
    codec: "mp3",
    title: "Fifth",
    artist: BJORK,
    album: "Tone Suite",
    albumArtist: BJORK,
    track: 4,
    trackTotal: 5,
    disc: 1,
    discTotal: 1,
    compilation: false,
    artwork: "tone",
    frequency: 554,
    gaplessRole: null,
  },
  {
    path: "library/tone-suite/05-uncovered.mp3",
    codec: "mp3",
    title: "Uncovered",
    artist: BJORK,
    album: "Tone Suite",
    albumArtist: BJORK,
    track: 5,
    trackTotal: 5,
    disc: 1,
    discTotal: 1,
    compilation: false,
    artwork: null,
    frequency: 587,
    gaplessRole: null,
  },
  {
    path: "library/field-recordings/01-alpha.m4a",
    codec: "aac",
    title: "Alpha",
    artist: "Ada Lovelace",
    album: "Field Recordings",
    albumArtist: VARIOUS,
    track: 1,
    trackTotal: 3,
    disc: 1,
    discTotal: 1,
    compilation: true,
    artwork: "field",
    frequency: 349,
    gaplessRole: null,
  },
  {
    path: "library/field-recordings/02-beta.m4a",
    codec: "aac",
    title: "Beta",
    artist: "Alan Turing",
    album: "Field Recordings",
    albumArtist: VARIOUS,
    track: 2,
    trackTotal: 3,
    disc: 1,
    discTotal: 1,
    compilation: true,
    artwork: "field",
    frequency: 392,
    gaplessRole: null,
  },
  {
    path: "library/field-recordings/03-gamma.m4a",
    codec: "aac",
    title: "Gamma",
    artist: "Grace Hopper",
    album: "Field Recordings",
    albumArtist: VARIOUS,
    track: 3,
    trackTotal: 3,
    disc: 1,
    discTotal: 1,
    compilation: true,
    artwork: "field",
    frequency: 415,
    gaplessRole: null,
  },
  {
    path: "library/dual-disc/d1-01-left.m4a",
    codec: "alac",
    title: "Left",
    artist: BJORK,
    album: "Dual Disc",
    albumArtist: BJORK,
    track: 1,
    trackTotal: 2,
    disc: 1,
    discTotal: 2,
    compilation: false,
    artwork: "dual",
    frequency: 220,
    gaplessRole: null,
  },
  {
    path: "library/dual-disc/d1-02-right.m4a",
    codec: "alac",
    title: "Right",
    artist: BJORK,
    album: "Dual Disc",
    albumArtist: BJORK,
    track: 2,
    trackTotal: 2,
    disc: 1,
    discTotal: 2,
    compilation: false,
    artwork: "dual",
    frequency: 247,
    gaplessRole: null,
  },
  {
    path: "library/dual-disc/d2-01-low.m4a",
    codec: "alac",
    title: "Low",
    artist: BJORK,
    album: "Dual Disc",
    albumArtist: BJORK,
    track: 1,
    trackTotal: 2,
    disc: 2,
    discTotal: 2,
    compilation: false,
    artwork: "dual",
    frequency: 131,
    gaplessRole: null,
  },
  {
    path: "library/dual-disc/d2-02-high.m4a",
    codec: "alac",
    title: "High",
    artist: BJORK,
    album: "Dual Disc",
    albumArtist: BJORK,
    track: 2,
    trackTotal: 2,
    disc: 2,
    discTotal: 2,
    compilation: false,
    artwork: "dual",
    frequency: 659,
    gaplessRole: null,
  },
];

const COVERS: Record<ArtworkKey, [number, number, number]> = {
  tone: [196, 30, 58],
  field: [46, 139, 87],
  dual: [30, 144, 255],
};

function main(): void {
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg) {
    process.stderr.write("This script needs ffmpeg.\n");
    process.stderr.write("Install ffmpeg.\n");
    process.stderr.write("Then start the script again.\n");
    process.exit(1);
  }

  const covers: Record<ArtworkKey, Uint8Array> = {
    tone: pngSolid(32, 32, COVERS.tone),
    field: pngSolid(32, 32, COVERS.field),
    dual: pngSolid(32, 32, COVERS.dual),
  };

  const manifestTracks = [];
  for (const spec of TRACKS) {
    const outPath = join(ROOT, spec.path);
    mkdirSync(dirname(outPath), { recursive: true });
    const artwork = spec.artwork ? covers[spec.artwork] : null;
    encodeTrack(ffmpeg, spec, outPath, artwork);
    let bytes = new Uint8Array(readFileSync(outPath));
    if (spec.codec === "mp3") {
      bytes = patchMp3(bytes, artwork);
      writeFileSync(outPath, bytes);
    }
    const tags = readTrackTags(new Uint8Array(readFileSync(outPath)));
    if (spec.gaplessRole && !tags.gapless) {
      process.stderr.write(`LAME gapless tags are missing on ${spec.path}\n`);
      process.exit(1);
    }
    manifestTracks.push({
      path: spec.path,
      codec: spec.codec,
      title: spec.title,
      artist: spec.artist,
      album: spec.album,
      albumArtist: spec.albumArtist,
      track: spec.track,
      trackTotal: spec.trackTotal,
      disc: spec.disc,
      discTotal: spec.discTotal,
      compilation: spec.compilation,
      artwork: spec.artwork !== null,
      durationSeconds: DURATION_SECONDS,
      gapless:
        spec.gaplessRole && tags.gapless
          ? {
              role: spec.gaplessRole,
              encoderDelay: tags.gapless.encoderDelay,
              encoderPadding: tags.gapless.encoderPadding,
            }
          : null,
    });
  }

  const albums = new Set(TRACKS.map((track) => `${track.albumArtist}\u0000${track.album}`));
  const albumArtists = new Set(TRACKS.map((track) => track.albumArtist));
  const manifest = {
    description:
      "Expected counts and tags for the Verification Library. Device Checklist items and tests read this file.",
    counts: {
      tracks: TRACKS.length,
      albums: albums.size,
      albumArtists: albumArtists.size,
      tracksWithArtwork: TRACKS.filter((track) => track.artwork !== null).length,
    },
    tracks: manifestTracks,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function encodeTrack(
  ffmpeg: string,
  spec: TrackSpec,
  outPath: string,
  artwork: Uint8Array | null,
): void {
  const args = [
    "-nostdin",
    "-hide_banner",
    "-y",
    "-fflags",
    "+bitexact",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${spec.frequency}:sample_rate=${SAMPLE_RATE}:duration=${DURATION_SECONDS}`,
  ];
  const coverPath = join(tmpdir(), `omatune-cover-${process.pid}.png`);
  if (artwork) {
    writeFileSync(coverPath, artwork);
    args.push("-i", coverPath);
  }
  args.push("-map", "0:a");
  if (artwork) {
    args.push("-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic");
  }
  args.push("-ac", "1", "-ar", String(SAMPLE_RATE), "-flags", "+bitexact");
  if (spec.codec === "mp3") {
    args.push("-c:a", "libmp3lame", "-b:a", "64k", "-id3v2_version", "4", "-write_id3v1", "0");
  } else if (spec.codec === "aac") {
    args.push("-c:a", "aac", "-b:a", "64k", "-f", "ipod");
  } else {
    args.push("-c:a", "alac", "-f", "ipod");
  }
  args.push(
    "-metadata",
    `title=${spec.title}`,
    "-metadata",
    `artist=${spec.artist}`,
    "-metadata",
    `album=${spec.album}`,
    "-metadata",
    `album_artist=${spec.albumArtist}`,
    "-metadata",
    `track=${spec.track}/${spec.trackTotal}`,
    "-metadata",
    `disc=${spec.disc}/${spec.discTotal}`,
  );
  if (spec.compilation) {
    args.push("-metadata", "compilation=1");
  }
  args.push(outPath);
  const result = Bun.spawnSync([ffmpeg, ...args], { stdout: "pipe", stderr: "pipe" });
  if (artwork) {
    try {
      unlinkSync(coverPath);
    } catch {
      // The cover file is temporary.
    }
  }
  if (result.exitCode !== 0) {
    process.stderr.write(new TextDecoder().decode(result.stderr));
    process.stderr.write(`ffmpeg failed for ${spec.path}\n`);
    process.exit(1);
  }
}

function patchMp3(bytes: Uint8Array, artwork: Uint8Array | null): Uint8Array {
  const copy = Uint8Array.from(bytes);
  const id3 = parseId3(copy);
  if (artwork && id3.artwork) {
    setApicPictureType(copy, 3);
  }
  writeLameGapless(copy, id3.audioStart);
  return copy;
}

function setApicPictureType(bytes: Uint8Array, pictureType: number): void {
  const version = bytes[3] ?? 0;
  const size = synchsafe(bytes.subarray(6, 10));
  let pos = 10;
  const end = 10 + size;
  while (pos + 10 <= end) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const frameSize =
      version >= 4
        ? synchsafe(bytes.subarray(pos + 4, pos + 8))
        : readU32(bytes, pos + 4);
    if (id === "APIC") {
      const data = bytes.subarray(pos + 10, pos + 10 + frameSize);
      let i = 1;
      while (i < data.length && data[i] !== 0) {
        i += 1;
      }
      const typeIndex = pos + 10 + i + 1;
      if (typeIndex < pos + 10 + frameSize) {
        bytes[typeIndex] = pictureType;
      }
      return;
    }
    pos += 10 + frameSize;
  }
}

function writeLameGapless(bytes: Uint8Array, audioStart: number): void {
  const audio = bytes.subarray(audioStart);
  const frameIndex = indexOfMpeg(audio);
  if (frameIndex < 0) {
    throw new Error("MP3 frame is missing");
  }
  const frame = audio.subarray(frameIndex);
  const header = frame[1] ?? 0;
  const mpegVersion = (header >> 3) & 3;
  const channelMode = (frame[3] >> 6) & 3;
  const sideInfo = mpegVersion === 3 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17;
  const payload = frame.subarray(4 + sideInfo);
  let xing = indexOfMarker(payload, "Info");
  if (xing < 0) {
    xing = indexOfMarker(payload, "Xing");
  }
  if (xing < 0) {
    throw new Error("Xing header is missing");
  }
  const xingAbs = audioStart + frameIndex + 4 + sideInfo + xing;
  const frames = readU32(bytes, xingAbs + 8);
  const pcm = DURATION_SECONDS * SAMPLE_RATE;
  const padding = Math.max(0, frames * 1152 - pcm - LAME_DELAY);
  const lameAbs = xingAbs + 0x78;
  const name = Buffer.from("LAME3.100");
  bytes.set(name, lameAbs);
  const packed = ((LAME_DELAY & 0xfff) << 12) | (padding & 0xfff);
  bytes[lameAbs + 0x15] = (packed >> 16) & 0xff;
  bytes[lameAbs + 0x16] = (packed >> 8) & 0xff;
  bytes[lameAbs + 0x17] = packed & 0xff;
}

function pngSolid(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const [r, g, b] = rgb;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x++) {
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw, { level: 9 });
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function synchsafe(bytes: Uint8Array): number {
  return ((bytes[0] ?? 0) << 21) | ((bytes[1] ?? 0) << 14) | ((bytes[2] ?? 0) << 7) | (bytes[3] ?? 0);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function indexOfMpeg(audio: Uint8Array): number {
  for (let i = 0; i + 1 < audio.length; i++) {
    if (audio[i] === 0xff && (audio[i + 1] & 0xe0) === 0xe0) {
      return i;
    }
  }
  return -1;
}

function indexOfMarker(bytes: Uint8Array, marker: string): number {
  outer: for (let i = 0; i + marker.length <= bytes.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

main();
