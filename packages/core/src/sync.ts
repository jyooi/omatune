import { mkdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import {
  lookupFamily,
  signItunesdbForFamily,
  type FamilyRecord,
} from "@omatune/device-database"
import { Platform, type PlatformApi } from "@omatune/platform"
import { Context, Data, Effect, Layer, Stream } from "effect"
import type { AppConfig } from "./config.ts"
import { formatConfigIssue, loadConfigDir, loadSelection } from "./config.ts"
import { toDeviceReport, type DeviceReport } from "./device-report.ts"
import { adoptLedger } from "./adopt.ts"
import { placeAdd } from "./copy-adds.ts"
import {
  HASH_AHEAD,
  ITUNESDB,
  OWNER_JSON,
  PLAY_COUNTS,
  SYNCING_MARKER,
  deleteDeviceFile,
  fileSizeOrZero,
  listMusicFiles,
  pathExists,
  wipeIpodControl,
  writeFileAtomic,
} from "./device-fs.ts"
import { ExitCode } from "./exit-code.ts"
import {
  artworkHashOf,
  buildPlan,
  hashesForAdds,
  planKind,
  resolveForceModel,
  runPool,
  sha256File,
  type PlannedTrack,
  type SyncPlan,
} from "./plan.ts"
import {
  type Ledger,
  type LedgerEntry,
  freshDbid,
  loadLedger,
  writeLedgerAtomic,
} from "./ledger.ts"
import { acquireSerialLock, releaseSerialLock } from "./lock.ts"
import { evaluateSelection, type SelectedTrack, type SkippedTrack } from "./rules.ts"
import { scanLibrary } from "./scan.ts"
import {
  artworkCacheDir,
  tracksForArtwork,
  writeDeviceArtwork,
  type ArtworkSkip,
  type ArtworkWriteResult,
} from "./artwork.ts"
import {
  itunesdbReserveBytes,
  serializeSignedLayout,
  tracksForDatabase,
} from "./itunesdb-write.ts"
import {
  loadPlayData,
  playDataNeedsWriteback,
  writePlayDataAtomic,
  type HostPlayData,
  type PlayDataFile,
} from "./play-data.ts"
import {
  countPlayCountsEntries,
  moveUnmergedPlayCounts,
  runPlayDataReadBack,
  unmergedPlayCountsMovedMessage,
  type ReadBackResult,
} from "./read-back.ts"

export class SyncError extends Data.TaggedError("SyncError")<{
  readonly message: string
  readonly code: 1 | 2
}> {}

export type SyncPhase = "read-back" | "delete" | "copy" | "artwork" | "database"

export type SyncProgress = {
  readonly type: "progress"
  readonly phase: SyncPhase
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly filesDone: number
  readonly filesTotal: number
  readonly currentFile: string | null
}

export type SyncReport = {
  readonly type: "report"
  readonly added: number
  readonly removed: number
  readonly kept: number
  readonly skipped: number
  readonly artworkSkipped: ReadonlyArray<ArtworkSkip>
  readonly ejected: boolean
}

export type SyncEvent =
  | { readonly type: "plan"; readonly plan: SyncPlan }
  | { readonly type: "message"; readonly text: string; readonly level: "info" | "warning" }
  | SyncProgress
  | SyncReport

export type SyncRequest = {
  readonly serial: string
  readonly configDir: string
  readonly yes: boolean
  readonly noEject: boolean
  readonly strict: boolean
  readonly forceModel: string | null
  readonly dataDir: string
  readonly confirm: (plan: SyncPlan) => Promise<boolean>
}

type SyncContext = {
  readonly config: AppConfig
  readonly serial: string
  readonly selected: ReadonlyArray<SelectedTrack>
  readonly ledger: Ledger | null
  readonly hashes: ReadonlyMap<string, string>
  readonly plan: SyncPlan
  readonly report: DeviceReport
  readonly family: FamilyRecord
  readonly mountPoint: string
  readonly dataDir: string
}

export class Sync extends Context.Tag("omatune/Sync")<
  Sync,
  {
    readonly run: (request: SyncRequest) => Stream.Stream<SyncEvent, SyncError, Platform>
  }
>() {}

export const SyncLive = Layer.succeed(Sync, { run: runSync })

export function runSync(request: SyncRequest): Stream.Stream<SyncEvent, SyncError, Platform> {
  return Stream.asyncPush((emit) =>
    Effect.gen(function* () {
      const platform = yield* Platform
      yield* Effect.forkScoped(
        Effect.promise(async () => {
          const serial = request.serial.toLowerCase()
          let lockPath: string | undefined
          let failure: unknown
          try {
            try {
              lockPath = await acquireSerialLock(request.configDir, serial)
            } catch (cause) {
              throw new SyncError({
                message: cause instanceof Error ? cause.message : String(cause),
                code: ExitCode.RefusedBeforeChange,
              })
            }
            await executeLocked(request, serial, platform, async (event) => {
              emit.single(event)
            })
          } catch (cause) {
            failure = cause
          } finally {
            if (lockPath !== undefined) {
              await releaseSerialLock(lockPath)
            }
          }
          if (failure !== undefined) {
            emit.fail(toSyncError(failure, ExitCode.StoppedAfterChange))
            return
          }
          emit.end()
        }),
      )
    }),
  )
}

async function executeLocked(
  request: SyncRequest,
  serial: string,
  platform: PlatformApi,
  emit: (event: SyncEvent) => Promise<void>,
): Promise<void> {
  const prepared = await prepareSync(request, serial, platform)
  await emit({ type: "plan", plan: prepared.plan })
  if (request.strict && prepared.plan.skipped.length > 0) {
    throw new SyncError({
      message: "Skipped Tracks in --strict mode.",
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const confirmed = await request.confirm(prepared.plan)
  if (!confirmed) {
    throw new SyncError({
      message: "Sync cancelled.",
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (prepared.plan.kind === "wipe") {
    await wipeIpodControl(prepared.mountPoint)
  }
  await runPipeline(request, prepared, platform, emit)
}

async function prepareSync(
  request: SyncRequest,
  serial: string,
  platform: PlatformApi,
): Promise<SyncContext> {
  const loaded = await loadConfigDir(request.configDir)
  if (loaded.kind === "created") {
    throw new SyncError({
      message: `Wrote starter config ${loaded.path}. Set library and run again.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (loaded.kind === "issue") {
    throw new SyncError({
      message: formatConfigIssue(loaded.issue),
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const device = loaded.config.devices.find((entry) => entry.serial === serial)
  if (!device) {
    throw new SyncError({
      message: `Unknown Device ${request.serial}.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const selection = await loadSelection(request.configDir, serial)
  if (!selection.ok) {
    throw new SyncError({
      message: formatConfigIssue(selection.issue),
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (selection.value.include.length === 0) {
    throw new SyncError({
      message: "Selection is empty.",
      code: ExitCode.RefusedBeforeChange,
    })
  }
  let attached = await Effect.runPromise(platform.listDevices)
  let info = attached.find((entry) => entry.serial === serial)
  if (!info) {
    throw new SyncError({
      message: `Device ${request.serial} is not attached.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (info.mountPoint === null) {
    await Effect.runPromise(platform.mount(serial))
    attached = await Effect.runPromise(platform.listDevices)
    info = attached.find((entry) => entry.serial === serial)
  }
  if (!info || info.mountPoint === null) {
    throw new SyncError({
      message: `Device ${request.serial} is not mounted.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const report = await toDeviceReport(info)
  const forced = request.forceModel ? resolveForceModel(request.forceModel) : undefined
  if (request.forceModel && !forced) {
    throw new SyncError({
      message: `Unknown --force-model key ${request.forceModel}.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const family = forced ?? lookupFamily({ modelString: info.modelString })
  const tier = family?.supportTier ?? report.supportTier
  const familyName = family?.family ?? report.family
  if (!forced && (tier === "Unsupported" || tier === null || familyName === null || !family)) {
    const reason =
      familyName === null || tier === null
        ? "Unknown Device family."
        : `Device family ${familyName} is Unsupported.`
    throw new SyncError({
      message: `${reason} See docs/support-table.md.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (!family) {
    throw new SyncError({
      message: "Unknown Device family. See docs/support-table.md.",
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const ledgerResult = await loadLedger(request.configDir, serial)
  if (!ledgerResult.ok) {
    throw new SyncError({
      message: `${ledgerResult.issue.file}:${ledgerResult.issue.line}: ${ledgerResult.issue.reason}`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const files = await scanLibrary(loaded.config.library)
  const { selected, skipped } = evaluateSelection(files, selection.value)
  const kind = planKind({ ownerState: report.ownerState, hasLedger: ledgerResult.value !== null })
  const hashes = await hashesForAdds(
    loaded.config.library,
    selected,
    kind === "wipe" || kind === "adoption" ? null : ledgerResult.value,
  )
  const ledger =
    kind === "adoption"
      ? await adoptLedger({
          serial,
          libraryRoot: loaded.config.library,
          mountPoint: info.mountPoint,
          selected,
          hashes,
          now: await Effect.runPromise(platform.now),
        })
      : ledgerResult.value
  const playCountsPending =
    kind === "wipe" ? 0 : await countPlayCountsEntries(info.mountPoint)
  const plan = buildPlan({
    kind,
    selected,
    skipped,
    ledger: kind === "wipe" ? null : ledger,
    hashes,
    freeBytes: report.freeSpaceBytes,
    forceModel: request.forceModel,
    playCountsPending,
  })
  return {
    config: loaded.config,
    serial,
    selected,
    ledger,
    hashes,
    plan,
    report,
    family,
    mountPoint: info.mountPoint,
    dataDir: request.dataDir,
  }
}

async function runPipeline(
  request: SyncRequest,
  ctx: SyncContext,
  platform: PlatformApi,
  emit: (event: SyncEvent) => Promise<void>,
): Promise<void> {
  await emitPhase(emit, "read-back", 0, 0, 0, 0, null)
  const readBack = await runReadBack(request, ctx, platform)
  for (const message of readBack.messages) {
    await emit({ type: "message", text: message.text, level: message.level })
  }
  if (readBack.strictFail) {
    throw new SyncError({
      message: readBack.strictFail,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const named = new Set([...ctx.plan.keep, ...ctx.plan.add].map((track) => track.devicePath))
  const music = await listMusicFiles(ctx.mountPoint)
  const extra = music.filter((path) => !named.has(path))
  const noop =
    ctx.plan.kind !== "adoption" &&
    !readBack.consumedPlayCounts &&
    !playDataNeedsWriteback(readBack.playData, ctx.ledger) &&
    ctx.plan.add.length === 0 &&
    ctx.plan.remove.length === 0 &&
    extra.length === 0
  const marker = join(ctx.mountPoint, SYNCING_MARKER)
  const resume = await pathExists(marker)
  let addedCount = ctx.plan.add.length
  let skippedCount = ctx.plan.skipped.length
  let diskFull = false
  let artworkSkipped: ReadonlyArray<ArtworkSkip> = []
  if (noop) {
    await deleteDeviceFile(ctx.mountPoint, SYNCING_MARKER)
    await emitPhase(emit, "delete", 0, 0, 0, 0, null)
    await emitPhase(emit, "copy", 0, 0, 0, 0, null)
    await emitPhase(emit, "artwork", 0, 0, 0, 0, null)
    if (ctx.ledger) {
      const priorHashes = new Map(
        ctx.ledger.tracks.map((entry) => [entry.libraryPath, entry.artworkHash]),
      )
      const artwork = await runArtwork(ctx, ctx.ledger, priorHashes)
      artworkSkipped = artwork.skipped
      if (artwork.wrote) {
        const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
        await mkdir(join(ctx.mountPoint, "iPod_Control", "iTunes"), { recursive: true })
        const dbTracks = tracksForDatabase(
          ctx.ledger.tracks,
          selectedByPath,
          artwork.dbidsWithArtwork,
          playDataMap(readBack.playData),
        )
        await emitPhase(emit, "database", 0, 1, 0, 1, "iTunesDB")
        const unsigned = serializeSignedLayout(dbTracks)
        const signed = signItunesdbForFamily(unsigned, ctx.serial, ctx.family)
        await writeFileAtomic(join(ctx.mountPoint, ITUNESDB), signed)
        if (ledgerArtworkChanged(ctx.ledger, artwork.hashes)) {
          await writeLedgerAtomic(ctx.config.dir, withArtworkHashes(ctx.ledger, artwork.hashes))
        }
        await emitPhase(emit, "database", 1, 1, 1, 1, null)
      } else {
        await emitPhase(emit, "database", 0, 0, 0, 0, null)
      }
    } else {
      await emitPhase(emit, "database", 0, 0, 0, 0, null)
    }
  } else {
    await writeFileAtomic(
      marker,
      `${JSON.stringify({ serial: ctx.serial, startedAt: await Effect.runPromise(platform.now) })}\n`,
    )
    const deletes = uniquePaths([
      ...ctx.plan.remove.map((track) => track.devicePath),
      ...extra,
    ])
    let filesDone = 0
    let spaceRemaining = ctx.report.freeSpaceBytes
    for (const path of deletes) {
      await emitPhase(emit, "delete", 0, 0, filesDone, deletes.length, path)
      spaceRemaining += await fileSizeOrZero(join(ctx.mountPoint, path))
      await deleteDeviceFile(ctx.mountPoint, path)
      filesDone += 1
      await yieldFiber()
    }
    await emitPhase(emit, "delete", 0, 0, deletes.length, deletes.length, null)

    const hashes = new Map(ctx.hashes)
    const add = ctx.plan.add
    const dbReserve = itunesdbReserveBytes(ctx.plan.keep.length + add.length)
    if (ctx.plan.kind === "wipe") {
      const live = await deviceFreeBytes(platform, ctx.serial)
      if (live !== null) {
        spaceRemaining = live
      }
    }
    spaceRemaining = Math.max(0, spaceRemaining - dbReserve)
    const pending = new Map<string, Promise<string>>()
    const ensureHash = (libraryPath: string): Promise<string> => {
      const known = hashes.get(libraryPath)
      if (known) {
        return Promise.resolve(known)
      }
      const prior = ctx.ledger?.tracks.find((entry) => entry.libraryPath === libraryPath)
      if (prior) {
        return Promise.resolve(prior.sha256)
      }
      let job = pending.get(libraryPath)
      if (!job) {
        job = sha256File(join(ctx.config.library, libraryPath)).then((value) => {
          hashes.set(libraryPath, value)
          return value
        })
        pending.set(libraryPath, job)
      }
      return job
    }
    let hashing: Promise<void> = Promise.resolve()
    const prefetch = (from: number) => {
      const slice = add.slice(from, from + HASH_AHEAD)
      hashing = runPool(slice, HASH_AHEAD, async (track) => {
        await ensureHash(track.path)
      }).catch(() => undefined)
    }
    let copied = 0
    let bytesDone = 0
    const bytesTotal = ctx.plan.bytesNeeded
    const presentAdds: PlannedTrack[] = []
    const extraSkipped: SkippedTrack[] = []
    try {
      for (let i = 0; i < add.length; i += 1) {
        prefetch(i)
        const track = add[i]
        if (!track) {
          continue
        }
        await emitPhase(emit, "copy", bytesDone, bytesTotal, copied, add.length, track.path)
        await ensureHash(track.path)
        if (diskFull) {
          extraSkipped.push({ path: track.path, reason: "disk_full" })
          continue
        }
        const live = await deviceFreeBytes(platform, ctx.serial)
        const placed = await placeAdd({
          source: join(ctx.config.library, track.path),
          dest: join(ctx.mountPoint, track.devicePath),
          size: track.size,
          resume,
          spaceRemaining,
          liveFreeBytes: live === null ? null : Math.max(0, live - dbReserve),
        })
        if (placed.status === "disk-full") {
          diskFull = true
          extraSkipped.push({ path: track.path, reason: "disk_full" })
          continue
        }
        spaceRemaining = placed.spaceRemaining
        presentAdds.push(track)
        copied += 1
        bytesDone += track.size
        await yieldFiber()
      }
    } finally {
      await hashing
    }
    addedCount = presentAdds.length
    skippedCount = ctx.plan.skipped.length + extraSkipped.length
    await emitPhase(emit, "copy", bytesDone, bytesTotal, copied, add.length, null)

    const now = await Effect.runPromise(platform.now)
    const nextLedger = buildNextLedger(ctx, hashes, now, readBack.playData, presentAdds)
    await emitPhase(emit, "artwork", 0, 0, 0, 0, null)
    const artwork = await runArtwork(ctx, nextLedger)
    artworkSkipped = artwork.skipped
    const artworkDbids = artwork.dbidsWithArtwork

    await mkdir(join(ctx.mountPoint, "iPod_Control", "iTunes"), { recursive: true })
    const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
    const playDataByHash = playDataMap(readBack.playData)
    const dbTracks = tracksForDatabase(
      nextLedger.tracks,
      selectedByPath,
      artworkDbids,
      playDataByHash,
    )
    await emitPhase(emit, "database", 0, 1, 0, 1, "iTunesDB")
    const unsigned = serializeSignedLayout(dbTracks)
    const signed = signItunesdbForFamily(unsigned, ctx.serial, ctx.family)
    await writeFileAtomic(join(ctx.mountPoint, ITUNESDB), signed)
    if (readBack.consumedPlayCounts) {
      if (await pathExists(join(ctx.mountPoint, PLAY_COUNTS))) {
        await unlink(join(ctx.mountPoint, PLAY_COUNTS))
      }
    } else if (readBack.unmergedPlayCounts) {
      const failed = await moveUnmergedPlayCounts(ctx.dataDir, ctx.serial, now, ctx.mountPoint)
      if (failed) {
        await emit({
          type: "message",
          text: unmergedPlayCountsMovedMessage(failed),
          level: "warning",
        })
      }
    }
    await writeFileAtomic(
      join(ctx.mountPoint, OWNER_JSON),
      `${JSON.stringify({ version: 1, serial: ctx.serial, lastCommitTime: now }, null, 2)}\n`,
    )
    await writeLedgerAtomic(ctx.config.dir, nextLedger)
    await deleteDeviceFile(ctx.mountPoint, SYNCING_MARKER)
    await emitPhase(emit, "database", 1, 1, 1, 1, null)
  }

  const ejected = !request.noEject
  if (ejected) {
    await Effect.runPromise(platform.unmount(ctx.serial))
  }
  await emit({
    type: "report",
    added: addedCount,
    removed: ctx.plan.remove.length,
    kept: ctx.plan.keep.length,
    skipped: skippedCount,
    artworkSkipped,
    ejected,
  })
  if (diskFull) {
    throw new SyncError({
      message: "Device is full.",
      code: ExitCode.StoppedAfterChange,
    })
  }
}

export async function runReadBack(
  request: SyncRequest,
  ctx: SyncContext,
  platform: PlatformApi,
): Promise<ReadBackResult> {
  const loaded = await loadPlayData(ctx.dataDir)
  if (!loaded.ok) {
    throw new SyncError({
      message: `${loaded.issue.file}:${loaded.issue.line}: ${loaded.issue.reason}`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  const now = await Effect.runPromise(platform.now)
  const result = await runPlayDataReadBack(
    {
      kind: ctx.plan.kind,
      serial: ctx.serial,
      mountPoint: ctx.mountPoint,
      dataDir: ctx.dataDir,
      ledger: ctx.ledger,
      hashes: ctx.hashes,
      selected: ctx.selected,
      strict: request.strict,
      now,
    },
    loaded.value,
  )
  if (result.changed) {
    await writePlayDataAtomic(ctx.dataDir, result.playData)
  }
  return result
}

export async function runArtwork(
  ctx: SyncContext,
  ledger: Ledger,
  priorHashes?: ReadonlyMap<string, string | null>,
): Promise<ArtworkWriteResult> {
  const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
  return writeDeviceArtwork({
    mountPoint: ctx.mountPoint,
    family: ctx.family,
    tracks: tracksForArtwork(ledger, selectedByPath),
    cacheDir: artworkCacheDir(),
    priorHashes,
  })
}

function playDataMap(file: PlayDataFile): Map<string, HostPlayData> {
  return new Map(Object.entries(file.tracks))
}

function buildNextLedger(
  ctx: SyncContext,
  hashes: ReadonlyMap<string, string>,
  now: number,
  playData: PlayDataFile,
  presentAdds: ReadonlyArray<PlannedTrack>,
): Ledger {
  const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
  const priorByPath = new Map((ctx.ledger?.tracks ?? []).map((entry) => [entry.libraryPath, entry]))
  const used = new Set<string>()
  const tracks: LedgerEntry[] = []
  const keptOrAdded = [...ctx.plan.keep, ...presentAdds].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  for (const planned of keptOrAdded) {
    const selected = selectedByPath.get(planned.path)
    if (!selected) {
      continue
    }
    const prior = priorByPath.get(planned.path)
    const sha256 = hashes.get(planned.path) ?? prior?.sha256 ?? ""
    const host = playData.tracks[sha256]
    tracks.push({
      libraryPath: planned.path,
      size: selected.size,
      mtime: selected.mtimeMs,
      sha256,
      devicePath: planned.devicePath,
      dbid: dbidFor(prior, used),
      artworkHash: artworkHashOf(selected.tags.artworkBytes),
      writtenRating: host?.rating ?? 0,
      lastPlayed: host?.lastPlayed ?? 0,
      bookmark: host?.bookmark ?? 0,
      writtenPlayCount: host?.playCount ?? 0,
      writtenSkipCount: host?.skipCount ?? 0,
      writtenLastSkipped: host?.lastSkipped ?? 0,
    })
  }
  return {
    version: 1,
    serial: ctx.serial,
    libraryRoot: ctx.config.library,
    lastCommitTime: now,
    tracks,
  }
}

function withArtworkHashes(
  ledger: Ledger,
  hashes: ReadonlyMap<string, string | null>,
): Ledger {
  return {
    ...ledger,
    tracks: ledger.tracks.map((entry) => ({
      ...entry,
      artworkHash: hashes.has(entry.libraryPath)
        ? (hashes.get(entry.libraryPath) ?? null)
        : entry.artworkHash,
    })),
  }
}

function ledgerArtworkChanged(
  ledger: Ledger,
  hashes: ReadonlyMap<string, string | null>,
): boolean {
  for (const entry of ledger.tracks) {
    if (!hashes.has(entry.libraryPath)) {
      continue
    }
    if (hashes.get(entry.libraryPath) !== entry.artworkHash) {
      return true
    }
  }
  return false
}

function dbidFor(prior: LedgerEntry | undefined, used: Set<string>): string {
  if (prior && !used.has(prior.dbid)) {
    used.add(prior.dbid)
    return prior.dbid
  }
  return freshDbid(used)
}

async function deviceFreeBytes(platform: PlatformApi, serial: string): Promise<number | null> {
  const attached = await Effect.runPromise(platform.listDevices)
  const info = attached.find((entry) => entry.serial === serial)
  return info?.freeBytes ?? null
}

function uniquePaths(paths: ReadonlyArray<string>): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

async function emitPhase(
  emit: (event: SyncEvent) => Promise<void>,
  phase: SyncPhase,
  bytesDone: number,
  bytesTotal: number,
  filesDone: number,
  filesTotal: number,
  currentFile: string | null,
): Promise<void> {
  await emit({
    type: "progress",
    phase,
    bytesDone,
    bytesTotal,
    filesDone,
    filesTotal,
    currentFile,
  })
}

async function yieldFiber(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

function toSyncError(cause: unknown, fallback: 1 | 2): SyncError {
  if (cause instanceof SyncError) {
    return cause
  }
  return new SyncError({
    message: cause instanceof Error ? cause.message : String(cause),
    code: fallback,
  })
}
