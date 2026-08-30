import { describe, expect, test } from "bun:test";
import {
  extractThumbnailPpm,
  rgb565LeToRgb888,
  splitIthmbBlocks,
  writePpm,
} from "../src/index.ts";

function rgb565(r5: number, g6: number, b5: number): Uint8Array {
  const pixel = ((r5 & 0x1f) << 11) | ((g6 & 0x3f) << 5) | (b5 & 0x1f);
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, pixel, true);
  return out;
}

describe("ithmb RGB565", () => {
  test("splits files into format-sized blocks", () => {
    const block = new Uint8Array(8).fill(1);
    const file = new Uint8Array(16);
    file.set(block, 0);
    file.set(new Uint8Array(8).fill(2), 8);
    const blocks = splitIthmbBlocks(file, 8);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(block);
  });

  test("decodes RGB565 little endian and writes PPM", () => {
    const red = rgb565(0x1f, 0, 0);
    const green = rgb565(0, 0x3f, 0);
    const blue = rgb565(0, 0, 0x1f);
    const black = rgb565(0, 0, 0);
    const block = new Uint8Array(8);
    block.set(red, 0);
    block.set(green, 2);
    block.set(blue, 4);
    block.set(black, 6);
    const rgb = rgb565LeToRgb888(block, 2, 2);
    expect(Array.from(rgb.subarray(0, 3))).toEqual([0xf8, 0, 0]);
    expect(Array.from(rgb.subarray(3, 6))).toEqual([0, 0xfc, 0]);
    expect(Array.from(rgb.subarray(6, 9))).toEqual([0, 0, 0xf8]);
    const ppm = writePpm(2, 2, rgb);
    const text = new TextDecoder().decode(ppm.subarray(0, 11));
    expect(text.startsWith("P6\n2 2\n255\n")).toBe(true);
    expect(ppm.byteLength).toBe(11 + 12);
  });

  test("extracts a thumbnail to PPM from an ithmb block", () => {
    const format = { id: 1, width: 1, height: 1, blockBytes: 2 };
    const ithmb = rgb565(0x1f, 0, 0);
    const ppm = extractThumbnailPpm(ithmb, 0, format);
    expect(new TextDecoder().decode(ppm.subarray(0, 11))).toBe("P6\n1 1\n255\n");
    expect(Array.from(ppm.subarray(11))).toEqual([0xf8, 0, 0]);
  });
});
