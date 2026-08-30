import { concat, fourCc, paddedHeader, u16, u32 } from "./build.ts";

function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return out;
}

export function artworkStringMhod(type: number, text: string): Uint8Array {
  const encoded = encodeUtf16le(text);
  const body = concat(u32(encoded.byteLength), u32(2), u32(0), encoded);
  const headerLength = 24;
  const total = headerLength + body.byteLength;
  const header = paddedHeader("mhod", headerLength, total, concat(u32(type), u32(0)));
  return concat(header, body);
}

export function containerMhod(child: Uint8Array): Uint8Array {
  const headerLength = 24;
  const total = headerLength + child.byteLength;
  const header = paddedHeader("mhod", headerLength, total, concat(u32(2), u32(0)));
  return concat(header, child);
}

export function mhni(fields: {
  formatId: number;
  offset: number;
  size: number;
  width: number;
  height: number;
  fileName: string;
}): Uint8Array {
  const name = artworkStringMhod(3, fields.fileName);
  const headerLength = 76;
  const total = headerLength + name.byteLength;
  const rest = new Uint8Array(headerLength - 12);
  rest.set(u32(1), 0);
  rest.set(u32(fields.formatId), 4);
  rest.set(u32(fields.offset), 8);
  rest.set(u32(fields.size), 12);
  rest.set(u16(fields.height), 20);
  rest.set(u16(fields.width), 22);
  rest.set(u32(fields.size), 28);
  const header = paddedHeader("mhni", headerLength, total, rest);
  return concat(header, name);
}

export function mhii(fields: {
  dbid: bigint;
  thumbs: Uint8Array[];
}): Uint8Array {
  const children = concat(...fields.thumbs);
  const headerLength = 152;
  const total = headerLength + children.byteLength;
  const rest = new Uint8Array(headerLength - 12);
  rest.set(u32(fields.thumbs.length), 0);
  rest.set(u32(0x64), 4);
  const dbid = new Uint8Array(8);
  new DataView(dbid.buffer).setBigUint64(0, fields.dbid, true);
  rest.set(dbid, 8);
  const header = paddedHeader("mhii", headerLength, total, rest);
  return concat(header, children);
}

export function mhif(formatId: number, imageSize: number): Uint8Array {
  const headerLength = 124;
  const rest = new Uint8Array(headerLength - 12);
  rest.set(u32(formatId), 4);
  rest.set(u32(imageSize), 8);
  return paddedHeader("mhif", headerLength, headerLength, rest);
}

export function mhli(images: Uint8Array[]): Uint8Array {
  const headerLength = 92;
  const children = concat(...images);
  const header = paddedHeader("mhli", headerLength, images.length, new Uint8Array(0));
  return concat(header, children);
}

export function mhlf(files: Uint8Array[]): Uint8Array {
  const headerLength = 92;
  const children = concat(...files);
  const header = paddedHeader("mhlf", headerLength, files.length, new Uint8Array(0));
  return concat(header, children);
}

export function mhlaEmpty(): Uint8Array {
  return paddedHeader("mhla", 92, 0, new Uint8Array(0));
}

export function artworkMhsd(type: number, child: Uint8Array): Uint8Array {
  const headerLength = 96;
  const total = headerLength + child.byteLength;
  const header = paddedHeader("mhsd", headerLength, total, u32(type));
  return concat(header, child);
}

export function mhfd(sections: Uint8Array[]): Uint8Array {
  const headerLength = 132;
  const children = concat(...sections);
  const total = headerLength + children.byteLength;
  const header = new Uint8Array(headerLength);
  header.set(fourCc("mhfd"), 0);
  header.set(u32(headerLength), 4);
  header.set(u32(total), 8);
  header.set(u32(2), 16);
  header.set(u32(sections.length), 20);
  header.set(u32(2), 48);
  return concat(header, children);
}
