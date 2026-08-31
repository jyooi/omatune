import { describe, expect, test } from "bun:test";
import {
  artworkFiles,
  buildArtworkdb,
  imageItems,
  mhiiDbid,
  parseArtworkdb,
  serializeArtworkdb,
  thumbnailsOf,
} from "../src/index.ts";

describe("ArtworkDB writer", () => {
  test("round-trips a written ArtworkDB", () => {
    const db = buildArtworkdb(
      [
        {
          dbid: 0x1122334455667788n,
          imageId: 0x64,
          thumbs: [
            {
              formatId: 1055,
              offset: 0,
              size: 32768,
              width: 128,
              height: 128,
              fileName: ":F1055_1.ithmb",
            },
          ],
        },
      ],
      [{ formatId: 1055, imageSize: 32768 }],
    );
    const bytes = serializeArtworkdb(db);
    const parsed = parseArtworkdb(bytes);
    expect(serializeArtworkdb(parsed)).toEqual(bytes);
    const items = imageItems(parsed);
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) {
      throw new Error("missing image");
    }
    expect(mhiiDbid(item)).toBe(0x1122334455667788n);
    expect(thumbnailsOf(item)).toEqual([
      {
        formatId: 1055,
        offset: 0,
        size: 32768,
        width: 128,
        height: 128,
        fileName: ":F1055_1.ithmb",
      },
    ]);
    expect(artworkFiles(parsed)).toEqual([{ formatId: 1055, imageSize: 32768 }]);
  });

  test("keeps each image's ithmb offset distinct across a multi-album write", () => {
    const db = buildArtworkdb(
      [
        {
          dbid: 0x1111111111111111n,
          imageId: 0x64,
          thumbs: [
            {
              formatId: 1055,
              offset: 0,
              size: 32768,
              width: 128,
              height: 128,
              fileName: ":F1055_1.ithmb",
            },
          ],
        },
        {
          dbid: 0x2222222222222222n,
          imageId: 0x65,
          thumbs: [
            {
              formatId: 1055,
              offset: 32768,
              size: 32768,
              width: 128,
              height: 128,
              fileName: ":F1055_1.ithmb",
            },
          ],
        },
      ],
      [{ formatId: 1055, imageSize: 32768 }],
    );
    const bytes = serializeArtworkdb(db);
    const parsed = parseArtworkdb(bytes);
    const items = imageItems(parsed);
    expect(items).toHaveLength(2);
    const offsets = items.map((item) => thumbnailsOf(item)[0]?.offset);
    expect(offsets).toEqual([0, 32768]);
    expect(new Set(offsets).size).toBe(2);
  });
});
