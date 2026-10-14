/*
 * RGB565 little-endian thumbnail blocks in .ithmb files.
 *
 * Sources:
 * - ipodlinux wiki Artwork Database on ITunesDB:
 *   http://www.ipodlinux.org/ITunesDB/
 * - Family format rows in src/model/format-table.ts
 *
 * Each block holds packed RGB565 pixels.
 * The decoder ignores extra bytes after width times height.
 * The encoder writes RGB565 pixels and pads the block to blockBytes.
 */

import { concatBytes } from "./bytes.ts";
import { ItunesdbParseError } from "./error.ts";
import type { ArtworkFormatRow } from "./model/format-table.ts";

export function splitIthmbBlocks(
  bytes: Uint8Array,
  blockBytes: number,
): Uint8Array[] {
  if (blockBytes <= 0) {
    throw new ItunesdbParseError(`ithmb block size ${blockBytes} is invalid`, 0);
  }
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset + blockBytes <= bytes.byteLength; offset += blockBytes) {
    blocks.push(bytes.subarray(offset, offset + blockBytes));
  }
  return blocks;
}

export function rgb888ToRgb565Le(
  rgb: Uint8Array,
  width: number,
  height: number,
  blockBytes: number,
): Uint8Array {
  if (blockBytes < 0) {
    throw new ItunesdbParseError(`ithmb block size ${blockBytes} is invalid`, 0);
  }
  const count = width * height;
  const out = new Uint8Array(blockBytes);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i += 1) {
    const byteOffset = i * 2;
    if (byteOffset + 2 > blockBytes) {
      break;
    }
    const r = rgb[i * 3] ?? 0;
    const g = rgb[i * 3 + 1] ?? 0;
    const b = rgb[i * 3 + 2] ?? 0;
    const pixel = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    view.setUint16(byteOffset, pixel, true);
  }
  return out;
}

export function rgb565LeToRgb888(
  block: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const count = width * height;
  const rgb = new Uint8Array(count * 3);
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  for (let i = 0; i < count; i += 1) {
    const byteOffset = i * 2;
    const pixel =
      byteOffset + 2 <= block.byteLength ? view.getUint16(byteOffset, true) : 0;
    const r = (pixel >> 11) & 0x1f;
    const g = (pixel >> 5) & 0x3f;
    const b = pixel & 0x1f;
    rgb[i * 3] = r << 3;
    rgb[i * 3 + 1] = g << 2;
    rgb[i * 3 + 2] = b << 3;
  }
  return rgb;
}

export function writePpm(
  width: number,
  height: number,
  rgb: Uint8Array,
): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  return concatBytes([header, rgb]);
}

export function extractThumbnailPpm(
  ithmb: Uint8Array,
  offset: number,
  format: ArtworkFormatRow,
): Uint8Array {
  const end = offset + format.blockBytes;
  if (offset < 0 || end > ithmb.byteLength) {
    throw new ItunesdbParseError(
      `ithmb slice ${offset}..${end} overruns buffer`,
      offset,
    );
  }
  const block = ithmb.subarray(offset, end);
  const rgb = rgb565LeToRgb888(block, format.width, format.height);
  return writePpm(format.width, format.height, rgb);
}
