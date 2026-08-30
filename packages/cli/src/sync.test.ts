import { expect, test } from "bun:test"
import {
  artworkFiles,
  artworkFormatRows,
  devicePathFor,
  imageItems,
  itunesdbReserveBytes,
  ledgerPath,
  mhiiDbid,
  parseArtworkdb,
  readItunesdbTracks,
  sha256File,
  thumbnailsOf,
  wipeIpodControl,
} from "@omatune/core"
import { fakeLayer, writeFakeDevice } from "@omatune/platform"
import { existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runMain } from "./main.ts"

const SERIAL = "aaaaaaaaaaaaaaaa"
const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")

function testEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OMATUNE_CONFIG
  env.XDG_DATA_HOME = join(tmpdir(), "omatune-sync-data")
  return env
}

async function makeDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function writeConfig(dir: string, library: string): Promise<void> {
  await writeFile(
    join(dir, "config.toml"),
    `version = 1
library = ${JSON.stringify(library)}

[devices.${SERIAL}]
name = "Classic"
`,
  )
}

async function writeSelection(dir: string, body: string): Promise<void> {
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(join(dir, "devices", SERIAL, "selection.toml"), body)
}

function volume(fake: string): string {
  return join(fake, SERIAL, "volume")
}

async function emptyClassic(fake: string, freeBytes = 10 * 1024 * 1024 * 1024): Promise<void> {
  await writeFakeDevice(fake, {
    serial: SERIAL,
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes,
    owner: "empty",
  })
}

async function sync(
  configDir: string,
  fakeRoot: string,
  extra: string[] = [],
  io?: { stdin?: string },
) {
  return runMain(
    ["sync", "--device", SERIAL, "--config", configDir, ...extra],
    fakeLayer(fakeRoot),
    testEnv(),
    io,
  )
}

function jsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test("first Sync from empty writes Selection, Ledger, and a signed iTunesDB", async () => {
  const dir = await makeDir("omatune-sync-first-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await emptyClassic(fake)
  await mkdir(join(volume(fake), "iPod_Control", "Device"), { recursive: true })
  await writeFile(join(volume(fake), "iPod_Control", "Device", "SysInfo"), "keep-sys")
  await writeFile(join(volume(fake), "Notes.txt"), "keep-notes")
  const result = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const events = jsonLines(result.stdout)
  expect(events[0]?.type).toBe("plan")
  expect(events[events.length - 1]?.type).toBe("report")
  const phases = events.filter((event) => event.type === "progress").map((event) => event.phase)
  expect(phases).toContain("read-back")
  expect(phases).toContain("delete")
  expect(phases).toContain("copy")
  expect(phases).toContain("artwork")
  expect(phases).toContain("database")
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const bytes = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  const tracks = readItunesdbTracks(bytes)
  expect(tracks).toHaveLength(5)
  const titles = tracks.map((track) => track.title)
  expect(titles).toEqual(["Pregap", "Postgap", "Steady", "Fifth", "Uncovered"])
  expect(tracks.every((track) => track.playData.playCount === 0)).toBe(true)
  expect(tracks.every((track) => track.dbid !== 0n)).toBe(true)
  const ledgerText = await Bun.file(ledgerPath(dir, SERIAL)).text()
  const ledger = JSON.parse(ledgerText) as { tracks: Array<{ libraryPath: string; dbid: string }> }
  expect(ledger.tracks).toHaveLength(5)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.json")).exists()).toBe(true)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.syncing")).exists()).toBe(false)
  expect(await Bun.file(join(volume(fake), "Notes.txt")).text()).toBe("keep-notes")
  expect(await Bun.file(join(volume(fake), "iPod_Control", "Device", "SysInfo")).text()).toBe("keep-sys")
  for (const track of tracks) {
    const rel = track.devicePath.replaceAll(":", "/").replace(/^\//, "")
    expect(await Bun.file(join(volume(fake), rel)).exists()).toBe(true)
  }
})

