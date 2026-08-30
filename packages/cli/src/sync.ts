import {
  ExitCode,
  resolveConfigDir,
  resolveDataDir,
  runSync,
  type SyncEvent,
  type SyncPlan,
} from "@omatune/core"
import type { Platform } from "@omatune/platform"
import { Effect, type Layer, Stream } from "effect"
import type { Flags, RunIo, RunResult } from "./flags.ts"
import { formatPlanText } from "./format.ts"

function refused(message: string, code: 0 | 1 | 2 = ExitCode.RefusedBeforeChange): RunResult {
  return { code, stdout: "", stderr: `${message}\n` }
}

export async function runSyncCommand(
  flags: Flags,
  layer: Layer.Layer<Platform>,
  env: NodeJS.ProcessEnv = process.env,
  io: RunIo = {},
): Promise<RunResult> {
  if (!flags.device) {
    return refused("sync needs --device.")
  }
  const configDir = resolveConfigDir({
    xdgConfigHome: env.XDG_CONFIG_HOME,
    home: env.HOME,
    flag: flags.config,
    envValue: env.OMATUNE_CONFIG,
  })
  const dataDir = resolveDataDir({
    xdgDataHome: env.XDG_DATA_HOME,
    home: env.HOME,
  })
  const events: SyncEvent[] = []
  const confirm = (plan: SyncPlan) => confirmSync(plan, flags, io)
  const write = io.stdoutWrite
  const program = Stream.runForEach(
    runSync({
      serial: flags.device,
      configDir,
      yes: flags.yes,
      noEject: flags.noEject,
      strict: flags.strict,
      forceModel: flags.forceModel,
      dataDir,
      confirm,
    }),
    (event) =>
      Effect.sync(() => {
        events.push(event)
        if (!write) {
          return
        }
        const chunk = formatLive(event, flags.json)
        if (chunk.length > 0) {
          write(chunk)
        }
      }),
  ).pipe(Effect.provide(layer), Effect.either)
  const result = await Effect.runPromise(program)
  if (result._tag === "Left") {
    const error = result.left
    const message = "message" in error ? String(error.message) : String(error)
    const code = "code" in error && (error.code === 1 || error.code === 2) ? error.code : ExitCode.RefusedBeforeChange
    return {
      code,
      stdout: write ? "" : renderEvents(events, flags.json, false),
      stderr: `${message}\n`,
    }
  }
  const report = events.find((event) => event.type === "report")
  const ejected = report?.type === "report" ? report.ejected : false
  return {
    code: ExitCode.Success,
    stdout: write ? "" : renderEvents(events, flags.json, ejected),
    stderr: "",
  }
}

async function confirmSync(plan: SyncPlan, flags: Flags, io: RunIo): Promise<boolean> {
  if (plan.kind === "wipe") {
    writePrompt("Wipe and Sync? ", io)
    const line = await readConfirmLine(io)
    return line.trim() === "wipe"
  }
  if (flags.yes) {
    return true
  }
  writePrompt("Sync now? [y/N] ", io)
  const line = await readConfirmLine(io)
  return line.trim().toLowerCase() === "y"
}

function writePrompt(text: string, io: RunIo): void {
  if (io.stderrWrite) {
    io.stderrWrite(text)
    return
  }
  if (typeof process.stderr.write === "function") {
    process.stderr.write(text)
  }
}

async function readConfirmLine(io: RunIo): Promise<string> {
  if (io.stdin !== undefined) {
    return io.stdin.split(/\r?\n/)[0] ?? ""
  }
  if (!process.stdin.isTTY) {
    return ""
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    if (Buffer.concat(chunks).toString("utf8").includes("\n")) {
      break
    }
  }
  return Buffer.concat(chunks).toString("utf8")
}

function formatLive(event: SyncEvent, json: boolean): string {
  if (json) {
    return `${JSON.stringify(event)}\n`
  }
  if (event.type === "plan") {
    return formatPlanText(event.plan)
  }
  if (event.type === "message") {
    return `${event.text}\n`
  }
  if (event.type === "report") {
    const lines = [
      `Added: ${event.added}`,
      `Removed: ${event.removed}`,
      `Kept: ${event.kept}`,
      `Skipped: ${event.skipped}`,
    ]
    for (const skip of event.artworkSkipped) {
      lines.push(`Skipped-for-artwork ${skip.path}: ${skip.reason}`)
    }
    if (event.ejected) {
      lines.push("Safe to unplug")
    }
    return `${lines.join("\n")}\n`
  }
  return ""
}

function renderEvents(events: ReadonlyArray<SyncEvent>, json: boolean, ejected: boolean): string {
  if (json) {
    if (events.length === 0) {
      return ""
    }
    return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
  }
  const lines: string[] = []
  for (const event of events) {
    if (event.type === "plan") {
      lines.push(formatPlanText(event.plan).trimEnd())
    }
    if (event.type === "message") {
      lines.push(event.text)
    }
    if (event.type === "report") {
      lines.push(`Added: ${event.added}`)
      lines.push(`Removed: ${event.removed}`)
      lines.push(`Kept: ${event.kept}`)
      lines.push(`Skipped: ${event.skipped}`)
      for (const skip of event.artworkSkipped) {
        lines.push(`Skipped-for-artwork ${skip.path}: ${skip.reason}`)
      }
    }
  }
  if (ejected) {
    lines.push("Safe to unplug")
  }
  if (lines.length === 0) {
    return ""
  }
  return `${lines.join("\n")}\n`
}
