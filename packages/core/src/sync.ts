import { randomBytes } from "node:crypto"
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
import {
  HASH_AHEAD,
  ITUNESDB,
  OWNER_JSON,
  PLAY_COUNTS,
  SYNCING_MARKER,
  copyFileChunked,
  deleteDeviceFile,
  listMusicFiles,
  pathExists,
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
  type SyncPlan,
} from "./plan.ts"
import {
  type Ledger,
  type LedgerEntry,
  loadLedger,
  writeLedgerAtomic,
} from "./ledger.ts"
import { acquireSerialLock, releaseSerialLock } from "./lock.ts"
import { evaluateSelection, type SelectedTrack } from "./rules.ts"
import { scanLibrary } from "./scan.ts"
import { serializeSignedLayout, tracksForDatabase } from "./itunesdb-write.ts"

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
  readonly ejected: boolean
}

export type SyncEvent =
  | { readonly type: "plan"; readonly plan: SyncPlan }
  | SyncProgress
  | SyncReport

export type SyncRequest = {
  readonly serial: string
  readonly configDir: string
  readonly yes: boolean
  readonly noEject: boolean
  readonly strict: boolean
  readonly forceModel: string | null
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
      yield* Effect.promise(async () => {
        const serial = request.serial.toLowerCase()
        let lockPath: string | undefined
        try {
          lockPath = await acquireSerialLock(request.configDir, serial)
          await executeLocked(request, serial, platform, async (event) => {
            emit.single(event)
          })
          emit.end()
        } catch (cause) {
          emit.fail(toSyncError(cause, ExitCode.StoppedAfterChange))
        } finally {
          if (lockPath !== undefined) {
            await releaseSerialLock(lockPath)
          }
        }
      })
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
  if (prepared.plan.kind === "wipe") {
    throw new SyncError({
      message: "This Device is foreign. omatune refuses to Sync it.",
      code: ExitCode.RefusedBeforeChange,
    })
  }
  if (prepared.plan.kind === "adoption") {
    throw new SyncError({
      message: "The Ledger is missing. omatune refuses to Sync this Device.",
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
      code: ExitCode.StoppedAfterChange,
    })
  }
  if (!family) {
    throw new SyncError({
      message: "Unknown Device family. See docs/support-table.md.",
      code: ExitCode.StoppedAfterChange,
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
  const hashes = await hashesForAdds(loaded.config.library, selected, ledgerResult.value)
  const plan = buildPlan({
    kind: planKind({ ownerState: report.ownerState, hasLedger: ledgerResult.value !== null }),
    selected,
    skipped,
    ledger: ledgerResult.value,
    hashes,
    freeBytes: report.freeSpaceBytes,
    forceModel: request.forceModel,
  })
  if (plan.freeSpaceAfter < 0) {
    throw new SyncError({
      message: `Selection does not fit. Needs ${plan.bytesNeeded} bytes. Device has ${report.freeSpaceBytes} bytes free.`,
      code: ExitCode.RefusedBeforeChange,
    })
  }
  return {
    config: loaded.config,
    serial,
    selected,
    ledger: ledgerResult.value,
    hashes,
    plan,
    report,
    family,
    mountPoint: info.mountPoint,
  }
}

async function runPipeline(
  request: SyncRequest,
  ctx: SyncContext,
  platform: PlatformApi,
  emit: (event: SyncEvent) => Promise<void>,
): Promise<void> {
  const noop = ctx.plan.add.length === 0 && ctx.plan.remove.length === 0
  await emitPhase(emit, "read-back", 0, 0, 0, 0, null)
  // HUF-269 Read-back runs here, before delete.
  await runReadBack(ctx)
  if (!noop) {
    const marker = join(ctx.mountPoint, SYNCING_MARKER)
    await writeFileAtomic(
      marker,
      `${JSON.stringify({ serial: ctx.serial, startedAt: await Effect.runPromise(platform.now) })}\n`,
    )
    const named = new Set([...ctx.plan.keep, ...ctx.plan.add].map((track) => track.devicePath))
    const music = await listMusicFiles(ctx.mountPoint)
    const extra = music.filter((path) => !named.has(path))
    const deletes = uniquePaths([
      ...ctx.plan.remove.map((track) => track.devicePath),
      ...extra,
    ])
    let filesDone = 0
    for (const path of deletes) {
      await emitPhase(emit, "delete", 0, 0, filesDone, deletes.length, path)
      await deleteDeviceFile(ctx.mountPoint, path)
      filesDone += 1
      await yieldFiber()
    }
    await emitPhase(emit, "delete", 0, 0, deletes.length, deletes.length, null)

    const hashes = new Map(ctx.hashes)
    const add = ctx.plan.add
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
    const prefetch = (from: number) => {
      const slice = add.slice(from, from + HASH_AHEAD)
      void runPool(slice, HASH_AHEAD, async (track) => {
        await ensureHash(track.path)
      })
    }
    let copied = 0
    let bytesDone = 0
    const bytesTotal = ctx.plan.bytesNeeded
    for (let i = 0; i < add.length; i += 1) {
      prefetch(i)
      const track = add[i]
      if (!track) {
        continue
      }
      await emitPhase(emit, "copy", bytesDone, bytesTotal, copied, add.length, track.path)
      await ensureHash(track.path)
      await copyFileChunked(join(ctx.config.library, track.path), join(ctx.mountPoint, track.devicePath))
      copied += 1
      bytesDone += track.size
      await yieldFiber()
    }
    await emitPhase(emit, "copy", bytesDone, bytesTotal, copied, add.length, null)

    await emitPhase(emit, "artwork", 0, 0, 0, 0, null)
    // HUF-270 Artwork runs here, after copy and before the Device Database write.
    await runArtwork(ctx)

    const now = await Effect.runPromise(platform.now)
    const nextLedger = buildNextLedger(ctx, hashes, now)
    await mkdir(join(ctx.mountPoint, "iPod_Control", "iTunes"), { recursive: true })
    const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
    const dbTracks = tracksForDatabase(nextLedger.tracks, selectedByPath)
    await emitPhase(emit, "database", 0, 1, 0, 1, "iTunesDB")
    const unsigned = serializeSignedLayout(dbTracks)
    const signed = signItunesdbForFamily(unsigned, ctx.serial, ctx.family)
    await writeFileAtomic(join(ctx.mountPoint, ITUNESDB), signed)
    if (await pathExists(join(ctx.mountPoint, PLAY_COUNTS))) {
      await unlink(join(ctx.mountPoint, PLAY_COUNTS))
    }
    await writeFileAtomic(
      join(ctx.mountPoint, OWNER_JSON),
      `${JSON.stringify({ version: 1, serial: ctx.serial, lastCommitTime: now }, null, 2)}\n`,
    )
    await writeLedgerAtomic(ctx.config.dir, nextLedger)
    await deleteDeviceFile(ctx.mountPoint, SYNCING_MARKER)
    await emitPhase(emit, "database", 1, 1, 1, 1, null)
  } else {
    await emitPhase(emit, "delete", 0, 0, 0, 0, null)
    await emitPhase(emit, "copy", 0, 0, 0, 0, null)
    await emitPhase(emit, "artwork", 0, 0, 0, 0, null)
    await emitPhase(emit, "database", 0, 0, 0, 0, null)
  }

  const ejected = !request.noEject
  if (ejected) {
    await Effect.runPromise(platform.unmount(ctx.serial))
  }
  await emit({
    type: "report",
    added: ctx.plan.add.length,
    removed: ctx.plan.remove.length,
    kept: ctx.plan.keep.length,
    skipped: ctx.plan.skipped.length,
    ejected,
  })
}

export async function runReadBack(_ctx: SyncContext): Promise<void> {
  return
}

export async function runArtwork(_ctx: SyncContext): Promise<void> {
  return
}

function buildNextLedger(
  ctx: SyncContext,
  hashes: ReadonlyMap<string, string>,
  now: number,
): Ledger {
  const selectedByPath = new Map(ctx.selected.map((track) => [track.relativePath, track]))
  const priorByPath = new Map((ctx.ledger?.tracks ?? []).map((entry) => [entry.libraryPath, entry]))
  const used = new Set<string>()
  const tracks: LedgerEntry[] = []
  const keptOrAdded = [...ctx.plan.keep, ...ctx.plan.add].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  for (const planned of keptOrAdded) {
    const selected = selectedByPath.get(planned.path)
    if (!selected) {
      continue
    }
    const prior = priorByPath.get(planned.path)
    const sha256 = hashes.get(planned.path) ?? prior?.sha256 ?? ""
    tracks.push({
      libraryPath: planned.path,
      size: selected.size,
      mtime: selected.mtimeMs,
      sha256,
      devicePath: planned.devicePath,
      dbid: dbidFor(prior, used),
      artworkHash: artworkHashOf(selected.tags.artworkBytes),
      writtenRating: null,
      lastPlayed: null,
      bookmark: null,
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

function dbidFor(prior: LedgerEntry | undefined, used: Set<string>): string {
  if (prior && !used.has(prior.dbid)) {
    used.add(prior.dbid)
    return prior.dbid
  }
  while (true) {
    const bytes = randomBytes(8)
    const value = bytes.readBigUInt64LE(0)
    if (value === 0n) {
      continue
    }
    const text = value.toString()
    if (!used.has(text)) {
      used.add(text)
      return text
    }
  }
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
