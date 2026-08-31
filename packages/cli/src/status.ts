import {
  adoptDevice,
  ExitCode,
  formatConfigIssue,
  loadConfigDir,
  loadSelection,
  needsDeviceFlag,
  resolveConfigDir,
  starterConfigRefusal,
  unknownDeviceOffer,
} from "@omatune/core"
import type { Flags } from "./flags.ts"
import type { RunResult } from "./main.ts"

function refused(message: string): RunResult {
  return { code: ExitCode.RefusedBeforeChange, stdout: "", stderr: `${message}\n` }
}

export async function runStatus(
  flags: Flags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  if (!flags.device) {
    return refused(needsDeviceFlag("status"))
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
    if (!flags.yes) {
      return refused(unknownDeviceOffer(flags.device))
    }
    const adopted = await adoptDevice(dir, serial)
    if (!adopted.ok) {
      return refused(formatConfigIssue(adopted.issue))
    }
    return statusOutput(adopted.value.serial, adopted.value.name, 0)
  }
  const selection = await loadSelection(dir, serial)
  if (!selection.ok) {
    return refused(formatConfigIssue(selection.issue))
  }
  const ruleCount = selection.value.include.length + selection.value.exclude.length
  return statusOutput(device.serial, device.name, ruleCount)
}

function statusOutput(serial: string, name: string, ruleCount: number): RunResult {
  return {
    code: ExitCode.Success,
    stdout: `Device ${serial} (${name})\nRules: ${ruleCount}\nLedger: empty\n`,
    stderr: "",
  }
}
