import { expect, test } from "bun:test"
import {
  emptySelection,
  serializeSelection,
  type Ledger,
  type ScannedFile,
  type TrackTags,
  type UnlistedFile,
} from "@omatune/core"
import { ManualClock, createTestRenderer } from "@opentui/core/testing"
import { attachSelectionScreen } from "./selection-screen.ts"

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

const harvest = tags({ title: "Gemini", artist: "Boards of Canada", album: "Tomorrow's Harvest", track: 1 })
const geogaddi = tags({ title: "Ready", artist: "Boards of Canada", album: "Geogaddi", track: 1 })
const pablo = tags({ title: "You", artist: "Radiohead", album: "Pablo Honey", track: 1 })
const kidA = tags({ title: "Everything", artist: "Radiohead", album: "Kid A", track: 1 })

const files: ScannedFile[] = [
  file("Boards of Canada/Tomorrow's Harvest/01 Gemini.mp3", 8_100_000, harvest),
  file("Boards of Canada/Geogaddi/01 Ready Prosper Ye.mp3", 7_000_000, geogaddi),
  file("Radiohead/Pablo Honey/01 You.mp3", 5_100_000, pablo),
  file("Radiohead/Kid A/01 Everything In Its Right Place.mp3", 6_200_000, kidA),
]

const ledger: Ledger = {
  version: 1,
  serial: "000a27001395d5a3",
  libraryRoot: "~/Music",
  lastCommitTime: 1,
  tracks: [
    {
      libraryPath: "Radiohead/Pablo Honey/01 You.mp3",
      size: 5_100_000,
      mtime: 1,
      sha256: "aa",
      devicePath: "iPod_Control/Music/F00/aa.mp3",
      dbid: "1",
      artworkHash: null,
      writtenRating: null,
      lastPlayed: null,
      bookmark: null,
    },
  ],
}

const startSelection = {
  version: 1 as const,
  include: [
    { kind: "album_artist" as const, albumArtist: "Radiohead" },
    { kind: "path" as const, path: "Podcasts/**/*.m4a" },
  ],
  exclude: [
    { kind: "album" as const, albumArtist: "Radiohead", album: "Pablo Honey" },
  ],
}

async function mount(
  width: number,
  height: number,
  overrides: {
    libraryRoot?: string
    files?: ScannedFile[]
    unlisted?: ReadonlyArray<UnlistedFile>
    selection?: typeof startSelection
    registered?: boolean
    registerDevice?: () => Promise<{ serial: string; name: string }>
  } = {},
) {
  const clock = new ManualClock()
  const written: string[] = []
  const setup = await createTestRenderer({
    width,
    height,
    clock,
    useMouse: true,
    consoleMode: "disabled",
  })
  const handle = attachSelectionScreen(
    setup.renderer,
    {
      libraryRoot: overrides.libraryRoot ?? "~/Music",
      deviceName: "Classic 120GB",
      serial: "000A27001395D5A3",
      tier: "Verified",
      freeBytes: 24_300_000_000,
      tracksOnDevice: 1,
      files: overrides.files ?? files,
      unlisted: overrides.unlisted ?? [],
      selection: overrides.selection ?? startSelection,
      ledger,
      writeSelection: async (selection) => {
        written.push(serializeSelection(selection))
      },
      registered: overrides.registered,
      registerDevice: overrides.registerDevice,
    },
    { clock },
  )
  clock.advance(100)
  await setup.renderOnce()
  return { ...setup, clock, handle, written }
}

