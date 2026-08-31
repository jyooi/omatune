import { afterEach, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { fakeLayer, writeFakeDevice } from "@omatune/platform"
import { transcodeCacheKey, transcodeCachePath } from "@omatune/transcode"
import { Effect, Stream } from "effect"
import { loadLedger } from "./ledger.ts"
import { SYNCING_MARKER } from "./device-fs.ts"
import { runSync, type SyncEvent, type SyncPlan } from "./sync.ts"
import { readTrackTags } from "./tags.ts"
import { TRANSCODE_CEILING } from "./transcode-plan.ts"

/**
 * End-to-end Sync over the fake Platform, with FLAC Tracks in the Library.
 *
 * These cover the paths the Transcode feature adds: a normal Sync, the hi-res
 * downsample, the Transcode Cache, and a resume after a stopped Sync.
 */

const REPO = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURES = join(REPO, "fixtures", "audio", "library")
const SERIAL = "000a1b2c3d4e5f60"
const MUSIC = "iPod_Control/Music"

type Harness = {
  readonly root: string
  readonly library: string
  readonly configDir: string
  readonly dataDir: string
  readonly cacheDir: string
  readonly devicesRoot: string
  readonly mountPoint: string
}

const created: string[] = []
let priorCache: string | undefined

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (priorCache === undefined) {
    delete process.env.OMATUNE_CACHE
  } else {
    process.env.OMATUNE_CACHE = priorCache
  }
  priorCache = undefined
})

async function harness(files: ReadonlyArray<[string, string]>): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "omatune-transcode-sync-"))
  created.push(root)
  const library = join(root, "library")
  const configDir = join(root, "config")
  const dataDir = join(root, "data")
  const cacheDir = join(root, "cache")
  const devicesRoot = join(root, "devices")
  mkdirSync(library, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(devicesRoot, { recursive: true })

  for (const [source, target] of files) {
    const destination = join(library, target)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(FIXTURES, source), destination)
  }

  writeFileSync(
    join(configDir, "config.toml"),
    `version = 1\nlibrary = ${JSON.stringify(library)}\n\n[devices.${SERIAL}]\nname = "Test"\n`,
  )
  mkdirSync(join(configDir, "devices", SERIAL), { recursive: true })
  writeFileSync(
    join(configDir, "devices", SERIAL, "selection.toml"),
    'version = 1\n\n[[include]]\nalbum_artist = "Björk"\n',
  )

  await writeFakeDevice(devicesRoot, {
    serial: SERIAL,
    owner: "empty",
    freeBytes: 200_000_000,
    productId: 0x1261,
  })

  priorCache = process.env.OMATUNE_CACHE
  process.env.OMATUNE_CACHE = cacheDir

  return {
    root,
    library,
    configDir,
    dataDir,
    cacheDir,
    devicesRoot,
    mountPoint: join(devicesRoot, SERIAL, "volume"),
  }
}

async function sync(
  harness: Harness,
  options: { readonly confirm?: boolean } = {},
): Promise<{ events: SyncEvent[]; plan: SyncPlan; error: string | null }> {
  const events: SyncEvent[] = []
  let error: string | null = null
  const program = runSync({
    serial: SERIAL,
    configDir: harness.configDir,
    yes: true,
    noEject: true,
    strict: false,
    forceModel: null,
    dataDir: harness.dataDir,
    confirm: async () => options.confirm ?? true,
  }).pipe(
    Stream.runForEach((event) => Effect.sync(() => events.push(event))),
    Effect.catchAll((cause) =>
      Effect.sync(() => {
        error = cause.message
      }),
    ),
    Effect.provide(fakeLayer(harness.devicesRoot)),
    Effect.scoped,
  )
  await Effect.runPromise(program)
  const plan = events.find((event) => event.type === "plan")
  if (!plan || plan.type !== "plan") {
    throw new Error(`No Sync Plan in events: ${error ?? "unknown"}`)
  }
  return { events, plan: plan.plan, error }
}

