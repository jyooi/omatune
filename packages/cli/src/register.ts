import {
  defaultDeviceName,
  ExitCode,
  formatConfigIssue,
  listDeviceReports,
  loadConfigDir,
  needsDeviceFlag,
  registerDevice,
  resolveConfigDir,
  starterConfigRefusal,
} from "@omatune/core"
import type { Platform } from "@omatune/platform"
import { Effect, type Layer } from "effect"
import type { Flags } from "./flags.ts"
import type { RunResult } from "./main.ts"

function refused(message: string): RunResult {
  return { code: ExitCode.RefusedBeforeChange, stdout: "", stderr: `${message}\n` }
}

export async function runRegister(
  flags: Flags,
  layer: Layer.Layer<Platform>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  if (!flags.device) {
    return refused(needsDeviceFlag("register"))
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
  const existing = loaded.config.devices.find((entry) => entry.serial === serial)
  if (existing) {
    return {
      code: ExitCode.Success,
      stdout: `Device ${serial} is already registered as "${existing.name}". Rename it in config.toml.\n`,
      stderr: "",
    }
  }
  const reports = await Effect.runPromise(listDeviceReports.pipe(Effect.provide(layer)))
  const report = reports.find((entry) => entry.serial === serial)
  const name = defaultDeviceName(report?.family ?? null, serial)
  const registered = await registerDevice(dir, serial, name)
  if (!registered.ok) {
    return refused(formatConfigIssue(registered.issue))
  }
  return {
    code: ExitCode.Success,
    stdout: `Registered Device ${registered.value.serial} as "${registered.value.name}" in config.toml. Rename it there any time.\n`,
    stderr: "",
  }
}
