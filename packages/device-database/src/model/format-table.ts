import type { FamilyFormat } from "./types.ts"

export type ArtworkFormatRow = {
  readonly id: number
  readonly width: number
  readonly height: number
  readonly blockBytes: number
}

export const formatTable: Record<string, FamilyFormat> = {
  "iPod classic 120 GB (2008)": {
    signature: "hash58",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [1055, 1060, 1061],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod classic 80/160 GB (2007)": {
    signature: "hash58",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [1055, 1060, 1061],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod classic 160 GB (Late 2009)": {
    signature: "hash58",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [1055, 1060, 1061],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod nano 4G": {
    signature: "hash58",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [1055, 1061],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod nano 3G": {
    signature: "hash58",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [1055, 1061],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod video 5G / 5.5G": {
    signature: "none",
    playCountsEntryLength: 0x10,
    artworkFormatIds: [3007, 3008, 3009],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod nano 2G": {
    signature: "none",
    playCountsEntryLength: 0x10,
    artworkFormatIds: [3007, 3008],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod nano 1G": {
    signature: "none",
    playCountsEntryLength: 0x10,
    artworkFormatIds: [3007, 3008],
    fxxFolderCount: 50,
    gapless: false,
    colourScreen: true,
  },
  "iPod mini": {
    signature: "none",
    playCountsEntryLength: 0x10,
    artworkFormatIds: [],
    fxxFolderCount: 20,
    gapless: false,
    colourScreen: false,
  },
  "iPod nano 5G": {
    signature: "hash72",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod nano 6G / 7G": {
    signature: "hashAB",
    playCountsEntryLength: 0x1c,
    artworkFormatIds: [],
    fxxFolderCount: 50,
    gapless: true,
    colourScreen: true,
  },
  "iPod shuffle 1G to 4G": {
    signature: "itunes-sd",
    playCountsEntryLength: 0,
    artworkFormatIds: [],
    fxxFolderCount: 0,
    gapless: false,
    colourScreen: false,
  },
}

const classicArtworkFormats: ReadonlyArray<ArtworkFormatRow> = [
  { id: 1055, width: 128, height: 128, blockBytes: 32768 },
  { id: 1060, width: 320, height: 320, blockBytes: 204800 },
  { id: 1061, width: 55, height: 55, blockBytes: 6160 },
]

export const artworkFormatRows: Record<string, ReadonlyArray<ArtworkFormatRow>> = {
  "iPod classic 120 GB (2008)": classicArtworkFormats,
  "iPod classic 80/160 GB (2007)": classicArtworkFormats,
  "iPod classic 160 GB (Late 2009)": classicArtworkFormats,
}

export function artworkFormatRow(
  family: string,
  id: number,
): ArtworkFormatRow | undefined {
  const rows = artworkFormatRows[family]
  return rows?.find((row) => row.id === id)
}