test("Selection screen snapshot at 110x32", async () => {
  const view = await mount(110, 32)
  expect(view.captureCharFrame()).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("Selection screen snapshot at 80x24", async () => {
  const view = await mount(80, 24)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Verified")
  expect(frame).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("80-column header keeps Support Tier with an absolute library path", async () => {
  const view = await mount(80, 24, { libraryRoot: "/path/to/music" })
  const header = view.captureCharFrame().split("\n")[0] ?? ""
  expect(header).toContain("Verified")
  expect(header).toContain("000A27001395D5A3")
  expect(header).toContain("Classic 120GB")
  view.handle.dispose()
  view.renderer.destroy()
})

test("Space ticks the Artist and rewrites selection.toml", async () => {
  const view = await mount(110, 32)
  view.mockInput.pressKey(" ")
  view.clock.advance(100)
  await view.handle.flush()
  await view.renderOnce()
  const frame = view.captureCharFrame()
  expect(frame).toContain("[x]")
  expect(frame).toContain("Boards of Canada")
  expect(view.written.at(-1)).toContain('album_artist = "Boards of Canada"')
  expect(view.written.at(-1)).toContain('path = "Podcasts/**/*.m4a"')
  view.handle.dispose()
  view.renderer.destroy()
})

test("Right expands read-only Tracks", async () => {
  const view = await mount(110, 32)
  view.mockInput.pressArrow("down")
  view.clock.advance(100)
  await view.renderOnce()
  view.mockInput.pressArrow("right")
  view.clock.advance(100)
  await view.renderOnce()
  expect(view.captureCharFrame()).toContain("Ready")
  view.handle.dispose()
  view.renderer.destroy()
})

test("d deletes the selected path Rule", async () => {
  const view = await mount(110, 32)
  for (let i = 0; i < 6; i += 1) {
    view.mockInput.pressKey("j")
    view.clock.advance(100)
    await view.renderOnce()
  }
  view.mockInput.pressKey("d")
  view.clock.advance(100)
  await view.handle.flush()
  await view.renderOnce()
  expect(view.written.at(-1)).not.toContain("Podcasts")
  expect(view.written.at(-1)).toContain("Pablo Honey")
  view.handle.dispose()
  view.renderer.destroy()
})

test("mouse click ticks and selects a row", async () => {
  const view = await mount(110, 32)
  const point = view.handle.treeRowPoint(0)
  expect(point).not.toBeNull()
  if (!point) {
    return
  }
  await view.mockMouse.click(point.x, point.y)
  view.clock.advance(100)
  await view.handle.flush()
  await view.renderOnce()
  expect(view.written.at(-1)).toContain('album_artist = "Boards of Canada"')
  view.handle.dispose()
  view.renderer.destroy()
})

test("live plan summary updates after a tick", async () => {
  const view = await mount(110, 32)
  const before = view.captureCharFrame()
  expect(before).toContain("+1")
  view.mockInput.pressKey(" ")
  view.clock.advance(100)
  await view.handle.flush()
  await view.renderOnce()
  const after = view.captureCharFrame()
  expect(after).toContain("+3")
  expect(after).toContain("fits")
  view.handle.dispose()
  view.renderer.destroy()
})

test("an unregistered Device shows the Register notice", async () => {
  const view = await mount(110, 32, {
    registered: false,
    registerDevice: async () => ({ serial: "000a27001395d5a3", name: "Classic 120GB" }),
  })
  const frame = view.captureCharFrame()
  expect(frame).toContain("Device 000A27001395D5A3 is not registered - press a to Register it")
  view.handle.dispose()
  view.renderer.destroy()
})

test("a Register keypress writes config and clears the notice", async () => {
  let calls = 0
  const view = await mount(110, 32, {
    registered: false,
    registerDevice: async () => {
      calls += 1
      return { serial: "000a27001395d5a3", name: "Classic 120GB" }
    },
  })
  view.mockInput.pressKey("a")
  view.clock.advance(100)
  await Promise.resolve()
  await Promise.resolve()
  await view.renderOnce()
  expect(calls).toBe(1)
  const frame = view.captureCharFrame()
  expect(frame).not.toContain("is not registered")
  expect(frame).toContain("rename it in config.toml")
  view.handle.dispose()
  view.renderer.destroy()
})

test("a registered Device shows no Register notice", async () => {
  const view = await mount(110, 32, { registered: true })
  const frame = view.captureCharFrame()
  expect(frame).not.toContain("is not registered")
  view.handle.dispose()
  view.renderer.destroy()
})

test("q waits for the Selection write before onQuit", async () => {
  const clock = new ManualClock()
  let releaseWrite: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const written: string[] = []
  let quitWrites = -1
  let resumeQuit: () => void = () => {}
  const quitSeen = new Promise<void>((resolve) => {
    resumeQuit = resolve
  })
  const setup = await createTestRenderer({
    width: 110,
    height: 32,
    clock,
    useMouse: true,
    consoleMode: "disabled",
  })
  attachSelectionScreen(
    setup.renderer,
    {
      libraryRoot: "~/Music",
      deviceName: "Classic 120GB",
      serial: "000A27001395D5A3",
      tier: "Verified",
      freeBytes: 24_300_000_000,
      tracksOnDevice: 1,
      files,
      selection: startSelection,
      ledger,
      writeSelection: async (selection) => {
        await gate
        written.push(serializeSelection(selection))
      },
    },
    {
      clock,
      onQuit: () => {
        quitWrites = written.length
        resumeQuit()
      },
    },
  )
  clock.advance(100)
  await setup.renderOnce()
  setup.mockInput.pressKey(" ")
  setup.mockInput.pressKey("q")
  await Promise.resolve()
  expect(quitWrites).toBe(-1)
  expect(written).toHaveLength(0)
  releaseWrite()
  await quitSeen
  expect(quitWrites).toBe(1)
  expect(written.at(-1)).toContain('album_artist = "Boards of Canada"')
  setup.renderer.destroy()
})

test("a failed Selection write does not block the next tick", async () => {
  const clock = new ManualClock()
  let calls = 0
  const written: string[] = []
  const setup = await createTestRenderer({
    width: 110,
    height: 32,
    clock,
    useMouse: true,
    consoleMode: "disabled",
  })
  const handle = attachSelectionScreen(
    setup.renderer,
    {
      libraryRoot: "~/Music",
      deviceName: "Classic 120GB",
      serial: "000A27001395D5A3",
      tier: "Verified",
      freeBytes: 24_300_000_000,
      tracksOnDevice: 1,
      files,
      selection: startSelection,
      ledger,
      writeSelection: async (selection) => {
        calls += 1
        if (calls === 1) {
          throw new Error("disk full")
        }
        written.push(serializeSelection(selection))
      },
    },
    { clock },
  )
  clock.advance(100)
  await setup.renderOnce()
  setup.mockInput.pressKey(" ")
  await handle.flush()
  setup.mockInput.pressKey(" ")
  await handle.flush()
  expect(calls).toBe(2)
  expect(written).toHaveLength(1)
  expect(written[0]).not.toContain('album_artist = "Boards of Canada"')
  handle.dispose()
  setup.renderer.destroy()
})

test("empty Selection collapses the Rules box", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({
    width: 110,
    height: 32,
    clock,
    useMouse: true,
    consoleMode: "disabled",
  })
  const handle = attachSelectionScreen(
    setup.renderer,
    {
      libraryRoot: "~/Music",
      deviceName: "Classic 120GB",
      serial: "000A27001395D5A3",
      tier: "Verified",
      freeBytes: 24_300_000_000,
      tracksOnDevice: 0,
      files,
      selection: emptySelection(),
      ledger: null,
      writeSelection: async () => {},
    },
    { clock },
  )
  clock.advance(100)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Rules")
  expect(frame).not.toContain("path =")
  handle.dispose()
  setup.renderer.destroy()
})

test("Unlisted rows render with a reason and a header count", async () => {
  const view = await mount(110, 32, {
    unlisted: [
      { relativePath: "song.alac", reason: "rename .alac to .m4a" },
      { relativePath: "bare.m4a", reason: "missing artist/album tags" },
    ],
  })
  const frame = view.captureCharFrame()
  expect(frame).toContain("Unlisted: 2")
  expect(frame).toContain("song.alac")
  expect(frame).toContain("rename .alac to .m4a")
  expect(frame).toContain("bare.m4a")
  expect(frame).toContain("missing artist/album tags")
  for (let i = 0; i < 6; i += 1) {
    view.mockInput.pressKey("j")
    view.clock.advance(100)
    await view.renderOnce()
  }
  view.mockInput.pressKey(" ")
  view.clock.advance(100)
  await view.handle.flush()
  await view.renderOnce()
  expect(view.written).toEqual([])
  view.handle.dispose()
  view.renderer.destroy()
})
