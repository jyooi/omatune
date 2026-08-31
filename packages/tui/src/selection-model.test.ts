import { expect, test } from "bun:test"
import { emptySelection, serializeSelection, type ScannedFile, type TrackTags } from "@omatune/core"
import {
  deleteVisibleRule,
  flattenTree,
  formatPlanSummary,
  groupLibrary,
  mirrorRows,
  planOf,
  selectedPathsOf,
  tickState,
  toggleAlbum,
  toggleArtist,
  visibleRules,
} from "./selection-model.ts"

function tags(input: {
  title: string
  artist: string
  album: string
  albumArtist?: string
  track?: number
}): TrackTags {
  return {
    title: input.title,
    artist: input.artist,
    album: input.album,
    albumArtist: input.albumArtist ?? input.artist,
    track: input.track ?? null,
    trackTotal: null,
    disc: null,
    discTotal: null,
    compilation: false,
    hasArtwork: false,
    artworkMime: null,
    artworkBytes: null,
    codec: "mp3",
    gapless: null,
    durationSeconds: 2,
  }
}

function file(path: string, size: number, tag: TrackTags): ScannedFile {
  return {
    relativePath: path,
    size,
    mtimeMs: 1,
    extension: "mp3",
    tags: tag,
  }
}

const boc = tags({ title: "Gemini", artist: "Boards of Canada", album: "Tomorrow's Harvest", track: 1 })
const geo = tags({ title: "Ready", artist: "Boards of Canada", album: "Geogaddi", track: 1 })
const pablo = tags({ title: "You", artist: "Radiohead", album: "Pablo Honey", track: 1 })
const kida = tags({ title: "Everything", artist: "Radiohead", album: "Kid A", track: 1 })

const files: ScannedFile[] = [
  file("Boards of Canada/Tomorrow's Harvest/01 Gemini.mp3", 8_000_000, boc),
  file("Boards of Canada/Geogaddi/01 Ready Prosper Ye.mp3", 7_000_000, geo),
  file("Radiohead/Pablo Honey/01 You.mp3", 5_000_000, pablo),
  file("Radiohead/Kid A/01 Everything In Its Right Place.mp3", 6_000_000, kida),
]

test("ticking an Artist writes an album_artist Rule", () => {
  const artists = groupLibrary(files)
  const boards = artists.find((node) => node.name === "Boards of Canada")
  expect(boards).toBeDefined()
  const next = toggleArtist(emptySelection(), "Boards of Canada", "none")
  expect(serializeSelection(next)).toContain('album_artist = "Boards of Canada"')
  expect(serializeSelection(next)).not.toContain("album =")
  const selected = selectedPathsOf(files, next)
  expect(selected.size).toBe(2)
})

test("ticking an Album writes album_artist plus album", () => {
  const artists = groupLibrary(files)
  const boards = artists.find((node) => node.name === "Boards of Canada")
  const harvest = boards?.albums.find((node) => node.album === "Tomorrow's Harvest")
  expect(boards && harvest).toBeTruthy()
  if (!boards || !harvest) {
    return
  }
  const next = toggleAlbum(emptySelection(), boards, harvest, "none")
  expect(serializeSelection(next)).toBe(`version = 1

[[include]]
album_artist = "Boards of Canada"
album = "Tomorrow's Harvest"
`)
})

test("path and exclude Rules survive a tick rewrite", () => {
  const start = {
    version: 1 as const,
    include: [
      { kind: "path" as const, path: "Podcasts/**/*.m4a" },
    ],
    exclude: [
      { kind: "album" as const, albumArtist: "Radiohead", album: "Pablo Honey" },
    ],
  }
  const next = toggleArtist(start, "Boards of Canada", "none")
  const text = serializeSelection(next)
  expect(text).toContain('path = "Podcasts/**/*.m4a"')
  expect(text).toContain('album = "Pablo Honey"')
  expect(text).toContain("[[exclude]]")
})

