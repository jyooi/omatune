/*
 * Regression test for HUF-283.
 *
 * The stock firmware skipped the whole Device Database that a Sync of the
 * Verification Library wrote. It listed no Track, no artist, and no album.
 * The database parsed cleanly and its hash58 was correct, so no test caught
 * it. The media type field on every mhit was 0, and iTunes always writes 1.
 *
 * This test builds the same 14-track database the failing Sync built, then
 * holds it to the rules in `firmwareProblems`. Every rule there comes from a
 * genuine iTunes database written by the reference Device.
 */

import { expect, test } from "bun:test"
import { firmwareProblems, parseItunesdb } from "@omatune/device-database"
import { join } from "node:path"
import { buildItunesdb, serializeSignedLayout, type ItunesdbTrack } from "./itunesdb-write.ts"
import { ZERO_PLAY_DATA } from "./play-data.ts"
import { deviceExtensionFor } from "./transcode-plan.ts"
import type { SelectedTrack } from "./rules.ts"

const MANIFEST = join(import.meta.dir, "../../../fixtures/audio/manifest.json")

type ManifestGapless = {
  encoderDelay: number
  encoderPadding: number
  sampleCount: number
}

type ManifestTrack = {
  path: string
  codec: string
  title: string
  artist: string
  album: string
  albumArtist: string
  track: number
  trackTotal: number
  disc: number
  discTotal: number
  compilation: boolean
  artwork: boolean
  durationSeconds: number
  gapless: ManifestGapless | null
}

type Manifest = {
  counts: { tracks: number, albums: number, albumArtists: number, tracksWithArtwork: number }
  tracks: ManifestTrack[]
}

async function verificationLibraryTracks(): Promise<ItunesdbTrack[]> {
  const manifest = (await Bun.file(MANIFEST).json()) as Manifest
  return manifest.tracks.map((entry, index) => trackOf(entry, index))
}

function trackOf(entry: ManifestTrack, index: number): ItunesdbTrack {
  const libraryExtension = entry.path.slice(entry.path.lastIndexOf(".") + 1)
  const deviceExtension = deviceExtensionFor(libraryExtension)
  const selected: SelectedTrack = {
    relativePath: entry.path,
    size: 20000 + index,
    mtimeMs: 0,
    extension: libraryExtension,
    albumArtist: entry.albumArtist,
    album: entry.album,
    transcode: deviceExtension !== libraryExtension,
    tags: {
      title: entry.title,
      artist: entry.artist,
      album: entry.album,
      albumArtist: entry.albumArtist,
      track: entry.track,
      trackTotal: entry.trackTotal,
      disc: entry.disc,
      discTotal: entry.discTotal,
      compilation: entry.compilation,
      hasArtwork: entry.artwork,
      artworkMime: entry.artwork ? "image/png" : null,
      artworkBytes: null,
      codec: entry.codec as SelectedTrack["tags"]["codec"],
      gapless: entry.gapless
        ? {
            encoderDelay: entry.gapless.encoderDelay,
            encoderPadding: entry.gapless.encoderPadding,
            sampleCount: BigInt(entry.gapless.sampleCount),
          }
        : null,
      durationSeconds: entry.durationSeconds,
    },
  }
  return {
    libraryPath: entry.path,
    devicePath: `iPod_Control/Music/F${String(index % 50).padStart(2, "0")}/${String(index).padStart(16, "0")}.${deviceExtension}`,
    size: selected.size,
    dbid: BigInt(index + 1),
    selected,
    hasArtwork: entry.artwork,
    playData: { ...ZERO_PLAY_DATA, path: entry.path },
  }
}

test("the Verification Library database breaks no firmware rule", async () => {
  const tracks = await verificationLibraryTracks()
  expect(tracks.length).toBe(14)
  const problems = firmwareProblems(buildItunesdb(tracks))
  expect(problems.map((problem) => `${problem.where}: ${problem.detail}`)).toEqual([])
})

test("every Verification Library Track carries an audio media type", async () => {
  const tracks = await verificationLibraryTracks()
  const bytes = serializeSignedLayout(tracks)
  const problems = firmwareProblems(parseItunesdb(bytes))
  expect(problems.filter((problem) => problem.rule === "media-type")).toEqual([])
})

test("a transcoded FLAC Track reaches the Device as an MPEG-4 file type", async () => {
  const tracks = await verificationLibraryTracks()
  const flac = tracks.filter((track) => track.libraryPath.endsWith(".flac"))
  expect(flac.length).toBe(2)
  for (const track of flac) {
    expect(track.devicePath.endsWith(".m4a")).toBe(true)
  }
  expect(firmwareProblems(buildItunesdb(flac))).toEqual([])
})
