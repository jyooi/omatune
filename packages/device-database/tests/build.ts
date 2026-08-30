export function u8(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff);
}

export function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

export function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function fourCc(id: string): Uint8Array {
  return Uint8Array.from(id, (ch) => ch.charCodeAt(0));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function paddedHeader(
  id: string,
  headerLength: number,
  field8: number,
  rest: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(headerLength);
  header.set(fourCc(id), 0);
  header.set(u32(headerLength), 4);
  header.set(u32(field8), 8);
  header.set(rest.subarray(0, headerLength - 12), 12);
  return header;
}

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return out;
}

export function stringMhod(type: number, text: string): Uint8Array {
  const encoded = encodeUtf16le(text);
  const body = concat(u32(1), u32(encoded.byteLength), u32(1), u32(0), encoded);
  const headerLength = 24;
  const total = headerLength + body.byteLength;
  const header = paddedHeader("mhod", headerLength, total, concat(u32(type), u32(0), u32(0)));
  return concat(header, body);
}

export function opaqueMhod(type: number, payload: Uint8Array): Uint8Array {
  const headerLength = 24;
  const total = headerLength + payload.byteLength;
  const header = paddedHeader("mhod", headerLength, total, concat(u32(type), u32(0), u32(0)));
  return concat(header, payload);
}

export function mhitWith(fields: {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  location: string;
  disc: number;
  trackNumber: number;
  duration: number;
  size: number;
  dbid: bigint;
  hasArtwork: boolean;
  playCount: number;
  skipCount: number;
  rating: number;
  lastPlayed: number;
  lastSkipped: number;
  bookmark: number;
  pregap: number;
  sampleCount: bigint;
  postgap: number;
  gaplessData: number;
  gaplessTrackFlag: number;
  gaplessAlbumFlag: number;
  extraMhods?: Uint8Array[];
}): Uint8Array {
  const headerLength = 624;
  const header = new Uint8Array(headerLength);
  const mhods = [
    stringMhod(1, fields.title),
    stringMhod(4, fields.artist),
    stringMhod(22, fields.albumArtist),
    stringMhod(3, fields.album),
    stringMhod(2, fields.location),
    ...(fields.extraMhods ?? []),
  ];
  const children = concat(...mhods);
  const total = headerLength + children.byteLength;
  header.set(fourCc("mhit"), 0);
  header.set(u32(headerLength), 4);
  header.set(u32(total), 8);
  header.set(u32(mhods.length), 12);
  header.set(u32(1), 16);
  header.set(u32(1), 20);
  header[31] = fields.rating;
  header.set(u32(fields.size), 36);
  header.set(u32(fields.duration), 40);
  header.set(u32(fields.trackNumber), 44);
  header.set(u32(fields.playCount), 80);
  header.set(u32(fields.lastPlayed), 88);
  header.set(u32(fields.disc), 92);
  header.set(u32(fields.bookmark), 108);
  header.set(u64(fields.dbid), 112);
  header.set(u32(fields.skipCount), 156);
  header.set(u32(fields.lastSkipped), 160);
  header[164] = fields.hasArtwork ? 1 : 2;
  header.set(u32(fields.pregap), 184);
  header.set(u64(fields.sampleCount), 188);
  header.set(u32(fields.postgap), 200);
  header.set(u32(fields.gaplessData), 248);
  header.set(u16(fields.gaplessTrackFlag), 256);
  header.set(u16(fields.gaplessAlbumFlag), 258);
  return concat(header, children);
}

export function mhip(trackId: number, positionMhod: Uint8Array): Uint8Array {
  const headerLength = 76;
  const total = headerLength + positionMhod.byteLength;
  const rest = new Uint8Array(headerLength - 12);
  rest.set(u32(1), 0);
  rest.set(u32(trackId), 12);
  const header = paddedHeader("mhip", headerLength, total, rest);
  return concat(header, positionMhod);
}

export function mhyp(name: string, items: Uint8Array[]): Uint8Array {
  const headerLength = 184;
  const nameMhod = stringMhod(1, name);
  const children = concat(nameMhod, ...items);
  const total = headerLength + children.byteLength;
  const rest = new Uint8Array(headerLength - 12);
  rest.set(u32(1), 0);
  rest.set(u32(items.length), 4);
  const header = paddedHeader("mhyp", headerLength, total, rest);
  return concat(header, children);
}

export function mhlp(playlists: Uint8Array[]): Uint8Array {
  const headerLength = 92;
  const children = concat(...playlists);
  const header = paddedHeader("mhlp", headerLength, playlists.length, new Uint8Array(0));
  return concat(header, children);
}

export function mhlt(tracks: Uint8Array[]): Uint8Array {
  const headerLength = 92;
  const children = concat(...tracks);
  const header = paddedHeader("mhlt", headerLength, tracks.length, new Uint8Array(0));
  return concat(header, children);
}

export function mhsd(type: number, child: Uint8Array): Uint8Array {
  const headerLength = 96;
  const total = headerLength + child.byteLength;
  const header = paddedHeader("mhsd", headerLength, total, u32(type));
  return concat(header, child);
}

export function mhbd(sections: Uint8Array[], options?: {
  version?: number;
  hash58?: Uint8Array;
  hash72?: Uint8Array;
}): Uint8Array {
  const headerLength = 0xf4;
  const children = concat(...sections);
  const total = headerLength + children.byteLength;
  const header = new Uint8Array(headerLength);
  header.set(fourCc("mhbd"), 0);
  header.set(u32(headerLength), 4);
  header.set(u32(total), 8);
  header.set(u32(1), 12);
  header.set(u32(options?.version ?? 0x30), 16);
  header.set(u32(sections.length), 20);
  header.set(u16(1), 48);
  const hash58 = options?.hash58 ?? new Uint8Array(20).fill(0xaa);
  const hash72 = options?.hash72 ?? new Uint8Array(46).fill(0xbb);
  header.set(hash58, 0x58);
  header.set(hash72, 0x72);
  return concat(header, children);
}
