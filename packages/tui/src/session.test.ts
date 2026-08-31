import { expect, test } from "bun:test"
import {
  SELECTION_EMPTY,
  SyncError,
  type Ledger,
  type ScannedFile,
  type SyncEvent,
  type SyncPlan,
  type SyncRequest,
  type TrackTags,
} from "@omatune/core"
import { ManualClock, createTestRenderer } from "@opentui/core/testing"
import { EJECTED_LINE, STILL_MOUNTED_LINE } from "./report-text.ts"
import { attachSelectionScreen, type TuiFinish } from "./selection-screen.ts"

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
    track: input.track ?? 1,
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

const harvest = tags({ title: "Gemini", artist: "Boards of Canada", album: "Tomorrow's Harvest" })
const kidA = tags({ title: "Everything", artist: "Radiohead", album: "Kid A" })
const pablo = tags({ title: "You", artist: "Radiohead", album: "Pablo Honey" })

const files: ScannedFile[] = [
  file("Boards of Canada/Tomorrow's Harvest/01 Gemini.mp3", 8_100_000, harvest),
  file("Radiohead/Kid A/01 Everything In Its Right Place.mp3", 6_200_000, kidA),
  file("Radiohead/Pablo Honey/01 You.mp3", 5_100_000, pablo),
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
  include: [{ kind: "album" as const, albumArtist: "Radiohead", album: "Kid A" }],
  exclude: [],
}

const addTrack = {
  path: "Radiohead/Kid A/01 Everything In Its Right Place.mp3",
  devicePath: "iPod_Control/Music/F00/bb.mp3",
  size: 6_200_000,
  transcode: false,
  estimated: false,
}
const removeTrack = {
  path: "Radiohead/Pablo Honey/01 You.mp3",
  devicePath: "iPod_Control/Music/F00/aa.mp3",
  size: 5_100_000,
  transcode: false,
  estimated: false,
}

function makePlan(kind: SyncPlan["kind"] = "normal"): SyncPlan {
  return {
    kind,
    add: [addTrack],
    remove: [removeTrack],
    keep: [],
    skipped: [{ path: "Podcasts/2026-08-19 Interview.m4a", reason: "unreadable_tags" }],
    bytesNeeded: 6_200_000,
    freeSpaceAfter: 24_298_900_000,
    forceModel: null,
    playCountsPending: 0,
    transcodeCount: 0,
    unlisted: [],
  }
}

const midCopy: SyncEvent = {
  type: "progress",
  phase: "copy",
  bytesDone: 3_100_000,
  bytesTotal: 6_200_000,
  filesDone: 0,
  filesTotal: 1,
  currentFile: "Radiohead/Kid A/01 Everything In Its Right Place.mp3",
}

const doneReport: SyncEvent = {
  type: "report",
  added: 1,
  removed: 1,
  kept: 0,
  skipped: 1,
  artworkSkipped: [],
  ejected: true,
}

function scriptedRun(
  plan: SyncPlan,
  after: ReadonlyArray<SyncEvent>,
  holdConfirm?: Promise<void>,
) {
  return async (request: SyncRequest, onEvent: (event: SyncEvent) => void) => {
    onEvent({ type: "plan", plan })
    if (holdConfirm) {
      await holdConfirm
    }
    const ok = await request.confirm(plan)
    if (!ok) {
      throw new SyncError({ message: "Sync cancelled.", code: 1 })
    }
    for (const event of after) {
      onEvent(event)
    }
  }
}

async function mount(
  width: number,
  height: number,
  input: {
    plan?: SyncPlan
    after?: ReadonlyArray<SyncEvent>
    yes?: boolean
    holdConfirm?: Promise<void>
    fail?: SyncError
    eject?: () => Promise<void>
  } = {},
) {
  const clock = new ManualClock()
  const finished: TuiFinish[] = []
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
      libraryRoot: "~/Music",
      deviceName: "Classic 120GB",
      serial: "000A27001395D5A3",
      tier: "Verified",
      freeBytes: 24_300_000_000,
      tracksOnDevice: 1,
      files,
      selection: startSelection,
      ledger,
      writeSelection: async () => {},
      family: "iPod classic 120 GB (2008)",
      volumeFormat: "FAT32",
      ownerState: "omatune",
      mountPoint: "/run/media/david/IPOD",
      notes: [],
      yes: input.yes,
      eject: input.eject,
    },
    {
      clock,
      runSync: input.fail
        ? async () => {
            throw input.fail
          }
        : scriptedRun(
            input.plan ?? makePlan(),
            input.after ?? [midCopy, doneReport],
            input.holdConfirm,
          ),
      onFinish: (result) => {
        finished.push(result)
      },
    },
  )
  clock.advance(100)
  await setup.renderOnce()
  return { ...setup, clock, handle, finished }
}

