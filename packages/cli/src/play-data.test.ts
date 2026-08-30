import { expect, test } from "bun:test"
import { encodePlayCounts, ledgerPath, playDataPath, readItunesdbTracks } from "@omatune/core"
import { fakeLayer, writeFakeDevice } from "@omatune/platform"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runMain } from "./main.ts"

const SERIAL_A = "aaaaaaaaaaaaaaaa"
const SERIAL_B = "bbbbbbbbbbbbbbbb"
const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")
const TRACK = "tone-suite/01-pregap.mp3"

function testEnv(dataHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OMATUNE_CONFIG
  env.XDG_DATA_HOME = dataHome
  return env
}

async function makeDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function writeConfig(dir: string): Promise<void> {
  await writeFile(
    join(dir, "config.toml"),
    `version = 1
library = ${JSON.stringify(LIBRARY)}

[devices.${SERIAL_A}]
name = "A"

[devices.${SERIAL_B}]
name = "B"
`,
  )
}

async function writeSelection(dir: string, serial: string): Promise<void> {
  await mkdir(join(dir, "devices", serial), { recursive: true })
  await writeFile(
    join(dir, "devices", serial, "selection.toml"),
    `version = 1

[[include]]
path = ${JSON.stringify(TRACK)}
`,
  )
}

function volume(fake: string, serial: string): string {
  return join(fake, serial, "volume")
}

async function emptyClassic(fake: string, serial: string): Promise<void> {
  await writeFakeDevice(fake, {
    serial,
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "empty",
  })
}

async function writePlayCounts(
  fake: string,
  serial: string,
  entries: Parameters<typeof encodePlayCounts>[0],
) {
  const dir = join(volume(fake, serial), "iPod_Control", "iTunes")
  await mkdir(dir, { recursive: true })
  await Bun.write(join(dir, "Play Counts"), encodePlayCounts(entries))
}

async function sync(
  configDir: string,
  fakeRoot: string,
  dataHome: string,
  serial: string,
  extra: string[] = [],
) {
  return runMain(
    ["sync", "--device", serial, "--config", configDir, "--yes", "--no-eject", ...extra],
    fakeLayer(fakeRoot),
    testEnv(dataHome),
  )
}

