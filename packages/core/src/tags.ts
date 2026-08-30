export type Codec = "mp3" | "aac" | "alac";

export type Gapless = {
  encoderDelay: number;
  encoderPadding: number;
  sampleCount: bigint;
};

export type TrackTags = {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  track: number | null;
  trackTotal: number | null;
  disc: number | null;
  discTotal: number | null;
  compilation: boolean;
  hasArtwork: boolean;
  artworkMime: string | null;
  artworkBytes: Uint8Array | null;
  codec: Codec;
  gapless: Gapless | null;
  durationSeconds: number | null;
};

export function readTrackTags(bytes: Uint8Array): TrackTags {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return readMp3(bytes);
  }
  return readMp4(bytes);
}

function readMp3(bytes: Uint8Array): TrackTags {
  const id3 = parseId3(bytes);
  const audioStart = id3.audioStart;
  return {
    title: id3.text.TIT2 ?? null,
    artist: id3.text.TPE1 ?? null,
    album: id3.text.TALB ?? null,
    albumArtist: id3.text.TPE2 ?? null,
    ...parseSlashNumber(id3.text.TRCK),
    disc: parseSlashNumber(id3.text.TPOS).track,
    discTotal: parseSlashNumber(id3.text.TPOS).trackTotal,
    compilation: id3.text.TCMP === "1",
    hasArtwork: id3.artwork !== null,
    artworkMime: id3.artwork?.mime ?? null,
    artworkBytes: id3.artwork?.bytes ?? null,
    codec: "mp3",
    gapless: readMp3Gapless(id3.itunSmpb, bytes.subarray(audioStart)),
    durationSeconds: mpegDurationSeconds(bytes, audioStart),
  };
}

function parseSlashNumber(value: string | undefined): {
  track: number | null;
  trackTotal: number | null;
} {
  if (!value) {
    return { track: null, trackTotal: null };
  }
  const [left, right] = value.split("/");
  const track = Number.parseInt(left ?? "", 10);
  const trackTotal = right ? Number.parseInt(right, 10) : null;
  return {
    track: Number.isFinite(track) ? track : null,
    trackTotal: trackTotal !== null && Number.isFinite(trackTotal) ? trackTotal : null,
  };
}

type Id3Artwork = { mime: string; pictureType: number; bytes: Uint8Array };

type Id3Parse = {
  audioStart: number;
  text: Record<string, string>;
  artwork: Id3Artwork | null;
  itunSmpb: string | null;
};

export function parseId3(bytes: Uint8Array): Id3Parse {
  const version = bytes[3] ?? 0;
  const flags = bytes[4] ?? 0;
  const size = synchsafe(bytes.subarray(6, 10));
  let pos = 10;
  if (flags & 0x40) {
    const extSize = version >= 4 ? synchsafe(bytes.subarray(pos, pos + 4)) : readU32(bytes, pos);
    pos += extSize;
  }
  const end = 10 + size;
  const text: Record<string, string> = {};
  let artwork: Id3Artwork | null = null;
  let itunSmpb: string | null = null;
  while (pos + 10 <= end) {
    const id = ascii(bytes.subarray(pos, pos + 4));
    if (id === "\u0000\u0000\u0000\u0000" || id.trim() === "") {
      break;
    }
    const frameSize =
      version >= 4 ? synchsafe(bytes.subarray(pos + 4, pos + 8)) : readU32(bytes, pos + 4);
    const data = bytes.subarray(pos + 10, pos + 10 + frameSize);
    if (id === "APIC") {
      artwork = parseApic(data);
    } else if (id === "TXXX" || id === "COMM") {
      const smpb = readItunSmpbFrame(id, data);
      if (smpb && itunSmpb === null) {
        itunSmpb = smpb;
      }
    } else if (id.startsWith("T")) {
      text[id] = decodeId3Text(data);
    }
    pos += 10 + frameSize;
  }
  return { audioStart: end, text, artwork, itunSmpb };
}

