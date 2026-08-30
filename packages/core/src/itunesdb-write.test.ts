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