test("Play Counts round-trip across two Devices and merge counts", async () => {
  const dir = await makeDir("omatune-play-two-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await writeSelection(dir, SERIAL_B)
  await emptyClassic(fake, SERIAL_A)
  await emptyClassic(fake, SERIAL_B)
  const libraryStat = await stat(join(LIBRARY, TRACK))

  const firstA = await sync(dir, fake, dataHome, SERIAL_A)
  expect(firstA.code).toBe(0)
  await writePlayCounts(fake, SERIAL_A, [
    {
      playCount: 2,
      skipCount: 1,
      rating: 80,
      lastPlayed: 100,
      lastSkipped: 90,
      bookmark: 7,
    },
  ])
  const secondA = await sync(dir, fake, dataHome, SERIAL_A)
  expect(secondA.code).toBe(0)

  const host = JSON.parse(await Bun.file(playDataPath(join(dataHome, "omatune"))).text()) as {
    tracks: Record<
      string,
      {
        playCount: number
        skipCount: number
        rating: number
        lastPlayed: number
        lastSkipped: number
        bookmark: number
        path: string
      }
    >
  }
  const entries = Object.values(host.tracks)
  expect(entries).toHaveLength(1)
  expect(entries[0]?.playCount).toBe(2)
  expect(entries[0]?.skipCount).toBe(1)
  expect(entries[0]?.rating).toBe(80)
  expect(entries[0]?.lastPlayed).toBe(100)
  expect(entries[0]?.lastSkipped).toBe(90)
  expect(entries[0]?.bookmark).toBe(7)
  expect(entries[0]?.path).toBe(TRACK)

  const firstB = await sync(dir, fake, dataHome, SERIAL_B)
  expect(firstB.code).toBe(0)
  const bTracks = readItunesdbTracks(
    new Uint8Array(
      await Bun.file(join(volume(fake, SERIAL_B), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
    ),
  )
  expect(bTracks[0]?.playData).toEqual({
    playCount: 2,
    skipCount: 1,
    rating: 80,
    lastPlayed: 100,
    lastSkipped: 90,
    bookmark: 7,
  })

  await writePlayCounts(fake, SERIAL_B, [
    {
      playCount: 3,
      skipCount: 1,
      rating: 80,
      lastPlayed: 200,
      lastSkipped: 250,
      bookmark: 7,
    },
  ])
  const secondB = await sync(dir, fake, dataHome, SERIAL_B)
  expect(secondB.code).toBe(0)
  const merged = JSON.parse(await Bun.file(playDataPath(join(dataHome, "omatune"))).text()) as {
    tracks: Record<string, { playCount: number; skipCount: number; lastPlayed: number; lastSkipped: number }>
  }
  const after = Object.values(merged.tracks)[0]
  expect(after?.playCount).toBe(5)
  expect(after?.skipCount).toBe(2)
  expect(after?.lastPlayed).toBe(200)
  expect(after?.lastSkipped).toBe(250)
  const afterB = readItunesdbTracks(
    new Uint8Array(
      await Bun.file(join(volume(fake, SERIAL_B), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
    ),
  )
  expect(afterB[0]?.playData.playCount).toBe(5)
  const libraryAfter = await stat(join(LIBRARY, TRACK))
  expect(libraryAfter.mtimeMs).toBe(libraryStat.mtimeMs)
  expect(libraryAfter.size).toBe(libraryStat.size)
})

test("second Device writes host Play Data on a no-change Sync", async () => {
  const dir = await makeDir("omatune-play-second-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await writeSelection(dir, SERIAL_B)
  await emptyClassic(fake, SERIAL_A)
  await emptyClassic(fake, SERIAL_B)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  await writePlayCounts(fake, SERIAL_A, [
    { playCount: 2, skipCount: 1, rating: 80, lastPlayed: 100, lastSkipped: 90, bookmark: 7 },
  ])
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  expect((await sync(dir, fake, dataHome, SERIAL_B)).code).toBe(0)
  await writePlayCounts(fake, SERIAL_A, [
    { playCount: 3, skipCount: 0, rating: 80, lastPlayed: 100, lastSkipped: 90, bookmark: 7 },
  ])
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  const secondB = await sync(dir, fake, dataHome, SERIAL_B)
  expect(secondB.code).toBe(0)
  const bTracks = readItunesdbTracks(
    new Uint8Array(
      await Bun.file(join(volume(fake, SERIAL_B), "iPod_Control", "iTunes", "iTunesDB")).arrayBuffer(),
    ),
  )
  expect(bTracks[0]?.playData).toEqual({
    playCount: 5,
    skipCount: 1,
    rating: 80,
    lastPlayed: 100,
    lastSkipped: 90,
    bookmark: 7,
  })
})

test("same Play Counts bytes do not merge twice", async () => {
  const dir = await makeDir("omatune-play-retry-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await emptyClassic(fake, SERIAL_A)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  const entries = [
    { playCount: 2, skipCount: 1, rating: 80, lastPlayed: 100, lastSkipped: 90, bookmark: 7 },
  ]
  const bytes = encodePlayCounts(entries)
  const playCounts = join(volume(fake, SERIAL_A), "iPod_Control", "iTunes", "Play Counts")
  await Bun.write(playCounts, bytes)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  await Bun.write(playCounts, bytes)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  const host = JSON.parse(await Bun.file(playDataPath(join(dataHome, "omatune"))).text()) as {
    tracks: Record<string, { playCount: number; skipCount: number }>
  }
  const entry = Object.values(host.tracks)[0]
  expect(entry?.playCount).toBe(2)
  expect(entry?.skipCount).toBe(1)
})

test("Echo keeps rating, last played, and bookmark written by the last Sync", async () => {
  const dir = await makeDir("omatune-play-echo-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await emptyClassic(fake, SERIAL_A)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  await writePlayCounts(fake, SERIAL_A, [
    { playCount: 1, rating: 80, lastPlayed: 100, bookmark: 4 },
  ])
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  await writePlayCounts(fake, SERIAL_A, [
    { playCount: 0, rating: 80, lastPlayed: 100, bookmark: 4, skipCount: 1, lastSkipped: 8 },
  ])
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  const host = JSON.parse(await Bun.file(playDataPath(join(dataHome, "omatune"))).text()) as {
    tracks: Record<string, { playCount: number; rating: number; lastPlayed: number; bookmark: number; skipCount: number }>
  }
  const entry = Object.values(host.tracks)[0]
  expect(entry?.playCount).toBe(1)
  expect(entry?.rating).toBe(80)
  expect(entry?.lastPlayed).toBe(100)
  expect(entry?.bookmark).toBe(4)
  expect(entry?.skipCount).toBe(1)
  const ledger = JSON.parse(await Bun.file(ledgerPath(dir, SERIAL_A)).text()) as {
    tracks: Array<{ writtenRating: number; lastPlayed: number; bookmark: number }>
  }
  expect(ledger.tracks[0]?.writtenRating).toBe(80)
  expect(ledger.tracks[0]?.lastPlayed).toBe(100)
  expect(ledger.tracks[0]?.bookmark).toBe(4)
})

test("corrupt Play Counts is copied and Sync continues unless --strict", async () => {
  const dir = await makeDir("omatune-play-corrupt-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await emptyClassic(fake, SERIAL_A)
  expect((await sync(dir, fake, dataHome, SERIAL_A)).code).toBe(0)
  const playCounts = join(volume(fake, SERIAL_A), "iPod_Control", "iTunes", "Play Counts")
  await writeFile(playCounts, "not-mhdp")
  const result = await sync(dir, fake, dataHome, SERIAL_A)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("Play Counts is corrupt")
  const failedDir = join(dataHome, "omatune", "read-back-failed")
  const copies: string[] = []
  for await (const file of new Bun.Glob("*.bin").scan({ cwd: failedDir, onlyFiles: true })) {
    copies.push(file)
  }
  expect(copies).toHaveLength(1)
  expect(copies[0]?.startsWith(`${SERIAL_A}-`)).toBe(true)
  expect(await Bun.file(join(failedDir, copies[0] ?? "")).text()).toBe("not-mhdp")
  await writeFile(playCounts, "not-mhdp")
  const strict = await sync(dir, fake, dataHome, SERIAL_A, ["--strict"])
  expect(strict.code).toBe(1)
  expect(strict.stderr).toContain("Play Counts is corrupt")
})

test("absent Play Counts is silent", async () => {
  const dir = await makeDir("omatune-play-absent-")
  const fake = await makeDir("omatune-play-fake-")
  const dataHome = await makeDir("omatune-play-data-")
  await writeConfig(dir)
  await writeSelection(dir, SERIAL_A)
  await emptyClassic(fake, SERIAL_A)
  const result = await sync(dir, fake, dataHome, SERIAL_A, ["--json"])
  expect(result.code).toBe(0)
  expect(result.stdout).not.toContain("Play Counts")
  expect(result.stderr).toBe("")
})