function parseApic(data: Uint8Array): Id3Artwork {
  const encoding = data[0] ?? 0;
  let pos = 1;
  const mimeEnd = indexOfByte(data, 0, pos);
  const mime = ascii(data.subarray(pos, mimeEnd));
  pos = mimeEnd + 1;
  const pictureType = data[pos] ?? 0;
  pos += 1;
  const descTerm = encoding === 1 || encoding === 2 ? 2 : 1;
  while (pos + descTerm <= data.length) {
    if (encoding === 1 || encoding === 2) {
      if (data[pos] === 0 && data[pos + 1] === 0) {
        pos += 2;
        break;
      }
      pos += 2;
    } else {
      if (data[pos] === 0) {
        pos += 1;
        break;
      }
      pos += 1;
    }
  }
  return { mime, pictureType, bytes: data.subarray(pos) };
}

function decodeId3Text(data: Uint8Array): string {
  if (data.length === 0) {
    return "";
  }
  const encoding = data[0] ?? 0;
  return decodeId3Payload(encoding, data.subarray(1)).split("\0")[0] ?? "";
}

function readItunSmpbFrame(id: string, data: Uint8Array): string | null {
  if (data.length < 2) {
    return null;
  }
  const encoding = data[0] ?? 0;
  let pos = 1;
  if (id === "COMM") {
    if (data.length < 5) {
      return null;
    }
    pos = 4;
  }
  const desc = readId3Encoded(data, encoding, pos);
  if (desc.text !== "iTunSMPB") {
    return null;
  }
  const text = decodeId3Payload(encoding, data.subarray(desc.next)).trim();
  return text.length > 0 ? text : null;
}

function readId3Encoded(
  data: Uint8Array,
  encoding: number,
  start: number,
): { text: string; next: number } {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    let i = start;
    while (i + 1 < data.length) {
      if (data[i] === 0 && data[i + 1] === 0) {
        return {
          text: decodeUtf16(data.subarray(start, i), encoding === 1).replace(/\0+$/g, ""),
          next: i + 2,
        };
      }
      i += 2;
    }
    return {
      text: decodeUtf16(data.subarray(start), encoding === 1).replace(/\0+$/g, ""),
      next: data.length,
    };
  }
  const end = indexOfByte(data, 0, start);
  return {
    text: decodeId3Payload(encoding, data.subarray(start, end)),
    next: Math.min(end + 1, data.length),
  };
}

function decodeId3Payload(encoding: number, payload: Uint8Array): string {
  let text: string;
  if (encoding === 1) {
    text = decodeUtf16(payload, true);
  } else if (encoding === 2) {
    text = decodeUtf16(payload, false);
  } else if (encoding === 0) {
    text = new TextDecoder("latin1").decode(payload);
  } else {
    text = new TextDecoder("utf-8").decode(payload);
  }
  return text.replace(/\0+$/g, "");
}

function decodeUtf16(payload: Uint8Array, bom: boolean): string {
  let little = true;
  let start = 0;
  if (bom && payload.length >= 2) {
    if (payload[0] === 0xff && payload[1] === 0xfe) {
      little = true;
      start = 2;
    } else if (payload[0] === 0xfe && payload[1] === 0xff) {
      little = false;
      start = 2;
    }
  } else if (!bom) {
    little = false;
  }
  const aligned = payload.subarray(start, start + ((payload.length - start) & ~1));
  return new TextDecoder(little ? "utf-16le" : "utf-16be").decode(aligned);
}

function readMp3Gapless(itunSmpb: string | null, audio: Uint8Array): Gapless | null {
  return completeGapless(parseItunSmpb(itunSmpb)) ?? completeGapless(readLameGapless(audio));
}

function completeGapless(value: Gapless | null): Gapless | null {
  if (!value || value.sampleCount <= 0n) {
    return null;
  }
  return value;
}

