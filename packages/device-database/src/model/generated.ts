import type { FamilyRecord } from "./types.ts"

// Generated from docs/support-table.md and src/model/format-table.ts.
// Do not edit. Run: bun run generate

export const modelTable: ReadonlyArray<FamilyRecord> = [
  {
    "family": "iPod classic 120 GB (2008)",
    "libgpodKeys": [
      "CLASSIC_2"
    ],
    "appleModels": [
      "MB562",
      "MB565"
    ],
    "ranges": [],
    "onward": [],
    "supportTier": "Verified",
    "verifiedBy": "Reference Device, firmware 2.0.1 PC, 2026-08-31, omatune main@5350b53, HUF-275, [verification report #23](https://github.com/jyooi/omatune/issues/23)",
    "notes": "hash58, Play Counts 0x1c, artwork 1055/1060/1061",
    "signature": "hash58",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [
      1055,
      1060,
      1061
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod classic 80/160 GB (2007)",
    "libgpodKeys": [
      "CLASSIC_1"
    ],
    "appleModels": [
      "MB029",
      "MB147",
      "MB145",
      "MB150"
    ],
    "ranges": [],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "hash58",
    "signature": "hash58",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [
      1055,
      1060,
      1061
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod classic 160 GB (Late 2009)",
    "libgpodKeys": [
      "CLASSIC_3"
    ],
    "appleModels": [
      "MC293",
      "MC297"
    ],
    "ranges": [],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "hash58",
    "signature": "hash58",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [
      1055,
      1060,
      1061
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod nano 4G",
    "libgpodKeys": [
      "NANO_4"
    ],
    "appleModels": [
      "MB598",
      "MB918"
    ],
    "ranges": [
      {
        "prefix": "MB",
        "start": 598,
        "end": 918
      }
    ],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "hash58, Cover Flow",
    "signature": "hash58",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [
      1055,
      1061
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod nano 3G",
    "libgpodKeys": [
      "NANO_3"
    ],
    "appleModels": [
      "MA978",
      "MB261"
    ],
    "ranges": [],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "hash58, Cover Flow",
    "signature": "hash58",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [
      1055,
      1061
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod video 5G / 5.5G",
    "libgpodKeys": [
      "VIDEO_1",
      "VIDEO_2"
    ],
    "appleModels": [
      "MA002",
      "MA450"
    ],
    "ranges": [
      {
        "prefix": "MA",
        "start": 2,
        "end": 450
      }
    ],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "no signature; gapless needs late firmware",
    "signature": "none",
    "playCountsEntryLength": 16,
    "artworkFormatIds": [
      3007,
      3008,
      3009
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod nano 2G",
    "libgpodKeys": [
      "NANO_2"
    ],
    "appleModels": [
      "MA477",
      "MA497"
    ],
    "ranges": [
      {
        "prefix": "MA",
        "start": 477,
        "end": 497
      }
    ],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "no signature",
    "signature": "none",
    "playCountsEntryLength": 16,
    "artworkFormatIds": [
      3007,
      3008
    ],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod nano 1G",
    "libgpodKeys": [
      "NANO_1"
    ],
    "appleModels": [
      "MA004",
      "MA107"
    ],
    "ranges": [
      {
        "prefix": "MA",
        "start": 4,
        "end": 107
      }
    ],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "no signature, no gapless",
    "signature": "none",
    "playCountsEntryLength": 16,
    "artworkFormatIds": [
      3007,
      3008
    ],
    "fxxFolderCount": 50,
    "gapless": false,
    "colourScreen": true
  },
  {
    "family": "iPod mini",
    "libgpodKeys": [
      "MINI_1",
      "MINI_2"
    ],
    "appleModels": [
      "M9160",
      "M9807"
    ],
    "ranges": [
      {
        "prefix": "M",
        "start": 9160,
        "end": 9807
      }
    ],
    "onward": [],
    "supportTier": "Expected",
    "verifiedBy": "-",
    "notes": "no signature, no colour screen",
    "signature": "none",
    "playCountsEntryLength": 16,
    "artworkFormatIds": [],
    "fxxFolderCount": 20,
    "gapless": false,
    "colourScreen": false
  },
  {
    "family": "iPod nano 5G",
    "libgpodKeys": [
      "NANO_5"
    ],
    "appleModels": [
      "MC027",
      "MC075"
    ],
    "ranges": [
      {
        "prefix": "MC",
        "start": 27,
        "end": 75
      }
    ],
    "onward": [],
    "supportTier": "Unsupported",
    "verifiedBy": "-",
    "notes": "hash72 plus sqlite, key harvested from an iTunes DB",
    "signature": "hash72",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod nano 6G / 7G",
    "libgpodKeys": [
      "NANO_6",
      "NANO_7"
    ],
    "appleModels": [
      "MC525"
    ],
    "ranges": [],
    "onward": [
      {
        "prefix": "MC",
        "start": 525
      }
    ],
    "supportTier": "Unsupported",
    "verifiedBy": "-",
    "notes": "hashAB plus sqlite; 7G not in libgpod",
    "signature": "hashAB",
    "playCountsEntryLength": 28,
    "artworkFormatIds": [],
    "fxxFolderCount": 50,
    "gapless": true,
    "colourScreen": true
  },
  {
    "family": "iPod shuffle 1G to 4G",
    "libgpodKeys": [
      "SHUFFLE_*"
    ],
    "appleModels": [
      "M9724"
    ],
    "ranges": [],
    "onward": [
      {
        "prefix": "M",
        "start": 9724
      }
    ],
    "supportTier": "Unsupported",
    "verifiedBy": "-",
    "notes": "iTunesSD plus iTunesStats second database format",
    "signature": "itunes-sd",
    "playCountsEntryLength": 0,
    "artworkFormatIds": [],
    "fxxFolderCount": 0,
    "gapless": false,
    "colourScreen": false
  }
]
