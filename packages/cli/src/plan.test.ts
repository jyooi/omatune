import { expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { devicePathFor, encodePlayCounts, playDataPath, sha256File, type SyncPlan } from "@omatune/core"
import { fakeLayer, writeFakeDevice } from "@omatune/platform"
import { runMain } from "./main.ts"

const SERIAL = "aaaaaaaaaaaaaaaa"
const LIBRARY = join(import.meta.dir, "../../../fixtures/audio/library")

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OMATUNE_CONFIG
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
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

async function attach(root: string, spec: Parameters<typeof writeFakeDevice>[1]): Promise<void> {
  await writeFakeDevice(root, spec)
}

async function plan(
  configDir: string,
  fakeRoot: string,
  extra: string[] = [],
): Promise<{ code: number; stdout: string; stderr: string; json: SyncPlan | null }> {
  const result = await runMain(
    ["plan", "--device", SERIAL, "--config", configDir, "--json", ...extra],
    fakeLayer(fakeRoot),
    testEnv(),
  )
  let json: SyncPlan | null = null
  if (result.stdout.trim().length > 0) {
    try {
      json = JSON.parse(result.stdout) as SyncPlan
    } catch {
      json = null
    }
  }
  return { ...result, json }
}

async function classicDevice(fakeRoot: string, freeBytes = 10 * 1024 * 1024 * 1024) {
  await attach(fakeRoot, {
    serial: SERIAL,
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes,
    owner: "omatune",
  })
}

test("album_artist Rule selects Bjork Albums", async () => {
  const dir = await makeDir("omatune-plan-artist-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
album_artist = "BJÖRK"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  // Björk has five Tone Suite Tracks, four Dual Disc Tracks, and two
  // Lossless Suite Tracks, and the FLAC pair transcodes.
  expect(result.json?.add).toHaveLength(11)
  expect(result.json?.remove).toHaveLength(0)
  expect(result.json?.keep).toHaveLength(0)
  expect(result.json?.skipped).toHaveLength(0)
  expect(result.json?.transcodeCount).toBe(2)
  const transcoded = (result.json?.add ?? []).filter((track) => track.transcode)
  expect(transcoded.map((track) => track.path).sort()).toEqual([
    "lossless-suite/01-standard.flac",
    "lossless-suite/02-hires.flac",
  ])
  for (const track of transcoded) {
    expect(track.devicePath).toEndWith(".m4a")
    expect(track.estimated).toBe(true)
  }
})

test("album Rule selects Dual Disc across discs", async () => {
  const dir = await makeDir("omatune-plan-album-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
album_artist = "Björk"
album = "Dual Disc"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(4)
  const paths = (result.json?.add ?? []).map((track) => track.path)
  expect(paths.some((path) => path.includes("d1-"))).toBe(true)
  expect(paths.some((path) => path.includes("d2-"))).toBe(true)
})

test("path folder Rule selects all audio under it", async () => {
  const dir = await makeDir("omatune-plan-folder-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(5)
})

test("path file Rule selects one Track", async () => {
  const dir = await makeDir("omatune-plan-file-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(1)
  expect(result.json?.add[0]?.path).toBe("tone-suite/01-pregap.mp3")
})

test("path glob Rule selects mp3 Tracks", async () => {
  const dir = await makeDir("omatune-plan-glob-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "**/*.mp3"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(5)
})

test("exclude Rule subtracts from include", async () => {
  const dir = await makeDir("omatune-plan-exclude-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
album_artist = "Björk"

[[exclude]]
path = "tone-suite"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(6)
})

test("compilation Album groups under Various Artists", async () => {
  const dir = await makeDir("omatune-plan-va-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
album_artist = "Various Artists"
album = "Field Recordings"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add).toHaveLength(3)
})

test("empty Selection exits 1", async () => {
  const dir = await makeDir("omatune-plan-empty-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(dir, "version = 1\n")
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Selection is empty - tick Tracks with Space first.")
})

test("Selection that does not fit exits 1", async () => {
  const dir = await makeDir("omatune-plan-fit-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await classicDevice(fake, 1)
  const result = await plan(dir, fake)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("does not fit")
})

test("Unsupported family exits 2 with the support table link", async () => {
  const dir = await makeDir("omatune-plan-unsup-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await attach(fake, {
    serial: SERIAL,
    modelString: "MC027",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "omatune",
  })
  const result = await plan(dir, fake)
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("Unsupported")
  expect(result.stderr).toContain("docs/support-table.md")
})

test("unknown family exits 2 with the support table link", async () => {
  const dir = await makeDir("omatune-plan-unknown-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await attach(fake, {
    serial: SERIAL,
    modelString: "ZZ999",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "empty",
  })
  const result = await plan(dir, fake)
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("Unknown Device family")
  expect(result.stderr).toContain("docs/support-table.md")
})

test("--force-model overrides Unsupported family and the plan says so", async () => {
  const dir = await makeDir("omatune-plan-force-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await attach(fake, {
    serial: SERIAL,
    modelString: "MC027",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "omatune",
  })
  const result = await plan(dir, fake, ["--force-model", "CLASSIC_2"])
  expect(result.code).toBe(0)
  expect(result.json?.forceModel).toBe("CLASSIC_2")
  expect(result.json?.add).toHaveLength(1)
})

test("--json shape includes add, remove, keep, skipped, bytes, free space, and kind", async () => {
  const dir = await makeDir("omatune-plan-json-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  const body = result.json
  expect(body).not.toBeNull()
  if (!body) {
    return
  }
  expect(body.kind).toBe("adoption")
  expect(Array.isArray(body.add)).toBe(true)
  expect(Array.isArray(body.remove)).toBe(true)
  expect(Array.isArray(body.keep)).toBe(true)
  expect(Array.isArray(body.skipped)).toBe(true)
  expect(typeof body.bytesNeeded).toBe("number")
  expect(typeof body.freeSpaceAfter).toBe("number")
  expect(body.add[0]?.path).toBe("tone-suite/01-pregap.mp3")
  expect(typeof body.add[0]?.devicePath).toBe("string")
  expect(body.add[0]?.devicePath.startsWith("iPod_Control/Music/F")).toBe(true)
  const digest = await sha256File(join(LIBRARY, "tone-suite/01-pregap.mp3"))
  expect(body.add[0]?.devicePath).toBe(devicePathFor(digest, "mp3"))
  const info = await stat(join(LIBRARY, "tone-suite/01-pregap.mp3"))
  expect(body.add[0]?.size).toBe(info.size)
  expect(body.bytesNeeded).toBe(info.size)
})

test("Foreign Device plan kind is wipe", async () => {
  const dir = await makeDir("omatune-plan-wipe-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await attach(fake, {
    serial: SERIAL,
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "foreign",
  })
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.kind).toBe("wipe")
})

test("Ledger keep and remove against an existing Ledger", async () => {
  const dir = await makeDir("omatune-plan-ledger-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await classicDevice(fake)
  const keepPath = "tone-suite/01-pregap.mp3"
  const removePath = "tone-suite/gone.mp3"
  const keepInfo = await stat(join(LIBRARY, keepPath))
  const keepHash = await sha256File(join(LIBRARY, keepPath))
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "ledger.json"),
    `${JSON.stringify({
      version: 1,
      serial: SERIAL,
      libraryRoot: LIBRARY,
      lastCommitTime: 1,
      tracks: [
        {
          libraryPath: keepPath,
          size: keepInfo.size,
          mtime: keepInfo.mtimeMs,
          sha256: keepHash,
          devicePath: devicePathFor(keepHash, "mp3"),
          dbid: "1",
          artworkHash: null,
          writtenRating: null,
          lastPlayed: null,
          bookmark: null,
        },
        {
          libraryPath: removePath,
          size: 12,
          mtime: 1,
          sha256: "ab".repeat(32),
          devicePath: "iPod_Control/Music/F00/aaaaaaaaaaaaaaaa.mp3",
          dbid: "2",
          artworkHash: null,
          writtenRating: null,
          lastPlayed: null,
          bookmark: null,
        },
      ],
    })}\n`,
  )
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.kind).toBe("normal")
  expect(result.json?.keep.map((track) => track.path)).toEqual([keepPath])
  expect(result.json?.remove.map((track) => track.path)).toEqual([removePath])
  expect(result.json?.add).toHaveLength(4)
})

test("Malformed Ledger JSON names the cause and the fix", async () => {
  const dir = await makeDir("omatune-plan-ledger-malformed-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await classicDevice(fake)
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(join(dir, "devices", SERIAL, "ledger.json"), "{not json")
  const result = await plan(dir, fake)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("ledger.json:1:")
  expect(result.stderr).toContain("Malformed Ledger JSON. Delete the file and Sync again to rebuild it.")
})

test("Unsupported Ledger version names the cause and the fix", async () => {
  const dir = await makeDir("omatune-plan-ledger-version-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite"
`,
  )
  await classicDevice(fake)
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "ledger.json"),
    `${JSON.stringify({
      version: 2,
      serial: SERIAL,
      libraryRoot: LIBRARY,
      lastCommitTime: 1,
      tracks: [],
    })}\n`,
  )
  const result = await plan(dir, fake)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("ledger.json:1:")
  expect(result.stderr).toContain(
    "Unsupported Ledger version 2. Delete the file and Sync again to rebuild it.",
  )
})

test("plan does not change the Device", async () => {
  const dir = await makeDir("omatune-plan-nochg-")
  const fake = await makeDir("omatune-plan-fake-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await classicDevice(fake)
  const marker = join(fake, SERIAL, "volume", "iPod_Control", "iTunes", "Omatune")
  const db = join(fake, SERIAL, "volume", "iPod_Control", "iTunes", "iTunesDB")
  const beforeMarker = await Bun.file(marker).text()
  const beforeDb = await Bun.file(db).text()
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(await Bun.file(marker).text()).toBe(beforeMarker)
  expect(await Bun.file(db).text()).toBe(beforeDb)
})

test("Skipped reasons cover unstorable names", async () => {
  const dir = await makeDir("omatune-plan-skip-")
  const fake = await makeDir("omatune-plan-fake-")
  const library = join(dir, "library")
  await mkdir(library)
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "ok.mp3"))
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "bad:name.mp3"))
  await writeConfig(dir, library)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "*"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  const skipped = result.json?.skipped ?? []
  const byPath = new Map(skipped.map((row) => [row.path, row.reason]))
  expect(byPath.get("bad:name.mp3")).toBe("unstorable_name")
  expect(result.json?.add.map((track) => track.path)).toEqual(["ok.mp3"])
})

test("--strict exits 1 when any Track is Skipped", async () => {
  const dir = await makeDir("omatune-plan-strict-")
  const fake = await makeDir("omatune-plan-fake-")
  const library = join(dir, "library")
  await mkdir(library)
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "ok.mp3"))
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "bad:name.mp3"))
  await writeConfig(dir, library)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "*"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake, ["--strict"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Skipped")
  expect(result.json?.skipped.some((row) => row.reason === "unstorable_name")).toBe(true)
})

test("plan reports pending Play Counts entries without merging", async () => {
  const dir = await makeDir("omatune-plan-play-")
  const fake = await makeDir("omatune-plan-fake-")
  const dataHome = await makeDir("omatune-plan-data-")
  await writeConfig(dir, LIBRARY)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "tone-suite/01-pregap.mp3"
`,
  )
  await classicDevice(fake)
  await mkdir(join(fake, SERIAL, "volume", "iPod_Control", "iTunes"), { recursive: true })
  await Bun.write(
    join(fake, SERIAL, "volume", "iPod_Control", "iTunes", "Play Counts"),
    encodePlayCounts([
      { playCount: 1, lastPlayed: 1, rating: 80, skipCount: 1, lastSkipped: 1 },
      {},
    ]),
  )
  const result = await runMain(
    ["plan", "--device", SERIAL, "--config", dir, "--json"],
    fakeLayer(fake),
    testEnv({ XDG_DATA_HOME: dataHome }),
  )
  expect(result.code).toBe(0)
  const json = JSON.parse(result.stdout) as SyncPlan
  expect(json.playCountsPending).toBe(2)
  expect(await Bun.file(playDataPath(join(dataHome, "omatune"))).exists()).toBe(false)
})

function emptyM4a(): Uint8Array {
  const ftypBody = new TextEncoder().encode("M4A isom")
  const ftyp = new Uint8Array(8 + ftypBody.length)
  ftyp[3] = ftyp.length
  ftyp[4] = 0x66
  ftyp[5] = 0x74
  ftyp[6] = 0x79
  ftyp[7] = 0x70
  ftyp.set(ftypBody, 8)
  const moov = new Uint8Array(8)
  moov[3] = 8
  moov[4] = 0x6d
  moov[5] = 0x6f
  moov[6] = 0x6f
  moov[7] = 0x76
  const out = new Uint8Array(ftyp.length + moov.length)
  out.set(ftyp, 0)
  out.set(moov, ftyp.length)
  return out
}

test("plan JSON lists .alac and untagged m4a as Unlisted", async () => {
  const dir = await makeDir("omatune-plan-unlisted-")
  const fake = await makeDir("omatune-plan-fake-")
  const library = join(dir, "library")
  await mkdir(library)
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "ok.mp3"))
  await writeFile(join(library, "song.alac"), "alac-bytes")
  await Bun.write(join(library, "bare.m4a"), emptyM4a())
  await writeFile(join(library, "cover.jpg"), "jpeg")
  await writeConfig(dir, library)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "*"
`,
  )
  await classicDevice(fake)
  const result = await plan(dir, fake)
  expect(result.code).toBe(0)
  expect(result.json?.add.map((track) => track.path)).toEqual(["ok.mp3"])
  expect(result.json?.unlisted).toEqual([
    { relativePath: "bare.m4a", reason: "missing artist/album tags" },
    { relativePath: "song.alac", reason: "rename .alac to .m4a" },
  ])
})

test("plan text summary counts Unlisted and --unlisted prints reasons", async () => {
  const dir = await makeDir("omatune-plan-unlisted-text-")
  const fake = await makeDir("omatune-plan-fake-")
  const library = join(dir, "library")
  await mkdir(library)
  await copyFile(join(LIBRARY, "tone-suite/01-pregap.mp3"), join(library, "ok.mp3"))
  await writeFile(join(library, "song.alac"), "alac-bytes")
  await writeConfig(dir, library)
  await writeSelection(
    dir,
    `version = 1

[[include]]
path = "*"
`,
  )
  await classicDevice(fake)
  const counted = await runMain(
    ["plan", "--device", SERIAL, "--config", dir],
    fakeLayer(fake),
    testEnv(),
  )
  expect(counted.code).toBe(0)
  expect(counted.stdout).toContain("Unlisted: 1")
  expect(counted.stdout).not.toContain("Unlisted song.alac:")
  const listed = await runMain(
    ["plan", "--device", SERIAL, "--config", dir, "--unlisted"],
    fakeLayer(fake),
    testEnv(),
  )
  expect(listed.code).toBe(0)
  expect(listed.stdout).toContain("Unlisted: 1")
  expect(listed.stdout).toContain("Unlisted song.alac: rename .alac to .m4a")
})