export function readLameGapless(audio: Uint8Array): Gapless | null {
  const frame = firstMpegFrame(audio);
  if (!frame) {
    return null;
  }
  const info = findXing(frame);
  if (!info) {
    return null;
  }
  const lame = info.subarray(0x78);
  if (lame.length < 0x18) {
    return null;
  }
  const magic = ascii(lame.subarray(0, 4));
  if (magic !== "LAME" && magic !== "Lavc") {
    return null;
  }
  const packed = (lame[0x15] << 16) | (lame[0x16] << 8) | lame[0x17];
  const encoderDelay = (packed >> 12) & 0xfff;
  const encoderPadding = packed & 0xfff;
  const sampleCount = lameSampleCount(frame, info, encoderDelay, encoderPadding);
  if (sampleCount === null) {
    return null;
  }
  return {
    encoderDelay,
    encoderPadding,
    sampleCount,
  };
}

function lameSampleCount(
  frame: Uint8Array,
  xing: Uint8Array,
  encoderDelay: number,
  encoderPadding: number,
): bigint | null {
  if (xing.length < 12) {
    return null;
  }
  const flags = readU32(xing, 4);
  if ((flags & 0x1) === 0) {
    return null;
  }
  const frames = readU32(xing, 8);
  const samplesPerFrame = mpegSamplesPerFrame(frame);
  if (!samplesPerFrame || frames === 0) {
    return null;
  }
  const total = frames * samplesPerFrame - encoderDelay - encoderPadding;
  if (total <= 0) {
    return null;
  }
  return BigInt(total);
}

function mpegSamplesPerFrame(frame: Uint8Array): number | null {
  if (frame.length < 2) {
    return null;
  }
  const versionId = ((frame[1] ?? 0) >> 3) & 3;
  const layerId = ((frame[1] ?? 0) >> 1) & 3;
  if (layerId === 1) {
    return versionId === 3 ? 1152 : 576;
  }
  if (layerId === 2) {
    return 1152;
  }
  if (layerId === 3) {
    return 384;
  }
  return null;
}

function firstMpegFrame(audio: Uint8Array): Uint8Array | null {
  for (let i = 0; i + 4 < audio.length; i++) {
    if (audio[i] === 0xff && (audio[i + 1] & 0xe0) === 0xe0) {
      return audio.subarray(i);
    }
  }
  return null;
}

function findXing(frame: Uint8Array): Uint8Array | null {
  const header = frame[1] ?? 0;
  const mpegVersion = (header >> 3) & 3;
  const channelMode = (frame[3] >> 6) & 3;
  let sideInfo = 32;
  if (mpegVersion === 3) {
    sideInfo = channelMode === 3 ? 17 : 32;
  } else {
    sideInfo = channelMode === 3 ? 9 : 17;
  }
  const payload = frame.subarray(4 + sideInfo);
  for (const marker of ["Info", "Xing"] as const) {
    const offset = indexOfAscii(payload, marker);
    if (offset >= 0) {
      return payload.subarray(offset);
    }
  }
  return null;
}

function readMp4(bytes: Uint8Array): TrackTags {
  const ilst: Record<string, Mp4Value> = {};
  let codec: Codec = "aac";
  walkAtoms(bytes, 0, bytes.length, (type, data) => {
    if (type === "alac") {
      codec = "alac";
    }
    if (type === "mp4a" && codec !== "alac") {
      codec = "aac";
    }
  });
  const ilstAtom = findAtomPath(bytes, ["moov", "udta", "meta", "ilst"]);
  if (ilstAtom) {
    parseIlst(ilstAtom, ilst);
  }
  const name = textValue(ilst["©nam"]);
  const artist = textValue(ilst["©ART"]);
  const album = textValue(ilst["©alb"]);
  const albumArtist = textValue(ilst["aART"]);
  const trkn = pairValue(ilst["trkn"]);
  const disk = pairValue(ilst["disk"]);
  const artwork = coverValue(ilst["covr"]);
  const compilation = boolValue(ilst["cpil"]);
  const smpb = textValue(ilst["iTunSMPB"]);
  return {
    title: name,
    artist,
    album,
    albumArtist,
    track: trkn[0],
    trackTotal: trkn[1],
    disc: disk[0],
    discTotal: disk[1],
    compilation,
    hasArtwork: artwork !== null,
    artworkMime: artwork?.mime ?? null,
    artworkBytes: artwork?.bytes ?? null,
    codec,
    gapless: completeGapless(parseItunSmpb(smpb)),
    durationSeconds: mp4DurationSeconds(bytes),
  };
}