function deviceFile(harness: Harness, devicePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(harness.mountPoint, devicePath)))
}

const FLAC_TRACKS: ReadonlyArray<[string, string]> = [
  ["lossless-suite/01-standard.flac", "Björk/Lossless Suite/01-standard.flac"],
  ["lossless-suite/02-hires.flac", "Björk/Lossless Suite/02-hires.flac"],
]

test("a Sync transcodes FLAC Tracks and writes them as m4a", async () => {
  const kit = await harness(FLAC_TRACKS)
  const { plan, error } = await sync(kit)
  expect(error).toBeNull()

  expect(plan.add).toHaveLength(2)
  expect(plan.transcodeCount).toBe(2)
  expect(plan.skipped).toHaveLength(0)
  for (const add of plan.add) {
    expect(add.transcode).toBe(true)
    expect(add.estimated).toBe(true)
    expect(add.devicePath).toEndWith(".m4a")
    expect(add.devicePath).toStartWith(MUSIC)
  }

  for (const add of plan.add) {
    const bytes = deviceFile(kit, add.devicePath)
    const tags = readTrackTags(bytes)
    expect(tags.codec).toBe("alac")
    expect(tags.albumArtist).toBe("Björk")
    expect(tags.album).toBe("Lossless Suite")
    expect(tags.hasArtwork).toBe(true)
  }
})

test("the Ledger keeps the source identity and records the Transcode", async () => {
  const kit = await harness(FLAC_TRACKS)
  await sync(kit)

  const ledger = await loadLedger(kit.configDir, SERIAL)
  expect(ledger.ok).toBe(true)
  if (!ledger.ok || !ledger.value) {
    throw new Error("The Ledger is missing.")
  }
  expect(ledger.value.tracks).toHaveLength(2)
  for (const entry of ledger.value.tracks) {
    const sourceBytes = new Uint8Array(readFileSync(join(kit.library, entry.libraryPath)))
    // Identity is the source Track, so size and sha256 describe the Library file.
    expect(entry.size).toBe(sourceBytes.length)
    expect(entry.sha256).toBe(Bun.SHA256.hash(sourceBytes, "hex"))
    expect(entry.devicePath).toContain(entry.sha256.slice(0, 16))
    expect(entry.devicePath).toEndWith(".m4a")

    const onDevice = deviceFile(kit, entry.devicePath)
    expect(entry.transcodedSize).toBe(onDevice.length)
    expect(entry.transcodedSha256).toBe(Bun.SHA256.hash(onDevice, "hex"))
    expect(entry.transcodedSize).not.toBe(entry.size)
  }
})

test("a hi-res Track lands on the Device at the ceiling", async () => {
  const kit = await harness(FLAC_TRACKS)
  const { plan } = await sync(kit)
  const hires = plan.add.find((track) => track.path.endsWith("02-hires.flac"))
  expect(hires).toBeDefined()
  if (!hires) {
    return
  }
  const bytes = deviceFile(kit, hires.devicePath)
  const tags = readTrackTags(bytes)
  expect(tags.codec).toBe("alac")
  // Two seconds at 96 kHz becomes two seconds at 48 kHz.
  expect(tags.durationSeconds).toBeCloseTo(2, 2)
  expect(tags.gapless?.sampleCount).toBe(BigInt(2 * TRANSCODE_CEILING.sampleRate))
  // Half the rate and two thirds the depth make the Transcode much smaller.
  const source = readFileSync(join(kit.library, "Björk/Lossless Suite/02-hires.flac"))
  expect(bytes.length).toBeLessThan(source.length)
})