async function settle(view: { clock: ManualClock; renderOnce: () => Promise<void> }): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  view.clock.advance(100)
  await view.renderOnce()
}

test("Sync Plan screen snapshot at 110x32", async () => {
  const view = await mount(110, 32, { after: [] })
  view.mockInput.pressEnter()
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Sync Plan")
  expect(frame).toContain("Add 1")
  expect(frame).toContain("Remove 1")
  expect(frame).toContain("Keep 0")
  expect(frame).toContain("Skipped 1")
  expect(frame).toContain("unreadable tags")
  expect(frame).toContain("Device after Sync")
  expect(frame).toContain("Sync now? [y/N]")
  expect(frame).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("Sync Plan screen snapshot at 80x24", async () => {
  const view = await mount(80, 24, { after: [] })
  view.mockInput.pressEnter()
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Sync Plan")
  expect(frame).toContain("Device after Sync")
  expect(frame).toContain("Sync now? [y/N]")
  expect(frame).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("confirm y starts the Sync screen", async () => {
  const view = await mount(110, 32, { after: [midCopy] })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(1000)
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Phase: copy")
  expect(frame).toContain("3.1 MB of 6.2 MB")
  expect(frame).toContain("0 of 1 files")
  expect(frame).toContain("Everything In Its Right Place")
  expect(frame).not.toContain("01 Gemini.mp3")
  expect(frame).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("progress mid-copy snapshot at 80x24", async () => {
  const view = await mount(80, 24, { after: [midCopy] })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(1000)
  await settle(view)
  expect(view.captureCharFrame()).toContain("Phase: copy")
  expect(view.captureCharFrame()).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("confirm typed wipe starts Sync", async () => {
  const view = await mount(110, 32, { plan: makePlan("wipe"), after: [midCopy], yes: true })
  view.mockInput.pressEnter()
  await settle(view)
  const before = view.captureCharFrame()
  expect(before).toContain("Wipe and Sync?")
  expect(before).not.toContain("Sync now? [y/N]")
  view.mockInput.pressKey("w")
  view.mockInput.pressKey("i")
  view.mockInput.pressKey("p")
  view.mockInput.pressKey("e")
  await settle(view)
  expect(view.captureCharFrame()).toContain("wipe")
  view.mockInput.pressEnter()
  view.clock.advance(1000)
  await settle(view)
  expect(view.captureCharFrame()).toContain("Phase: copy")
  view.handle.dispose()
  view.renderer.destroy()
})

test("Esc from the plan returns to Selection", async () => {
  const view = await mount(110, 32, { after: [] })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressEscape()
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Enter plan")
  expect(frame).not.toContain("Sync now? [y/N]")
  view.handle.dispose()
  view.renderer.destroy()
})

test("Esc before confirm waiter returns to Selection", async () => {
  let release: (() => void) | undefined
  const holdConfirm = new Promise<void>((resolve) => {
    release = resolve
  })
  const view = await mount(110, 32, { after: [], holdConfirm })
  view.mockInput.pressEnter()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Sync now? [y/N]")
  view.mockInput.pressEscape()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Enter plan")
  expect(view.captureCharFrame()).not.toContain("Sync now? [y/N]")
  release?.()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Enter plan")
  expect(view.captureCharFrame()).not.toContain("Sync now? [y/N]")
  view.handle.dispose()
  view.renderer.destroy()
})

test("y before confirm waiter starts Sync", async () => {
  let release: (() => void) | undefined
  const holdConfirm = new Promise<void>((resolve) => {
    release = resolve
  })
  const view = await mount(110, 32, { after: [midCopy], holdConfirm })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  await settle(view)
  release?.()
  view.clock.advance(1000)
  await settle(view)
  expect(view.captureCharFrame()).toContain("Phase: copy")
  view.handle.dispose()
  view.renderer.destroy()
})

test("Report screen snapshot at 110x32", async () => {
  const view = await mount(110, 32)
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(5000)
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("Sync complete")
  expect(frame).toContain(EJECTED_LINE)
  expect(frame).toContain("+1 added")
  expect(frame).toContain("Podcasts/2026-08-19 Interview.m4a")
  expect(frame).toContain("unreadable tags")
  expect(frame).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("Report screen snapshot at 80x24", async () => {
  const view = await mount(80, 24)
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(5000)
  await settle(view)
  expect(view.captureCharFrame()).toMatchSnapshot()
  view.handle.dispose()
  view.renderer.destroy()
})

test("Enter on the report prints it to stdout after the screen closes", async () => {
  const view = await mount(110, 32)
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(5000)
  await settle(view)
  view.mockInput.pressEnter()
  await settle(view)
  expect(view.finished).toHaveLength(1)
  expect(view.finished[0]?.code).toBe(0)
  expect(view.finished[0]?.stdout).toContain("Added: 1")
  expect(view.finished[0]?.stdout).toContain(EJECTED_LINE)
  expect(view.finished[0]?.stdout).toContain("Elapsed:")
  expect(view.finished[0]?.stdout).toContain(
    "Skipped Podcasts/2026-08-19 Interview.m4a: unreadable_tags",
  )
  view.renderer.destroy()
})

test("Device screen is one key away and shows devices facts", async () => {
  const view = await mount(110, 32, { after: [] })
  view.mockInput.pressKey("i")
  await settle(view)
  const frame = view.captureCharFrame()
  expect(frame).toContain("SERIAL")
  expect(frame).toContain("000A27001395D5A3")
  expect(frame).toContain("FAMILY")
  expect(frame).toContain("iPod classic 120 GB (2008)")
  expect(frame).toContain("TIER")
  expect(frame).toContain("FORMAT")
  expect(frame).toContain("FAT32")
  expect(frame).toContain("OWNER")
  expect(frame).toContain("omatune")
  expect(frame).toContain("MOUNT")
  expect(frame).toContain("/run/media/david/IPOD")
  expect(frame).toContain("NOTES")
  expect(frame).toMatchSnapshot()
  view.mockInput.pressEscape()
  await settle(view)
  expect(view.captureCharFrame()).toContain("Enter plan")
  view.handle.dispose()
  view.renderer.destroy()
})

test("report after a refusal shows still mounted and ejects on e", async () => {
  const ejectCalls: string[] = []
  const view = await mount(110, 32, {
    fail: new SyncError({ message: SELECTION_EMPTY, code: 1 }),
    eject: async () => {
      ejectCalls.push("eject")
    },
  })
  view.mockInput.pressEnter()
  await settle(view)
  const stopped = view.captureCharFrame()
  expect(stopped).toContain("Sync stopped")
  expect(stopped).toContain(SELECTION_EMPTY)
  expect(stopped).toContain(STILL_MOUNTED_LINE)
  expect(stopped).toContain("e eject")
  view.mockInput.pressKey("e")
  await settle(view)
  expect(ejectCalls).toEqual(["eject"])
  const ejected = view.captureCharFrame()
  expect(ejected).toContain(EJECTED_LINE)
  expect(ejected).not.toContain(STILL_MOUNTED_LINE)
  view.handle.dispose()
  view.renderer.destroy()
})

test("report after Sync without eject stays mounted until e", async () => {
  const ejectCalls: string[] = []
  const view = await mount(110, 32, {
    after: [midCopy, { ...doneReport, ejected: false }],
    eject: async () => {
      ejectCalls.push("eject")
    },
  })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("y")
  view.clock.advance(5000)
  await settle(view)
  expect(view.captureCharFrame()).toContain(STILL_MOUNTED_LINE)
  expect(view.captureCharFrame()).toContain("e eject")
  view.mockInput.pressKey("e")
  await settle(view)
  expect(ejectCalls).toEqual(["eject"])
  expect(view.captureCharFrame()).toContain(EJECTED_LINE)
  view.mockInput.pressEnter()
  await settle(view)
  expect(view.finished[0]?.stdout).toContain(EJECTED_LINE)
  view.renderer.destroy()
})

test("eject failure shows the cause and lets the user retry", async () => {
  let attempts = 0
  const view = await mount(110, 32, {
    fail: new SyncError({ message: SELECTION_EMPTY, code: 1 }),
    eject: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error("Unmount denied.")
      }
    },
  })
  view.mockInput.pressEnter()
  await settle(view)
  view.mockInput.pressKey("e")
  await settle(view)
  const failed = view.captureCharFrame()
  expect(failed).toContain(STILL_MOUNTED_LINE)
  expect(failed).toContain("Eject failed: Unmount denied.")
  expect(failed).toContain("press e to try again")
  view.mockInput.pressKey("e")
  await settle(view)
  expect(attempts).toBe(2)
  const ejected = view.captureCharFrame()
  expect(ejected).toContain(EJECTED_LINE)
  expect(ejected).not.toContain("Eject failed")
  view.handle.dispose()
  view.renderer.destroy()
})
