import { describe, expect, test } from "bun:test";
import {
  artworkFiles,
  imageItems,
  mhiiDbid,
  parseArtworkdb,
  parseMhif,
  parseMhii,
  parseMhni,
  serializeArtworkdb,
  serializeMhif,
  serializeMhii,
  serializeMhni,
  thumbnailsOf,
} from "../src/index.ts";
import {
  artworkMhsd,
  containerMhod,
  mhfd,
  mhif,
  mhii,
  mhlaEmpty,
  mhlf,
  mhli,
  mhni,
} from "./artwork-build.ts";

const thumb = {
  formatId: 1055,
  offset: 0,
  size: 32768,
  width: 128,
  height: 128,
  fileName: ":Artwork:F1055_1.ithmb",
};

describe("ArtworkDB codec", () => {
  test("round-trips a synthetic database byte for byte", () => {
    const nested = mhni(thumb);
    const image = mhii({
      dbid: 0x1122334455667788n,
      thumbs: [containerMhod(nested)],
    });
    const bytes = mhfd([
      artworkMhsd(1, mhli([image])),
      artworkMhsd(2, mhlaEmpty()),
      artworkMhsd(3, mhlf([mhif(1055, 32768)])),
    ]);
    const db = parseArtworkdb(bytes);
    expect(serializeArtworkdb(db)).toEqual(bytes);
    const items = imageItems(db);
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) {
      throw new Error("missing image");
    }
    expect(mhiiDbid(item)).toBe(0x1122334455667788n);
    expect(thumbnailsOf(item)).toEqual([thumb]);
    expect(artworkFiles(db)).toEqual([{ formatId: 1055, imageSize: 32768 }]);
  });

  test("named chunk parsers round-trip mhii, mhni, and mhif", () => {
    const name = mhni(thumb);
    const image = mhii({
      dbid: 1n,
      thumbs: [containerMhod(name)],
    });
    const file = mhif(1060, 204800);
    expect(serializeMhni(parseMhni(name).chunk)).toEqual(name);
    expect(serializeMhii(parseMhii(image).chunk)).toEqual(image);
    expect(serializeMhif(parseMhif(file).chunk)).toEqual(file);
  });
});