test("a second Sync serves the Transcode from the cache and keeps the Tracks", async () => {
  const kit = await harness(FLAC_TRACKS)
  const first = await sync(kit)
  const firstBytes = first.plan.add.map((add) => deviceFile(kit, add.devicePath))

  for (const add of first.plan.add) {
    const source = new Uint8Array(
      readFileSync(join(kit.library, add.path)),
    )
    const key = transcodeCacheKey({
      sourceSha256: Bun.SHA256.hash(source, "hex"),
      ceiling: TRANSCODE_CEILING,
      conversion: "flac-alac",
    })
    expect(await Bun.file(transcodeCachePath(join(kit.cacheDir, "transcode"), key)).exists()).toBe(
      true,
    )
  }

  const second = await sync(kit)
  expect(second.error).toBeNull()
  expect(second.plan.add).toHaveLength(0)
  expect(second.plan.keep).toHaveLength(2)
  expect(second.plan.transcodeCount).toBe(0)
  // The kept sizes are the real Transcode sizes, not estimates.
  for (const keep of second.plan.keep) {
    expect(keep.estimated).toBe(false)
  }
  for (let i = 0; i < first.plan.add.length; i += 1) {
    const add = first.plan.add[i]
    expect(add).toBeDefined()
    if (add) {
      expect(deviceFile(kit, add.devicePath)).toEqual(firstBytes[i] as Uint8Array)
    }
  }
})

test("a Sync prunes a Transcode whose source Track left the Library", async () => {
  const kit = await harness(FLAC_TRACKS)
  const first = await sync(kit)
  const gone = first.plan.add.find((add) => add.path.endsWith("02-hires.flac"))
  expect(gone).toBeDefined()
  if (!gone) {
    return
  }
  const goneSource = new Uint8Array(readFileSync(join(kit.library, gone.path)))
  const goneKey = transcodeCacheKey({
    sourceSha256: Bun.SHA256.hash(goneSource, "hex"),
    ceiling: TRANSCODE_CEILING,
    conversion: "flac-alac",
  })
  const cache = join(kit.cacheDir, "transcode")
  expect(await Bun.file(transcodeCachePath(cache, goneKey)).exists()).toBe(true)

  rmSync(join(kit.library, gone.path))
  const second = await sync(kit)
  expect(second.error).toBeNull()

  expect(await Bun.file(transcodeCachePath(cache, goneKey)).exists()).toBe(false)
  // The Track that stayed keeps its entry.
  const stayed = first.plan.add.find((add) => add.path.endsWith("01-standard.flac"))
  expect(stayed).toBeDefined()
  if (stayed) {
    const stayedSource = new Uint8Array(readFileSync(join(kit.library, stayed.path)))
    const stayedKey = transcodeCacheKey({
      sourceSha256: Bun.SHA256.hash(stayedSource, "hex"),
      ceiling: TRANSCODE_CEILING,
      conversion: "flac-alac",
    })
    expect(await Bun.file(transcodeCachePath(cache, stayedKey)).exists()).toBe(true)
  }
})

test("a resume after a stopped Sync keeps the Transcode already on the Device", async () => {
  const kit = await harness(FLAC_TRACKS)
  const first = await sync(kit)
  const kept = first.plan.add.find((add) => add.path.endsWith("01-standard.flac"))
  const dropped = first.plan.add.find((add) => add.path.endsWith("02-hires.flac"))
  expect(kept).toBeDefined()
  expect(dropped).toBeDefined()
  if (!kept || !dropped) {
    return
  }
  const keptBefore = deviceFile(kit, kept.devicePath)

  /* Rewind to the state a stopped Sync leaves: the marker is present, one
   * Track is on the Device, and the other never arrived. */
  writeFileSync(
    join(kit.mountPoint, SYNCING_MARKER),
    `${JSON.stringify({ serial: SERIAL, startedAt: 1 })}\n`,
  )
  rmSync(join(kit.mountPoint, dropped.devicePath))

  const second = await sync(kit)
  expect(second.error).toBeNull()
  // The missing Track comes back and the present one is not rewritten.
  expect(second.plan.add.map((add) => add.path)).toEqual([dropped.path])
  expect(second.plan.keep.map((keep) => keep.path)).toEqual([kept.path])
  expect(deviceFile(kit, kept.devicePath)).toEqual(keptBefore)
  expect(await Bun.file(join(kit.mountPoint, dropped.devicePath)).exists()).toBe(true)
  expect(await Bun.file(join(kit.mountPoint, SYNCING_MARKER)).exists()).toBe(false)
})