type Mp4Value = { type: number; bytes: Uint8Array };

function parseIlst(ilst: Uint8Array, out: Record<string, Mp4Value>): void {
  let pos = 0;
  while (pos + 8 <= ilst.length) {
    const size = readU32(ilst, pos);
    const type = atomName(ilst.subarray(pos + 4, pos + 8));
    if (size < 8 || pos + size > ilst.length) {
      break;
    }
    const body = ilst.subarray(pos + 8, pos + size);
    if (type === "----") {
      const mean = childAtom(body, "mean");
      const name = childAtom(body, "name");
      const data = childAtom(body, "data");
      if (name && data) {
        const key = ascii(name.subarray(4)).replace(/\0/g, "");
        out[key] = parseDataAtom(data);
      }
      void mean;
    } else {
      const data = childAtom(body, "data");
      if (data) {
        out[type] = parseDataAtom(data);
      }
    }
    pos += size;
  }
}

function parseDataAtom(dataAtomBody: Uint8Array): Mp4Value {
  const type = readU32(dataAtomBody, 0);
  return { type, bytes: dataAtomBody.subarray(8) };
}

function childAtom(body: Uint8Array, want: string): Uint8Array | null {
  let pos = 0;
  while (pos + 8 <= body.length) {
    const size = readU32(body, pos);
    const type = atomName(body.subarray(pos + 4, pos + 8));
    if (size < 8 || pos + size > body.length) {
      break;
    }
    if (type === want) {
      return body.subarray(pos + 8, pos + size);
    }
    pos += size;
  }
  return null;
}

function textValue(value: Mp4Value | undefined): string | null {
  if (!value) {
    return null;
  }
  return new TextDecoder("utf-8").decode(value.bytes).replace(/\0+$/g, "") || null;
}

function pairValue(value: Mp4Value | undefined): [number | null, number | null] {
  if (!value || value.bytes.length < 6) {
    return [null, null];
  }
  const index = (value.bytes[2] << 8) | value.bytes[3];
  const total = (value.bytes[4] << 8) | value.bytes[5];
  return [index || null, total || null];
}

function boolValue(value: Mp4Value | undefined): boolean {
  if (!value || value.bytes.length === 0) {
    return false;
  }
  return value.bytes[value.bytes.length - 1] === 1;
}

function coverValue(
  value: Mp4Value | undefined,
): { mime: string; bytes: Uint8Array } | null {
  if (!value) {
    return null;
  }
  const mime = value.type === 14 ? "image/png" : "image/jpeg";
  return { mime, bytes: value.bytes };
}

function parseItunSmpb(value: string | null): Gapless | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length < 4) {
    return null;
  }
  const encoderDelay = Number.parseInt(parts[1] ?? "", 16);
  const encoderPadding = Number.parseInt(parts[2] ?? "", 16);
  if (!Number.isFinite(encoderDelay) || !Number.isFinite(encoderPadding)) {
    return null;
  }
  let sampleCount: bigint;
  try {
    sampleCount = BigInt(`0x${parts[3]}`);
  } catch {
    return null;
  }
  if (sampleCount <= 0n) {
    return null;
  }
  return { encoderDelay, encoderPadding, sampleCount };
}

