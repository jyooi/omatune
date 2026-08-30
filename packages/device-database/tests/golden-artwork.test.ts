import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  artworkFormatRow,
  artworkFiles,
  extractThumbnailPpm,
  imageItems,
  parseArtworkdb,
  serializeArtworkdb,
  splitIthmbBlocks,
  thumbnailsOf,
} from "../src/index.ts";

const packageRoot = join(import.meta.dir, "..");
const fixtureDir = join(
  packageRoot,
  "..",
  "..",
  "fixtures",
  "device",
  "ipod-classic-120gb",
);
const artworkPath = join(fixtureDir, "Artwork", "ArtworkDB");
const fixturePresent = existsSync(artworkPath);
const family = "iPod classic 120 GB (2008)";
const goldenTitle = fixturePresent
  ? "parses the Fixture ArtworkDB, serialises, and matches every byte"
  : "parses the Fixture ArtworkDB, serialises, and matches every byte (skipped: private Fixture is absent)";
const thumbTitle = fixturePresent
  ? "extracts an RGB565 thumbnail from a Fixture ithmb file"
  : "extracts an RGB565 thumbnail from a Fixture ithmb file (skipped: private Fixture is absent)";

describe("S2 golden ArtworkDB", () => {
  test.skipIf(!fixturePresent)(goldenTitle, async () => {
    const bytes = await Bun.file(artworkPath).bytes();
    const db = parseArtworkdb(bytes);
    const out = serializeArtworkdb(db);
    expect(firstMismatch(bytes, out)).toBe(-1);
    expect(out.byteLength).toBe(bytes.byteLength);
    const images = imageItems(db);
    expect(images.length).toBeGreaterThan(0);
    const files = artworkFiles(db);
    expect(files.map((file) => file.formatId).sort()).toEqual([1055, 1060, 1061]);
    const image = images[0];
    if (!image) {
      throw new Error("missing image");
    }
    const thumbs = thumbnailsOf(image);
    expect(thumbs.length).toBeGreaterThan(0);
    for (const thumb of thumbs) {
      const format = artworkFormatRow(family, thumb.formatId);
      expect(format).toBeDefined();
      expect(thumb.size).toBe(format?.blockBytes);
      expect(thumb.fileName.includes(`F${thumb.formatId}_`)).toBe(true);
    }
  });

  test.skipIf(!fixturePresent)(thumbTitle, async () => {
    const bytes = await Bun.file(artworkPath).bytes();
    const db = parseArtworkdb(bytes);
    const image = imageItems(db)[0];
    if (!image) {
      throw new Error("missing image");
    }
    const thumb = thumbnailsOf(image).find((item) => item.formatId === 1055);
    if (!thumb) {
      throw new Error("missing 1055 thumb");
    }
    const format = artworkFormatRow(family, 1055);
    if (!format) {
      throw new Error("missing format row");
    }
    const ithmbPath = join(fixtureDir, "Artwork", `F${format.id}_1.ithmb`);
    const ithmb = await Bun.file(ithmbPath).bytes();
    const blocks = splitIthmbBlocks(ithmb, format.blockBytes);
    expect(blocks.length).toBeGreaterThan(0);
    const ppm = extractThumbnailPpm(ithmb, thumb.offset, format);
    const header = new TextDecoder().decode(ppm.subarray(0, 16));
    expect(header.startsWith("P6\n128 128\n255\n")).toBe(true);
    expect(ppm.byteLength).toBe("P6\n128 128\n255\n".length + 128 * 128 * 3);
  });
});

function firstMismatch(left: Uint8Array, right: Uint8Array): number {
  const limit = Math.min(left.byteLength, right.byteLength);
  for (let i = 0; i < limit; i += 1) {
    if (left[i] !== right[i]) {
      return i;
    }
  }
  if (left.byteLength !== right.byteLength) {
    return limit;
  }
  return -1;
}
