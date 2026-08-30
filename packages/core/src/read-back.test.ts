import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serializePlayCounts, type PlayCountsEntry } from "@omatune/device-database"
import { ITUNESDB, PLAY_COUNTS } from "./device-fs.ts"
import { emptyPlayData, hashPlayCountsBytes } from "./play-data.ts"
import { countPlayCountsEntries, FOREIGN_READ_BACK_SKIP, runPlayDataReadBack } from "./read-back.ts"

function entry(fields: Partial<PlayCountsEntry>): PlayCountsEntry {
  return {
    playCount: 0,
    lastPlayed: 0,
    bookmark: 0,
    rating: 0,
    unknown: 0,
    skipCount: 0,
    lastSkipped: 0,
    tail: new Uint8Array(0),
    ...fields,
  }
}

function playCountsBytes(entries: PlayCountsEntry[]): Uint8Array {
  return serializePlayCounts({
    headerLength: 0x60,
    entryLength: 0x1c,
    headerTail: new Uint8Array(0x60 - 16),
    entries,
  })
}

async function makeMount(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omatune-read-back-"))
  await mkdir(join(root, "iPod_Control", "iTunes"), { recursive: true })
  return root
}

test("countPlayCountsEntries reads the S2 serialiser output", async () => {
  const mount = await makeMount()
  await Bun.write(join(mount, PLAY_COUNTS), playCountsBytes([entry({ playCount: 1 }), entry({ playCount: 2 })]))
  expect(await countPlayCountsEntries(mount)).toBe(2)
})

test("absent Play Counts counts as zero", async () => {
  const mount = await makeMount()
  expect(await countPlayCountsEntries(mount)).toBe(0)
})

test("Foreign Device skips Read-back with one message", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  const result = await runPlayDataReadBack(
    {
      kind: "wipe",
      serial: "aaaaaaaaaaaaaaaa",
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: false,
      now: 1,
    },
    emptyPlayData(),
  )
  expect(result.consumedPlayCounts).toBe(false)
  expect(result.messages).toEqual([{ text: FOREIGN_READ_BACK_SKIP, level: "info" }])
})

test("corrupt Play Counts is copied and warned", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  await writeFile(join(mount, PLAY_COUNTS), "not-mhdp")
  const result = await runPlayDataReadBack(
    {
      kind: "normal",
      serial: "aaaaaaaaaaaaaaaa",
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: false,
      now: 99,
    },
    emptyPlayData(),
  )
  expect(result.consumedPlayCounts).toBe(false)
  expect(result.strictFail).toBeNull()
  expect(result.messages[0]?.level).toBe("warning")
  const copy = join(dataDir, "read-back-failed", "aaaaaaaaaaaaaaaa-99.bin")
  expect(await Bun.file(copy).text()).toBe("not-mhdp")
})

test("same Play Counts digest skips merge", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  const bytes = playCountsBytes([entry({ playCount: 4 })])
  await Bun.write(join(mount, PLAY_COUNTS), bytes)
  const serial = "aaaaaaaaaaaaaaaa"
  const result = await runPlayDataReadBack(
    {
      kind: "normal",
      serial,
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: false,
      now: 1,
    },
    { version: 1, tracks: {}, mergedPlayCounts: { [serial]: hashPlayCountsBytes(bytes) } },
  )
  expect(result.consumedPlayCounts).toBe(true)
  expect(result.changed).toBe(false)
  expect(result.playData.tracks).toEqual({})
})

test("absent iTunesDB does not consume Play Counts", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  await Bun.write(join(mount, PLAY_COUNTS), playCountsBytes([entry({ playCount: 1 })]))
  const result = await runPlayDataReadBack(
    {
      kind: "normal",
      serial: "aaaaaaaaaaaaaaaa",
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: false,
      now: 1,
    },
    emptyPlayData(),
  )
  expect(result.consumedPlayCounts).toBe(false)
  expect(result.changed).toBe(false)
})

test("unreadable iTunesDB does not consume Play Counts", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  await Bun.write(join(mount, PLAY_COUNTS), playCountsBytes([entry({ playCount: 1 })]))
  await writeFile(join(mount, ITUNESDB), "not-mhbd")
  const result = await runPlayDataReadBack(
    {
      kind: "normal",
      serial: "aaaaaaaaaaaaaaaa",
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: false,
      now: 1,
    },
    emptyPlayData(),
  )
  expect(result.consumedPlayCounts).toBe(false)
  expect(result.changed).toBe(false)
})

test("corrupt Play Counts in --strict sets strictFail", async () => {
  const mount = await makeMount()
  const dataDir = await mkdtemp(join(tmpdir(), "omatune-data-"))
  await writeFile(join(mount, PLAY_COUNTS), "not-mhdp")
  const result = await runPlayDataReadBack(
    {
      kind: "normal",
      serial: "aaaaaaaaaaaaaaaa",
      mountPoint: mount,
      dataDir,
      ledger: null,
      hashes: new Map(),
      selected: [],
      strict: true,
      now: 7,
    },
    emptyPlayData(),
  )
  expect(result.strictFail).toContain("Play Counts is corrupt")
})
