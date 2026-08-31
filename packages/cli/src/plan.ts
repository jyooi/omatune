import {
  ExitCode,
  buildPlan,
  countPlayCountsEntries,
  evaluateSelection,
  formatConfigIssue,
  hashesForAdds,
  listDeviceReports,
  loadConfigDir,
  loadLedger,
  loadSelection,
  deviceNotAttached,
  needsDeviceFlag,
  planKind,
  resolveConfigDir,
  resolveForceModel,
  scanLibrary,
  SELECTION_EMPTY,
  selectionDoesNotFit,
  SKIPPED_STRICT,
  starterConfigRefusal,
  unknownDevice,
  unknownFamily,
  unknownForceModel,
} from "@omatune/core"
import type { Platform } from "@omatune/platform"
import { Effect, type Layer } from "effect"
import type { Flags } from "./flags.ts"
import { formatPlanJson, formatPlanText } from "./format.ts"
import type { RunResult } from "./main.ts"

function refused(message: string, code: 0 | 1 | 2 = ExitCode.RefusedBeforeChange): RunResult {
  return { code, stdout: "", stderr: `${message}\n` }
}

export async function runPlan(
  flags: Flags,
  layer: Layer.Layer<Platform>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  if (!flags.device) {
    return refused(needsDeviceFlag("plan"))
  }
  const dir = resolveConfigDir({
    xdgConfigHome: env.XDG_CONFIG_HOME,
    home: env.HOME,
    flag: flags.config,
    envValue: env.OMATUNE_CONFIG,
  })
  const loaded = await loadConfigDir(dir)
  if (loaded.kind === "created") {
    return refused(starterConfigRefusal(loaded.path))
  }
  if (loaded.kind === "issue") {
    return refused(formatConfigIssue(loaded.issue))
  }
  const serial = flags.device.toLowerCase()
  const device = loaded.config.devices.find((entry) => entry.serial === serial)
  if (!device) {
    return refused(unknownDevice(flags.device))
  }
  const selection = await loadSelection(dir, serial)
  if (!selection.ok) {
    return refused(formatConfigIssue(selection.issue))
  }
  if (selection.value.include.length === 0) {
    return refused(SELECTION_EMPTY)
  }
  const reports = await Effect.runPromise(listDeviceReports.pipe(Effect.provide(layer)))
  const report = reports.find((entry) => entry.serial === serial)
  if (!report) {
    return refused(deviceNotAttached(flags.device))
  }
  const forced = flags.forceModel ? resolveForceModel(flags.forceModel) : undefined
  if (flags.forceModel && !forced) {
    return refused(unknownForceModel(flags.forceModel))
  }
  const tier = forced?.supportTier ?? report.supportTier
  const familyName = forced?.family ?? report.family
  if (!forced && (tier === "Unsupported" || tier === null || familyName === null)) {
    return refused(
      unknownFamily(familyName === null || tier === null ? null : familyName),
      ExitCode.StoppedAfterChange,
    )
  }
  const ledgerResult = await loadLedger(dir, serial)
  if (!ledgerResult.ok) {
    return refused(`${ledgerResult.issue.file}:${ledgerResult.issue.line}: ${ledgerResult.issue.reason}`)
  }
  const files = await scanLibrary(loaded.config.library)
  const { selected, skipped } = evaluateSelection(files, selection.value)
  const hashes = await hashesForAdds(loaded.config.library, selected, ledgerResult.value)
  const kind = planKind({ ownerState: report.ownerState, hasLedger: ledgerResult.value !== null })
  const playCountsPending =
    kind === "wipe" || report.mountPoint === null
      ? 0
      : await countPlayCountsEntries(report.mountPoint)
  const plan = buildPlan({
    kind,
    selected,
    skipped,
    ledger: ledgerResult.value,
    hashes,
    freeBytes: report.freeSpaceBytes,
    forceModel: flags.forceModel,
    playCountsPending,
  })
  if (plan.freeSpaceAfter < 0) {
    return refused(
      selectionDoesNotFit(plan.bytesNeeded, report.freeSpaceBytes),
    )
  }
  const stdout = flags.json ? formatPlanJson(plan) : formatPlanText(plan)
  if (flags.strict && plan.skipped.length > 0) {
    return { code: ExitCode.RefusedBeforeChange, stdout, stderr: `${SKIPPED_STRICT}\n` }
  }
  return { code: ExitCode.Success, stdout, stderr: "" }
}
