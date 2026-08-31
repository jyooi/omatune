import { parseItunesdb } from "@omatune/device-database"
import { expect, test } from "bun:test"
import { ZERO_PLAY_DATA } from "./play-data.ts"
import type { SelectedTrack } from "./rules.ts"
import {
  itunesdbReserveBytes,
  serializeSignedLayout,
  type ItunesdbTrack,
} from "./itunesdb-write.ts"

function track(title: string, index: number): ItunesdbTrack {
  const selected: SelectedTrack = {
    relativePath: `long/${index}.mp3`,
    size: 1000,
    mtimeMs: 0,
    extension: "mp3",
    albumArtist: "A".repeat(256),
    album: "B".repeat(256),
    tags: {
      title,
      artist: "C".repeat(256),
      album: "B".repeat(256),
      albumArtist: "A".repeat(256),
      track: index,
      trackTotal: index,
      disc: 1,
      discTotal: 1,
      compilation: false,
      hasArtwork: false,
      artworkMime: null,
      artworkBytes: null,
      codec: "mp3",
      gapless: null,
      durationSeconds: 1,
    },
  }
  return {
    libraryPath: selected.relativePath,
    devicePath: "iPod_Control/Music/F00/0123456789abcdef.mp3",
    size: selected.size,
    dbid: BigInt(index),
    selected,
    hasArtwork: false,
    playData: ZERO_PLAY_DATA,
  }
}

test("itunesdbReserveBytes covers a serialized iTunesDB", () => {
  const tracks = [track("T".repeat(256), 1), track("U".repeat(256), 2)]
  const bytes = serializeSignedLayout(tracks)
  expect(itunesdbReserveBytes(tracks.length)).toBeGreaterThanOrEqual(bytes.byteLength)
})

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

test("the database carries the fields classic firmware reads", () => {
  const bytes = serializeSignedLayout([track("Title", 1)])
  const db = parseItunesdb(bytes).chunk
  const sectionTypes = db.children.map((section) => u32(section.header, 12))
  expect(sectionTypes).toEqual([1, 2, 3])

  const mhit = db.children[0]!.children[0]!.children[0]!
  const marker = u32(mhit.header, 24)
  expect(marker).toBe(0x4d503320)
  expect(mhit.header[28]).toBe(1)
  expect(mhit.header[29]).toBe(1)

  for (const section of db.children.slice(1)) {
    const mhyp = section.children[0]!.children[0]!
    expect(u32(mhyp.header, 20)).toBe(1)
    expect(mhyp.header.slice(28, 36).some((byte) => byte !== 0)).toBe(true)
    const mhip = mhyp.children.find((child) => child.id === "mhip")
    expect(mhip).toBeDefined()
    expect(u32(mhip!.header, 12)).toBe(mhip!.children.length)
    const position = mhip!.children[0]!
    expect(u32(position.header, 12)).toBe(100)
    expect(u32(position.body, 0)).toBe(1)
  }
})
