import {
  defaultDeviceName,
  ExitCode,
  deviceNotAttached,
  formatConfigIssue,
  listDeviceReports,
  loadConfigDir,
  loadLedger,
  loadSelection,
  NO_DEVICE_ATTACHED,
  PASS_DEVICE_OR_ATTACH_ONE,
  registerDevice,
  resolveConfigDir,
  resolveDataDir,
  scanLibrary,
  starterConfigRefusal,
  Sync,
  SyncLive,
  writeSelection,
  type AppSelection,
  type DeviceReport,
  type SyncRequest,
} from "@omatune/core"
import { createCliRenderer, SystemClock, type CliRenderer, type CliRendererConfig } from "@opentui/core"
import { ejectDevice, Platform } from "@omatune/platform"
import { Effect, Stream, type Layer } from "effect"
import { palette } from "./palette.ts"
import { attachSelectionScreen } from "./selection-screen.ts"

export type TuiResult = {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

export type RunTuiInput = {
  readonly config?: string | null
  readonly device?: string | null
  readonly yes?: boolean
  readonly noEject?: boolean
  readonly strict?: boolean
  readonly forceModel?: string | null
  readonly layer: Layer.Layer<Platform>
  readonly syncLayer?: Layer.Layer<Sync>
  readonly env?: NodeJS.ProcessEnv
  readonly createRenderer?: (config: CliRendererConfig) => Promise<CliRenderer>
}

export async function runTui(input: RunTuiInput): Promise<TuiResult> {
  const env = input.env ?? process.env
  const dir = resolveConfigDir({
    xdgConfigHome: env.XDG_CONFIG_HOME,
    home: env.HOME,
    flag: input.config,
    envValue: env.OMATUNE_CONFIG,
  })
  const loaded = await loadConfigDir(dir)
  if (loaded.kind === "created") {
    return refused(starterConfigRefusal(loaded.path))
  }
  if (loaded.kind === "issue") {
    return refused(formatConfigIssue(loaded.issue))
  }
  const reports = await Effect.runPromise(listDeviceReports.pipe(Effect.provide(input.layer)))
  const device = input.device
  const wanted = device ? device.toLowerCase() : null
  const report = pickReport(reports, wanted)
  if (!report) {
    if (device) {
      return refused(deviceNotAttached(device))
    }
    if (reports.length === 0) {
      return refused(NO_DEVICE_ATTACHED)
    }
    return refused(PASS_DEVICE_OR_ATTACH_ONE)
  }
  const named = loaded.config.devices.find((entry) => entry.serial === report.serial)
  const selectionResult = await loadSelection(dir, report.serial)
  if (!selectionResult.ok) {
    return refused(formatConfigIssue(selectionResult.issue))
  }
  const ledgerResult = await loadLedger(dir, report.serial)
  if (!ledgerResult.ok) {
    return refused(`${ledgerResult.issue.file}:${ledgerResult.issue.line}: ${ledgerResult.issue.reason}`)
  }
  const { files, unlisted } = await scanLibrary(loaded.config.library)
  const dataDir = resolveDataDir({
    xdgDataHome: env.XDG_DATA_HOME,
    home: env.HOME,
  })
  const createRenderer = input.createRenderer ?? createCliRenderer
  const clock = new SystemClock()
  const program = Effect.scoped(
    Effect.gen(function* () {
      const sync = yield* Sync
      const renderer = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createRenderer({
            exitOnCtrlC: false,
            exitSignals: [],
            useMouse: true,
            consoleMode: "disabled",
            clock,
            backgroundColor: palette.background,
          }),
        ),
        (instance) => Effect.sync(() => instance.destroy()),
      )
      return yield* Effect.async<TuiResult>((resume) => {
        attachSelectionScreen(
          renderer,
          {
            libraryRoot: loaded.config.library,
            deviceName: named?.name ?? report.serial,
            serial: report.serial,
            tier: report.supportTier ?? "Unknown",
            freeBytes: report.freeSpaceBytes,
            tracksOnDevice: ledgerResult.value?.tracks.length ?? 0,
            files,
            unlisted,
            selection: selectionResult.value,
            ledger: ledgerResult.value,
            writeSelection: (next: AppSelection) => writeSelection(dir, report.serial, next),
            family: report.family,
            volumeFormat: report.volumeFormat,
            ownerState: report.ownerState,
            mountPoint: report.mountPoint,
            notes: report.notes,
            configDir: dir,
            dataDir,
            registered: named !== undefined,
            registerDevice: async () => {
              const name = defaultDeviceName(report.family, report.serial)
              const result = await registerDevice(dir, report.serial, name)
              if (!result.ok) {
                throw new Error(formatConfigIssue(result.issue))
              }
              return result.value
            },
            yes: input.yes === true,
            noEject: input.noEject === true,
            strict: input.strict === true,
            forceModel: input.forceModel ?? null,
            eject: async () => {
              await Effect.runPromise(
                Effect.gen(function* () {
                  const platform = yield* Platform
                  yield* ejectDevice(platform, report.serial, false)
                }).pipe(Effect.provide(input.layer)),
              )
            },
          },
          {
            clock,
            runSync: async (request: SyncRequest, onEvent) => {
              const result = await Effect.runPromise(
                Stream.runForEach(sync.run(request).pipe(Stream.provideLayer(input.layer)), (event) =>
                  Effect.sync(() => onEvent(event)),
                ).pipe(Effect.either),
              )
              if (result._tag === "Left") {
                throw result.left
              }
            },
            onFinish: (result) => resume(Effect.succeed(result)),
          },
        )
      })
    }),
  ).pipe(Effect.provide(input.syncLayer ?? SyncLive))
  try {
    return await Effect.runPromise(program)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return refused(message)
  }
}

function pickReport(
  reports: ReadonlyArray<DeviceReport>,
  wanted: string | null,
): DeviceReport | undefined {
  if (wanted) {
    return reports.find((entry) => entry.serial === wanted)
  }
  if (reports.length === 1) {
    return reports[0]
  }
  return undefined
}

function refused(message: string): TuiResult {
  return { code: ExitCode.RefusedBeforeChange, stdout: "", stderr: `${message}\n` }
}
