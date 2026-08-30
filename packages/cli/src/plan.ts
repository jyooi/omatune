import {
  ExitCode,
  buildPlan,
  evaluateSelection,
  formatConfigIssue,
  hashesForAdds,
  listDeviceReports,
  loadConfigDir,
  loadLedger,
  loadSelection,
  planKind,
  resolveConfigDir,
  resolveForceModel,
  scanLibrary,
} from "@omatune/core"
import type { Platform } from "@omatune/platform"
import { Effect, type Layer } from "effect"
import type { Flags } from "./flags.ts"
import { formatPlanJson, formatPlanText } from "./format.ts"
import type { RunResult } from "./main.ts"

const SUPPORT_TABLE = "docs/support-table.md"

function refused(message: string, code: 0 | 1 | 2 = ExitCode.RefusedBeforeChange): RunResult {
  return { code, stdout: "", stderr: `${message}\n` }
}

export async function runPlan(
  flags: Flags,
  layer: Layer.Layer<Platform>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  if (!flags.device) {
    return refused("plan needs --device.")
  }
  const dir = resolveConfigDir({
    xdgConfigHome: env.XDG_CONFIG_HOME,
    home: env.HOME,
    flag: flags.config,
    envValue: env.OMATUNE_CONFIG,
  })
  const loaded = await loadConfigDir(dir)
  if (loaded.kind === "created") {
    return refused(`Wrote starter config ${loaded.path}. Set library and run again.`)
  }
  if (loaded.kind === "issue") {
    return refused(formatConfigIssue(loaded.issue))
  }
  const serial = flags.device.toLowerCase()
  const device = loaded.config.devices.find((entry) => entry.serial === serial)
  if (!device) {
    return refused(`Unknown Device ${flags.device}.`)
  }
  const selection = await loadSelection(dir, serial)
  if (!selection.ok) {
    return refused(formatConfigIssue(selection.issue))
  }
  if (selection.value.include.length === 0) {
    return refused("Selection is empty.")
  }
  const reports = await Effect.runPromise(listDeviceReports.pipe(Effect.provide(layer)))
  const report = reports.find((entry) => entry.serial === serial)
  if (!report) {
    return refused(`Device ${flags.device} is not attached.`)
  }
  const forced = flags.forceModel ? resolveForceModel(flags.forceModel) : undefined
  if (flags.forceModel && !forced) {
    return refused(`Unknown --force-model key ${flags.forceModel}.`)
  }
  const tier = forced?.supportTier ?? report.supportTier
  const familyName = forced?.family ?? report.family
  if (!forced && (tier === "Unsupported" || tier === null || familyName === null)) {
    const reason =
      familyName === null || tier === null
        ? "Unknown Device family."
        : `Device family ${familyName} is Unsupported.`
    return refused(`${reason} See ${SUPPORT_TABLE}.`, ExitCode.StoppedAfterChange)
  }
  const ledgerResult = await loadLedger(dir, serial)
  if (!ledgerResult.ok) {
    return refused(`${ledgerResult.issue.file}:${ledgerResult.issue.line}: ${ledgerResult.issue.reason}`)
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
    forceModel: flags.forceModel,
  })
  if (plan.freeSpaceAfter < 0) {
    return refused(
      `Selection does not fit. Needs ${plan.bytesNeeded} bytes. Device has ${report.freeSpaceBytes} bytes free.`,
    )
  }
  const stdout = flags.json ? formatPlanJson(plan) : formatPlanText(plan)
  if (flags.strict && plan.skipped.length > 0) {
    return { code: ExitCode.RefusedBeforeChange, stdout, stderr: "Skipped Tracks in --strict mode.\n" }
  }
  return { code: ExitCode.Success, stdout, stderr: "" }
}