function findAtomPath(bytes: Uint8Array, path: string[]): Uint8Array | null {
  let current = bytes;
  let start = 0;
  let end = bytes.length;
  let payload: Uint8Array | null = null;
  for (const step of path) {
    payload = null;
    let pos = start;
    while (pos + 8 <= end) {
      let size = readU32(current, pos);
      const type = atomName(current.subarray(pos + 4, pos + 8));
      let header = 8;
      if (size === 1) {
        size = Number(readU64(current, pos + 8));
        header = 16;
      }
      if (size < header || pos + size > end) {
        break;
      }
      if (type === step) {
        let payloadStart = pos + header;
        if (type === "meta") {
          payloadStart += 4;
        }
        payload = current.subarray(payloadStart, pos + size);
        start = payloadStart;
        end = pos + size;
        current = bytes;
        break;
      }
      pos += size;
    }
    if (!payload) {
      return null;
    }
  }
  return payload;
}

function walkAtoms(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, data: Uint8Array) => void,
): void {
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32(bytes, pos);
    const type = atomName(bytes.subarray(pos + 4, pos + 8));
    let header = 8;
    if (size === 1) {
      size = Number(readU64(bytes, pos + 8));
      header = 16;
    }
    if (size < header || pos + size > end) {
      break;
    }
    const data = bytes.subarray(pos + header, pos + size);
    visit(type, data);
    if (
      type === "moov" ||
      type === "trak" ||
      type === "mdia" ||
      type === "minf" ||
      type === "stbl" ||
      type === "udta" ||
      type === "ilst"
    ) {
      walkAtoms(bytes, pos + header, pos + size, visit);
    } else if (type === "stsd") {
      walkAtoms(bytes, pos + header + 8, pos + size, visit);
    } else if (type === "meta") {
      walkAtoms(bytes, pos + header + 4, pos + size, visit);
    }
    pos += size;
  }
}

function mpegDurationSeconds(bytes: Uint8Array, audioStart: number): number | null {
  const audio = bytes.subarray(audioStart);
  const frame = firstMpegFrame(audio);
  if (!frame || frame.length < 4) {
    return null;
  }
  const versionId = ((frame[1] ?? 0) >> 3) & 3;
  const layerId = ((frame[1] ?? 0) >> 1) & 3;
  const srIndex = ((frame[2] ?? 0) >> 2) & 3;
  const sampleRates: Record<number, number[]> = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  };
  const sampleRate = sampleRates[versionId]?.[srIndex];
  if (!sampleRate) {
    return null;
  }
  let samplesPerFrame = 1152;
  if (layerId === 1) {
    samplesPerFrame = versionId === 3 ? 1152 : 576;
  } else if (layerId === 3) {
    samplesPerFrame = 384;
  }
  const xing = findXing(frame);
  if (xing && xing.length >= 12) {
    const flags = readU32(xing, 4);
    if ((flags & 0x1) !== 0) {
      const frames = readU32(xing, 8);
      if (frames > 0) {
        return (frames * samplesPerFrame) / sampleRate;
      }
    }
  }
  return null;
}

function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const mdhd = findAtomPath(bytes, ["moov", "trak", "mdia", "mdhd"]);
  if (!mdhd || mdhd.length < 20) {
    return null;
  }
  const version = mdhd[0] ?? 0;
  if (version === 1 && mdhd.length >= 32) {
    const timescale = readU32(mdhd, 20);
    const duration = Number(readU64(mdhd, 24));
    if (timescale === 0) {
      return null;
    }
    return duration / timescale;
  }
  const timescale = readU32(mdhd, 12);
  const duration = readU32(mdhd, 16);
  if (timescale === 0) {
    return null;
  }
  return duration / timescale;
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

function readU64(bytes: Uint8Array, offset: number): bigint {
  const hi = readU32(bytes, offset);
  const lo = readU32(bytes, offset + 4);
  return (BigInt(hi) << 32n) | BigInt(lo);
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function atomName(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function indexOfByte(bytes: Uint8Array, value: number, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === value) {
      return i;
    }
  }
  return bytes.length;
}

function indexOfAscii(bytes: Uint8Array, value: string): number {
  outer: for (let i = 0; i + value.length <= bytes.length; i++) {
    for (let j = 0; j < value.length; j++) {
      if (bytes[i + j] !== value.charCodeAt(j)) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}