test("adoption rebuilds a lost Ledger from the Transcodes on the Device", async () => {
  const kit = await harness(FLAC_TRACKS)
  const first = await sync(kit)
  const before = new Map(
    first.plan.add.map((add) => [add.path, deviceFile(kit, add.devicePath)] as const),
  )

  /* Lose the Ledger but keep the Device. A Sync must adopt what is there
   * rather than wipe it, and a Transcode has to be adoptable even though its
   * size never matches the Library file it came from. */
  rmSync(join(kit.configDir, "devices", SERIAL, "ledger.json"))

  const second = await sync(kit)
  expect(second.error).toBeNull()
  expect(second.plan.kind).toBe("adoption")
  expect(second.plan.add).toHaveLength(0)
  expect(second.plan.keep).toHaveLength(2)
  expect(second.plan.remove).toHaveLength(0)

  const ledger = await loadLedger(kit.configDir, SERIAL)
  if (!ledger.ok || !ledger.value) {
    throw new Error("The Ledger is missing after adoption.")
  }
  expect(ledger.value.tracks).toHaveLength(2)
  for (const entry of ledger.value.tracks) {
    const bytes = before.get(entry.libraryPath)
    expect(bytes).toBeDefined()
    if (bytes) {
      // The bytes on the Device are untouched, and the Ledger describes them.
      expect(deviceFile(kit, entry.devicePath)).toEqual(bytes)
      expect(entry.transcodedSize).toBe(bytes.length)
      expect(entry.transcodedSha256).toBe(Bun.SHA256.hash(bytes, "hex"))
    }
  }
})

test("a Sync that mixes FLAC with other formats transcodes only the FLAC", async () => {
  const kit = await harness([
    ...FLAC_TRACKS,
    ["tone-suite/03-steady.mp3", "Björk/Tone Suite/03-steady.mp3"],
    ["dual-disc/d1-01-left.m4a", "Björk/Dual Disc/d1-01-left.m4a"],
  ])
  const { plan, error } = await sync(kit)
  expect(error).toBeNull()
  expect(plan.add).toHaveLength(4)
  expect(plan.transcodeCount).toBe(2)

  const byExtension = new Map(plan.add.map((add) => [add.path.split(".").pop(), add]))
  expect(byExtension.get("mp3")?.transcode).toBe(false)
  expect(byExtension.get("mp3")?.devicePath).toEndWith(".mp3")
  expect(byExtension.get("m4a")?.transcode).toBe(false)
  expect(byExtension.get("m4a")?.devicePath).toEndWith(".m4a")

  // The files that need no Transcode reach the Device unchanged.
  const mp3 = byExtension.get("mp3")
  expect(mp3).toBeDefined()
  if (mp3) {
    expect(deviceFile(kit, mp3.devicePath)).toEqual(
      new Uint8Array(readFileSync(join(kit.library, mp3.path))),
    )
  }
})

test("a damaged FLAC Track is Skipped and the rest of the Sync finishes", async () => {
  const kit = await harness(FLAC_TRACKS)
  const broken = join(kit.library, "Björk/Lossless Suite/02-hires.flac")
  const bytes = new Uint8Array(readFileSync(broken))
  // Keep the header so the Track still reads as FLAC, then ruin the audio.
  bytes.fill(0xff, Math.floor(bytes.length / 2), bytes.length - 16)
  writeFileSync(broken, bytes)

  const { plan, events, error } = await sync(kit)
  expect(plan.add).toHaveLength(2)

  const report = events.find((event) => event.type === "report")
  expect(report).toBeDefined()
  if (report && report.type === "report") {
    expect(report.added).toBe(1)
    expect(report.skipped).toBe(1)
  }
  expect(error).toBeNull()

  const good = plan.add.find((add) => add.path.endsWith("01-standard.flac"))
  expect(good).toBeDefined()
  if (good) {
    expect(readTrackTags(deviceFile(kit, good.devicePath)).codec).toBe("alac")
  }
})