test("second Sync with no change touches nothing", async () => {
  const dir = await makeDir("omatune-sync-noop-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const artworkPath = join(volume(fake), "iPod_Control", "Artwork", "ArtworkDB")
  const musicRoot = join(volume(fake), "iPod_Control", "Music")
  const beforeDb = await stat(dbPath)
  const beforeArtwork = await stat(artworkPath)
  const musicFiles: string[] = []
  const walk = async (abs: string) => {
    const iter = new Bun.Glob("**/*").scan({ cwd: abs, onlyFiles: true })
    for await (const file of iter) {
      musicFiles.push(join(abs, file))
    }
  }
  await walk(musicRoot)
  const beforeMusic = await Promise.all(musicFiles.map((file) => stat(file)))
  const second = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(second.code).toBe(0)
  const afterDb = await stat(dbPath)
  expect(afterDb.mtimeMs).toBe(beforeDb.mtimeMs)
  expect(afterDb.size).toBe(beforeDb.size)
  const afterArtwork = await stat(artworkPath)
  expect(afterArtwork.mtimeMs).toBe(beforeArtwork.mtimeMs)
  expect(afterArtwork.size).toBe(beforeArtwork.size)
  const afterMusic = await Promise.all(musicFiles.map((file) => stat(file)))
  for (let i = 0; i < beforeMusic.length; i += 1) {
    expect(afterMusic[i]?.mtimeMs).toBe(beforeMusic[i]?.mtimeMs)
    expect(afterMusic[i]?.size).toBe(beforeMusic[i]?.size)
  }
})

test("second Sync restores a missing ArtworkDB", async () => {
  const dir = await makeDir("omatune-sync-art-repair-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  const artworkPath = join(volume(fake), "iPod_Control", "Artwork", "ArtworkDB")
  await Bun.file(artworkPath).unlink()
  const second = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(second.code).toBe(0)
  const bytes = new Uint8Array(await Bun.file(artworkPath).arrayBuffer())
  const items = imageItems(parseArtworkdb(bytes))
  expect(items).toHaveLength(4)
})

test("second Sync deletes Music files that no Ledger entry names", async () => {
  const dir = await makeDir("omatune-sync-orphan-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  const orphan = join(volume(fake), "iPod_Control", "Music", "F00", "orphan.mp3")
  await mkdir(join(volume(fake), "iPod_Control", "Music", "F00"), { recursive: true })
  await writeFile(orphan, "not-in-ledger")
  const second = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(second.code).toBe(0)
  expect(await Bun.file(orphan).exists()).toBe(false)
})

test("add and remove one Album, then iTunesDB lists the new Tracks in order", async () => {
  const dir = await makeDir("omatune-sync-album-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "dual-disc"
`,
  )
  const second = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(second.code).toBe(0)
  const bytes = new Uint8Array(
    await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
  )
  const tracks = readItunesdbTracks(bytes)
  expect(tracks.map((track) => track.title)).toEqual(["Left", "Right", "Low", "High"])
  const ledger = JSON.parse(await Bun.file(ledgerPath(dir, SERIAL)).text()) as {
    tracks: Array<{ libraryPath: string }>
  }
  expect(ledger.tracks.map((track) => track.libraryPath)).toEqual([
    "dual-disc/d1-01-left.m4a",
    "dual-disc/d1-02-right.m4a",
    "dual-disc/d2-01-low.m4a",
    "dual-disc/d2-02-high.m4a",
  ])
  const music = join(volume(fake), "iPod_Control", "Music")
  const leftover: string[] = []
  for await (const file of new Bun.Glob("**/*").scan({ cwd: music, onlyFiles: true })) {
    leftover.push(file)
  }
  expect(leftover).toHaveLength(4)
})

test("unmount prints Safe to unplug, and --no-eject leaves the Device mounted", async () => {
  const dir = await makeDir("omatune-sync-eject-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const ejected = await sync(dir, fake, ["--yes"])
  expect(ejected.code).toBe(0)
  expect(ejected.stdout).toContain("Safe to unplug")
  const meta = (await Bun.file(join(fake, SERIAL, "device.json")).json()) as { mounted: boolean }
  expect(meta.mounted).toBe(false)

  const dir2 = await makeDir("omatune-sync-noeject-")
  const fake2 = await makeDir("omatune-sync-fake-")
  await writeConfig(dir2, LIBRARY)
  await writeSelection(
    dir2,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake2)
  const kept = await sync(dir2, fake2, ["--yes", "--no-eject"])
  expect(kept.code).toBe(0)
  expect(kept.stdout).not.toContain("Safe to unplug")
  const meta2 = (await Bun.file(join(fake2, SERIAL, "device.json")).json()) as { mounted: boolean }
  expect(meta2.mounted).toBe(true)
})

test("confirm n leaves the Device unchanged", async () => {
  const dir = await makeDir("omatune-sync-no-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const prompts: string[] = []
  const result = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--no-eject"],
    fakeLayer(fake),
    testEnv(),
    {
      stdin: "n\n",
      stderrWrite: (text) => {
        prompts.push(text)
      },
    },
  )
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Sync cancelled")
  expect(prompts.some((text) => text.includes("Sync now? [y/N]"))).toBe(true)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).exists()).toBe(
    false,
  )
})

test("Foreign Device wipe needs the typed word wipe", async () => {
  const dir = await makeDir("omatune-sync-foreign-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await writeFakeDevice(fake, {
    serial: SERIAL,
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "foreign",
  })
  const old = join(volume(fake), "iPod_Control", "Music", "F00", "old.mp3")
  await mkdir(join(volume(fake), "iPod_Control", "Music", "F00"), { recursive: true })
  await writeFile(old, "itunes-music")
  const skipped = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--yes", "--no-eject"],
    fakeLayer(fake),
    testEnv(),
    { stderrWrite: () => {} },
  )
  expect(skipped.code).toBe(1)
  expect(skipped.stderr).toContain("Sync cancelled")
  expect(await Bun.file(old).exists()).toBe(true)
  const prompts: string[] = []
  const typedY = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--yes", "--no-eject", "--json"],
    fakeLayer(fake),
    testEnv(),
    {
      stdin: "y\n",
      stderrWrite: (text) => {
        prompts.push(text)
      },
    },
  )
  expect(typedY.code).toBe(1)
  expect(prompts.some((text) => text.includes("Wipe and Sync?"))).toBe(true)
  const wiped = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--yes", "--no-eject", "--json"],
    fakeLayer(fake),
    testEnv(),
    { stdin: "wipe\n", stderrWrite: () => {} },
  )
  expect(wiped.code).toBe(0)
  const events = jsonLines(wiped.stdout)
  expect(events[0]?.type).toBe("plan")
  expect((events[0] as { plan: { kind: string } }).plan.kind).toBe("wipe")
  expect(await Bun.file(old).exists()).toBe(false)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).exists()).toBe(
    true,
  )
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.json")).exists()).toBe(true)
})

test("--strict refuses on a Skipped Track", async () => {
  const dir = await makeDir("omatune-sync-strict-")
  const fake = await makeDir("omatune-sync-fake-")
  const library = join(dir, "library")
  await mkdir(library)
  await Bun.write(join(library, "bad.wav"), "RIFF")
  await writeConfig(dir, library)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "*"
`,
  )
  await emptyClassic(fake)
  const result = await sync(dir, fake, ["--yes", "--strict", "--no-eject"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Skipped")
})

test("Sync of the Verification Library writes ArtworkDB the S2 parser reads", async () => {
  const dir = await makeDir("omatune-sync-art-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"

[[include]]
path = "field-recordings"

[[include]]
path = "dual-disc"
`,
  )
  await emptyClassic(fake)
  const result = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(result.code).toBe(0)
  const dbPath = join(volume(fake), "iPod_Control", "Artwork", "ArtworkDB")
  const bytes = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  const db = parseArtworkdb(bytes)
  const items = imageItems(db)
  expect(items).toHaveLength(11)
  const family = "iPod classic 120 GB (2008)"
  const rows = artworkFormatRows[family] ?? []
  expect(rows.map((row) => row.id)).toEqual([1055, 1060, 1061])
  expect(artworkFiles(db).map((file) => file.formatId)).toEqual([1055, 1060, 1061])
  for (const row of rows) {
    const ithmbPath = join(volume(fake), "iPod_Control", "Artwork", `F${row.id}_1.ithmb`)
    const ithmb = new Uint8Array(await Bun.file(ithmbPath).arrayBuffer())
    expect(ithmb.byteLength).toBe(row.blockBytes * 3)
  }
  const itunes = readItunesdbTracks(
    new Uint8Array(
      await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
    ),
  )
  expect(itunes).toHaveLength(12)
  const uncovered = itunes.find((track) => track.title === "Uncovered")
  expect(uncovered).toBeDefined()
  expect(uncovered?.hasArtwork).toBe(false)
  const uncoveredDbid = uncovered?.dbid ?? 0n
  expect(items.some((item) => mhiiDbid(item) === uncoveredDbid)).toBe(false)
  const withArt = itunes.filter((track) => track.title !== "Uncovered")
  expect(withArt.every((track) => track.hasArtwork)).toBe(true)
  for (const track of withArt) {
    const item = items.find((entry) => mhiiDbid(entry) === track.dbid)
    expect(item).toBeDefined()
    if (!item) {
      continue
    }
    const thumbs = thumbnailsOf(item)
    expect(thumbs.map((thumb) => thumb.formatId)).toEqual([1055, 1060, 1061])
    for (const thumb of thumbs) {
      const row = rows.find((entry) => entry.id === thumb.formatId)
      expect(thumb.size).toBe(row?.blockBytes)
      expect(thumb.width).toBe(row?.width)
      expect(thumb.height).toBe(row?.height)
    }
  }
  const ledger = JSON.parse(await Bun.file(ledgerPath(dir, SERIAL)).text()) as {
    tracks: Array<{ libraryPath: string; artworkHash: string | null }>
  }
  const uncoveredLedger = ledger.tracks.find((track) => track.libraryPath.includes("uncovered"))
  expect(uncoveredLedger?.artworkHash).toBeNull()
  expect(ledger.tracks.filter((track) => track.artworkHash !== null)).toHaveLength(11)
})

test("a mini Device writes no Artwork", async () => {
  const dir = await makeDir("omatune-sync-mini-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await writeFakeDevice(fake, {
    serial: SERIAL,
    modelString: "M9160",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "empty",
  })
  const result = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(result.code).toBe(0)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "Artwork", "ArtworkDB")).exists()).toBe(
    false,
  )
  const itunes = readItunesdbTracks(
    new Uint8Array(
      await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
    ),
  )
  expect(itunes.every((track) => track.hasArtwork === false)).toBe(true)
})

test("sync --json prints the plan before Device files exist", async () => {
  const dir = await makeDir("omatune-sync-live-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await emptyClassic(fake)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const seen: Array<{ type: unknown; itunesdb: boolean }> = []
  const result = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--yes", "--no-eject", "--json"],
    fakeLayer(fake),
    testEnv(),
    {
      stdoutWrite: (text) => {
        const event = JSON.parse(text) as { type: unknown }
        seen.push({ type: event.type, itunesdb: existsSync(dbPath) })
      },
    },
  )
  expect(result.code).toBe(0)
  expect(seen[0]?.type).toBe("plan")
  expect(seen[0]?.itunesdb).toBe(false)
  expect(seen.some((event) => event.type === "progress")).toBe(true)
  expect(seen[seen.length - 1]?.type).toBe("report")
  expect(await Bun.file(dbPath).exists()).toBe(true)
})

const GAPLESS_PAIR = {
  pregap: 576,
  sampleCount: 88200n,
  postgap: 1080,
  gaplessData: 0,
  gaplessTrackFlag: 1,
  gaplessAlbumFlag: 1,
}

const GAPLESS_ABSENT = {
  pregap: 0,
  sampleCount: 0n,
  postgap: 0,
  gaplessData: 0,
  gaplessTrackFlag: 0,
  gaplessAlbumFlag: 0,
}

const GAPLESS_SELECTION = `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"

[[include]]
path = "tone-suite/02-postgap.mp3"

[[include]]
path = "field-recordings/01-alpha.m4a"
`

test("gapless pair round-trips pregap, postgap, sample count, and flags", async () => {
  const dir = await makeDir("omatune-sync-gapless-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(dir, GAPLESS_SELECTION)
  await emptyClassic(fake)
  const result = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(result.code).toBe(0)
  const bytes = new Uint8Array(
    await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
  )
  const tracks = readItunesdbTracks(bytes)
  const byTitle = new Map(tracks.map((track) => [track.title, track]))
  expect(byTitle.get("Pregap")?.gapless).toEqual(GAPLESS_PAIR)
  expect(byTitle.get("Postgap")?.gapless).toEqual(GAPLESS_PAIR)
  expect(byTitle.get("Alpha")?.gapless).toEqual(GAPLESS_ABSENT)
})

test("mini family writes gapless fields the firmware may ignore", async () => {
  const dir = await makeDir("omatune-sync-gapless-mini-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(dir, GAPLESS_SELECTION)
  await writeFakeDevice(fake, {
    serial: SERIAL,
    modelString: "M9160",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "empty",
  })
  const result = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(result.code).toBe(0)
  const bytes = new Uint8Array(
    await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
  )
  const tracks = readItunesdbTracks(bytes)
  const byTitle = new Map(tracks.map((track) => [track.title, track]))
  expect(byTitle.get("Pregap")?.gapless).toEqual(GAPLESS_PAIR)
  expect(byTitle.get("Postgap")?.gapless).toEqual(GAPLESS_PAIR)
  expect(byTitle.get("Alpha")?.gapless).toEqual(GAPLESS_ABSENT)
})

test("Adoption rebuilds the Ledger from content-addressed names", async () => {
  const hostA = await makeDir("omatune-sync-adopt-a-")
  const hostB = await makeDir("omatune-sync-adopt-b-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(hostA, LIBRARY)
  await writeConfig(hostB, LIBRARY)
  const selection = `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`
  await writeSelection(hostA, selection)
  await writeSelection(hostB, selection)
  await emptyClassic(fake)
  const first = await sync(hostA, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  const ledgerA = JSON.parse(await Bun.file(ledgerPath(hostA, SERIAL)).text()) as {
    tracks: Array<{ libraryPath: string; dbid: string; devicePath: string }>
  }
  const musicPath = join(volume(fake), ledgerA.tracks[0]?.devicePath ?? "")
  const before = await stat(musicPath)
  const second = await sync(hostB, fake, ["--yes", "--no-eject", "--json"])
  expect(second.code).toBe(0)
  const events = jsonLines(second.stdout)
  expect((events[0] as { plan: { kind: string; add: unknown[]; keep: unknown[] } }).plan.kind).toBe(
    "adoption",
  )
  expect((events[0] as { plan: { add: unknown[] } }).plan.add).toHaveLength(0)
  expect((events[0] as { plan: { keep: unknown[] } }).plan.keep).toHaveLength(1)
  const after = await stat(musicPath)
  expect(after.mtimeMs).toBe(before.mtimeMs)
  const ledgerB = JSON.parse(await Bun.file(ledgerPath(hostB, SERIAL)).text()) as {
    tracks: Array<{ dbid: string }>
  }
  expect(ledgerB.tracks).toHaveLength(1)
  expect(ledgerB.tracks[0]?.dbid).not.toBe(ledgerA.tracks[0]?.dbid)
})

test("interrupted wipe resumes and commits a signed iTunesDB", async () => {
  const dir = await makeDir("omatune-sync-wipe-kill-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  await wipeIpodControl(volume(fake))
  await writeFile(
    join(volume(fake), "iPod_Control", "omatune.syncing"),
    `${JSON.stringify({ serial: SERIAL, startedAt: 1 })}\n`,
  )
  expect(await Bun.file(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")).exists()).toBe(
    false,
  )
  const resumed = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(resumed.code).toBe(0)
  const events = jsonLines(resumed.stdout)
  const plan = events[0] as { plan?: { add?: unknown[]; keep?: unknown[] } }
  expect(plan.plan?.add).toHaveLength(1)
  expect(plan.plan?.keep).toHaveLength(0)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const tracks = readItunesdbTracks(new Uint8Array(await Bun.file(dbPath).arrayBuffer()))
  expect(tracks).toHaveLength(1)
  expect(tracks[0]?.title).toBe("Pregap")
  const rel = tracks[0]?.devicePath.replaceAll(":", "/").replace(/^\//, "") ?? ""
  expect(await Bun.file(join(volume(fake), rel)).exists()).toBe(true)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.syncing")).exists()).toBe(false)
})

test("interrupted Sync resumes after a simulated kill between two copies", async () => {
  const dir = await makeDir("omatune-sync-resume-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const beforeDb = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"

[[include]]
path = "tone-suite/02-postgap.mp3"

[[include]]
path = "tone-suite/03-steady.mp3"
`,
  )
  const second = join(LIBRARY, "tone-suite/02-postgap.mp3")
  const digest = await sha256File(second)
  const devicePath = devicePathFor(digest, "mp3")
  await mkdir(join(volume(fake), dirname(devicePath)), { recursive: true })
  await copyFile(second, join(volume(fake), devicePath))
  await writeFile(
    join(volume(fake), "iPod_Control", "omatune.syncing"),
    `${JSON.stringify({ serial: SERIAL, startedAt: 1 })}\n`,
  )
  const afterKillDb = new Uint8Array(await Bun.file(dbPath).arrayBuffer())
  expect(Buffer.from(afterKillDb).equals(Buffer.from(beforeDb))).toBe(true)
  const copiedMtime = (await stat(join(volume(fake), devicePath))).mtimeMs
  const resumed = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(resumed.code).toBe(0)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.syncing")).exists()).toBe(false)
  expect((await stat(join(volume(fake), devicePath))).mtimeMs).toBe(copiedMtime)
  const tracks = readItunesdbTracks(new Uint8Array(await Bun.file(dbPath).arrayBuffer()))
  expect(tracks).toHaveLength(3)
})

test("disk full mid-copy commits iTunesDB for present Tracks", async () => {
  const dir = await makeDir("omatune-sync-full-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"

[[include]]
path = "tone-suite/02-postgap.mp3"

[[include]]
path = "tone-suite/03-steady.mp3"
`,
  )
  const first = (await stat(join(LIBRARY, "tone-suite/01-pregap.mp3"))).size
  const second = (await stat(join(LIBRARY, "tone-suite/02-postgap.mp3"))).size
  await emptyClassic(fake, first + itunesdbReserveBytes(3) + Math.min(200, second - 1))
  const result = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("Device is full.")
  const events = jsonLines(result.stdout)
  const report = events.find((event) => event.type === "report") as
    | { added?: number; skipped?: number }
    | undefined
  expect(report?.added).toBe(1)
  expect(report?.skipped).toBe(2)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const tracks = readItunesdbTracks(new Uint8Array(await Bun.file(dbPath).arrayBuffer()))
  expect(tracks).toHaveLength(1)
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.syncing")).exists()).toBe(false)
})

test("iTunesDB reserve skips the last add and still commits", async () => {
  const dir = await makeDir("omatune-sync-reserve-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"

[[include]]
path = "tone-suite/02-postgap.mp3"
`,
  )
  const first = (await stat(join(LIBRARY, "tone-suite/01-pregap.mp3"))).size
  const second = (await stat(join(LIBRARY, "tone-suite/02-postgap.mp3"))).size
  await emptyClassic(fake, first + second)
  const result = await sync(dir, fake, ["--yes", "--no-eject", "--json"])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("Device is full.")
  const events = jsonLines(result.stdout)
  const report = events.find((event) => event.type === "report") as
    | { added?: number; skipped?: number }
    | undefined
  expect(report?.added).toBe(1)
  expect(report?.skipped).toBe(1)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const tracks = readItunesdbTracks(new Uint8Array(await Bun.file(dbPath).arrayBuffer()))
  expect(tracks).toHaveLength(1)
  expect(tracks[0]?.title).toBe("Pregap")
  expect(await Bun.file(join(volume(fake), "iPod_Control", "omatune.syncing")).exists()).toBe(false)
})

test("Foreign Device with a host Ledger recopies Selection as adds", async () => {
  const dir = await makeDir("omatune-sync-wipe-ledger-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const first = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(first.code).toBe(0)
  await writeFile(join(volume(fake), "iPod_Control", "iTunes", "iTunesDB"), "itunes\n")
  await unlink(join(volume(fake), "iPod_Control", "omatune.json"))
  const old = join(volume(fake), "iPod_Control", "Music", "F00", "old.mp3")
  await mkdir(join(volume(fake), "iPod_Control", "Music", "F00"), { recursive: true })
  await writeFile(old, "itunes-music")
  const wiped = await runMain(
    ["sync", "--device", SERIAL, "--config", dir, "--yes", "--no-eject", "--json"],
    fakeLayer(fake),
    testEnv(),
    { stdin: "wipe\n", stderrWrite: () => {} },
  )
  expect(wiped.code).toBe(0)
  const events = jsonLines(wiped.stdout)
  const plan = events[0] as { type?: string; plan?: { kind?: string; add?: unknown[]; keep?: unknown[] } }
  expect(plan.type).toBe("plan")
  expect(plan.plan?.kind).toBe("wipe")
  expect(plan.plan?.add).toHaveLength(1)
  expect(plan.plan?.keep).toHaveLength(0)
  expect(await Bun.file(old).exists()).toBe(false)
  const dbPath = join(volume(fake), "iPod_Control", "iTunes", "iTunesDB")
  const tracks = readItunesdbTracks(new Uint8Array(await Bun.file(dbPath).arrayBuffer()))
  expect(tracks).toHaveLength(1)
  expect(tracks[0]?.title).toBe("Pregap")
  const rel = tracks[0]?.devicePath.replaceAll(":", "/").replace(/^\//, "") ?? ""
  expect(await Bun.file(join(volume(fake), rel)).exists()).toBe(true)
})

test("a held lock exits 1 and a dead pid is taken over", async () => {
  const dir = await makeDir("omatune-sync-lock-")
  const fake = await makeDir("omatune-sync-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await emptyClassic(fake)
  const lockPath = join(dir, "devices", SERIAL, "sync.lock")
  await writeFile(lockPath, `${process.pid}\n`)
  const held = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(held.code).toBe(1)
  expect(held.stderr).toContain("locked")
  const child = Bun.spawn(["sleep", "30"])
  const pid = child.pid
  child.kill()
  await child.exited
  await writeFile(lockPath, `${pid}\n`)
  const taken = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(taken.code).toBe(0)
  expect(await Bun.file(lockPath).exists()).toBe(false)
})