test("d removes a path Rule from the visible list", () => {
  const start = {
    version: 1 as const,
    include: [
      { kind: "album_artist" as const, albumArtist: "Boards of Canada" },
      { kind: "path" as const, path: "Podcasts/**/*.m4a" },
    ],
    exclude: [
      { kind: "album" as const, albumArtist: "Radiohead", album: "Pablo Honey" },
    ],
  }
  expect(visibleRules(start)).toHaveLength(2)
  const next = deleteVisibleRule(start, 0)
  expect(serializeSelection(next)).not.toContain("Podcasts")
  expect(serializeSelection(next)).toContain("Pablo Honey")
  expect(serializeSelection(next)).toContain("Boards of Canada")
})

test("plan summary reports add remove bytes and fit", () => {
  const selection = toggleArtist(emptySelection(), "Boards of Canada", "none")
  const plan = planOf(files, selection, null, 100_000_000)
  expect(plan.add).toHaveLength(2)
  expect(plan.remove).toHaveLength(0)
  expect(formatPlanSummary(plan)).toContain("+2")
  expect(formatPlanSummary(plan)).toContain("-0")
  expect(formatPlanSummary(plan)).toContain("fits")
  const tight = planOf(files, selection, null, 1000)
  expect(formatPlanSummary(tight)).toContain("does not fit")
})

test("mirror Album count includes only plan add and keep Tracks", () => {
  const mixed: ScannedFile[] = [
    file("Radiohead/Kid A/01 Everything In Its Right Place.mp3", 6_000_000, kida),
    {
      // Vorbis stays Skipped, so the Album count must leave it out.
      relativePath: "Radiohead/Kid A/01 Everything In Its Right Place.ogg",
      size: 30_000_000,
      mtimeMs: 1,
      extension: "ogg",
      tags: { ...kida, title: "Everything Vorbis" },
    },
  ]
  const artists = groupLibrary(mixed)
  const selection = toggleArtist(emptySelection(), "Radiohead", "none")
  const plan = planOf(mixed, selection, null, 100_000_000)
  expect(plan.add).toHaveLength(1)
  const kid = mirrorRows(artists, plan).find((row) => row.kind === "album" && row.album === "Kid A")
  expect(kid).toEqual({
    kind: "album",
    album: "Kid A",
    marker: "+",
    count: "1",
  })
})

test("Artist tick ignores Tracks that cannot go on the Device", () => {
  const mixed: ScannedFile[] = [
    file("Radiohead/Kid A/01 Everything In Its Right Place.mp3", 6_000_000, kida),
    file("Radiohead/Kid A/CON.mp3", 6_000_000, { ...kida, title: "Bad" }),
  ]
  const artists = groupLibrary(mixed)
  const radiohead = artists.find((node) => node.name === "Radiohead")
  expect(radiohead).toBeDefined()
  if (!radiohead) {
    return
  }
  const tracks = radiohead.albums.flatMap((album) => album.tracks)
  const on = toggleArtist(emptySelection(), "Radiohead", "none")
  const selected = selectedPathsOf(mixed, on)
  expect(tickState(tracks, selected)).toBe("all")
  const off = toggleArtist(on, "Radiohead", tickState(tracks, selected))
  expect(off.include).toEqual([])
})

test("tree rows are Artist then Album", () => {
  const artists = groupLibrary(files)
  const rows = flattenTree(artists, new Set(), new Set())
  expect(rows.map((row) => row.kind)).toEqual([
    "artist",
    "album",
    "album",
    "artist",
    "album",
    "album",
  ])
})

test("Unlisted rows sit dimmed at the end of the Library tree", () => {
  const artists = groupLibrary(files)
  const rows = flattenTree(artists, new Set(), new Set(), [
    { relativePath: "song.alac", reason: "rename .alac to .m4a" },
    { relativePath: "bare.m4a", reason: "missing artist/album tags" },
  ])
  const tail = rows.slice(-2)
  expect(tail).toEqual([
    { kind: "unlisted", path: "song.alac", reason: "rename .alac to .m4a" },
    { kind: "unlisted", path: "bare.m4a", reason: "missing artist/album tags" },
  ])
})
