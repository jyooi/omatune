import { expect, test } from "bun:test"
import {
  artworkFiles,
  artworkFormatRows,
  imageItems,
  ledgerPath,
  mhiiDbid,
  parseArtworkdb,
  readItunesdbTracks,
  thumbnailsOf,
} from "@omatune/core"
import { fakeLayer, writeFakeDevice } from "@omatune/platform"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runMain } from "./main.ts"

const SERIAL = "aaaaaaaaaaaaaaaa"
const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")

function testEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OMATUNE_CONFIG
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
  const musicRoot = join(volume(fake), "iPod_Control", "Music")
  const beforeDb = await stat(dbPath)
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
  const afterMusic = await Promise.all(musicFiles.map((file) => stat(file)))
  for (let i = 0; i < beforeMusic.length; i += 1) {
    expect(afterMusic[i]?.mtimeMs).toBe(beforeMusic[i]?.mtimeMs)
    expect(afterMusic[i]?.size).toBe(beforeMusic[i]?.size)
  }
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

test("Foreign Device is refused", async () => {
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
  const result = await sync(dir, fake, ["--yes", "--no-eject"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("foreign")
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
