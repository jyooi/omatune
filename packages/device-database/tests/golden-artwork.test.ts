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
import { artworkdbPath, goldenCases } from "./fixture-paths.ts";
import { join } from "node:path";

const cases = goldenCases();
const skip = cases.length === 0;
const family = "iPod classic 120 GB (2008)";

describe("S2 golden ArtworkDB", () => {
  test.skipIf(skip)(
    skip
      ? "parses Fixture ArtworkDB files (skipped: no Fixture is present)"
      : "parses Fixture ArtworkDB files, serialises, and matches every byte",
    async () => {
      for (const fixture of cases) {
        const bytes = await Bun.file(artworkdbPath(fixture.dir)).bytes();
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
          throw new Error(`missing image in ${fixture.name}`);
        }
        const thumbs = thumbnailsOf(image);
        expect(thumbs.length).toBeGreaterThan(0);
        for (const thumb of thumbs) {
          const format = artworkFormatRow(family, thumb.formatId);
          expect(format).toBeDefined();
          expect(thumb.size).toBe(format?.blockBytes);
          expect(thumb.fileName.includes(`F${thumb.formatId}_`)).toBe(true);
        }
      }
    },
  );

  test.skipIf(skip)(
    skip
      ? "gives every image a distinct per-format ithmb offset (skipped: no Fixture is present)"
      : "gives every image a distinct per-format ithmb offset",
    async () => {
      for (const fixture of cases) {
        const bytes = await Bun.file(artworkdbPath(fixture.dir)).bytes();
        const db = parseArtworkdb(bytes);
        const images = imageItems(db);
        expect(images.length).toBeGreaterThan(1);
        const offsetsByFormat = new Map<number, number[]>();
        for (const image of images) {
          for (const thumb of thumbnailsOf(image)) {
            const list = offsetsByFormat.get(thumb.formatId) ?? [];
            list.push(thumb.offset);
            offsetsByFormat.set(thumb.formatId, list);
          }
        }
        for (const [formatId, offsets] of offsetsByFormat) {
          expect(new Set(offsets).size).toBe(offsets.length);
          const format = artworkFormatRow(family, formatId);
          if (!format) {
            throw new Error(`missing format row for ${formatId}`);
          }
          const ithmbPath = join(fixture.dir, "Artwork", `F${formatId}_1.ithmb`);
          const ithmb = await Bun.file(ithmbPath).bytes();
          for (const offset of offsets) {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset + format.blockBytes).toBeLessThanOrEqual(ithmb.byteLength);
          }
        }
      }
    },
  );

  test.skipIf(skip)(
    skip
      ? "extracts an RGB565 thumbnail from a Fixture ithmb file (skipped: no Fixture is present)"
      : "extracts an RGB565 thumbnail from a Fixture ithmb file",
    async () => {
      for (const fixture of cases) {
        const bytes = await Bun.file(artworkdbPath(fixture.dir)).bytes();
        const db = parseArtworkdb(bytes);
        const image = imageItems(db)[0];
        if (!image) {
          throw new Error(`missing image in ${fixture.name}`);
        }
        const thumb = thumbnailsOf(image).find((item) => item.formatId === 1055);
        if (!thumb) {
          throw new Error(`missing 1055 thumb in ${fixture.name}`);
        }
        const format = artworkFormatRow(family, 1055);
        if (!format) {
          throw new Error("missing format row");
        }
        const ithmbPath = join(fixture.dir, "Artwork", `F${format.id}_1.ithmb`);
        const ithmb = await Bun.file(ithmbPath).bytes();
        const blocks = splitIthmbBlocks(ithmb, format.blockBytes);
        expect(blocks.length).toBeGreaterThan(0);
        const ppm = extractThumbnailPpm(ithmb, thumb.offset, format);
        const header = new TextDecoder().decode(ppm.subarray(0, 16));
        expect(header.startsWith("P6\n128 128\n255\n")).toBe(true);
        expect(ppm.byteLength).toBe("P6\n128 128\n255\n".length + 128 * 128 * 3);
      }
    },
  );
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
