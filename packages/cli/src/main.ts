import { ExitCode, listDeviceReports, unknownCommand } from "@omatune/core"
import { fakeLayer, linuxLayer, stubLayer, type Platform } from "@omatune/platform"
import { runTui } from "@omatune/tui"
import { Effect, type Layer } from "effect"
import { parseArgv, type RunIo, type RunResult } from "./flags.ts"
import { formatJson, formatTable } from "./format.ts"
import { runPlan } from "./plan.ts"
import { runStatus } from "./status.ts"
import { runSyncCommand } from "./sync.ts"

export type { RunIo, RunResult } from "./flags.ts"

function refused(message: string): RunResult {
  return { code: ExitCode.RefusedBeforeChange, stdout: "", stderr: `${message}\n` }
}

function defaultLayer(): Layer.Layer<Platform> {
  const fakeRoot = process.env.OMATUNE_FAKE_PLATFORM
  if (fakeRoot) {
    return fakeLayer(fakeRoot)
  }
  if (process.platform === "linux") {
    return linuxLayer
  }
  return stubLayer
}

export async function runMain(
  argv: ReadonlyArray<string>,
  layer: Layer.Layer<Platform> = defaultLayer(),
  env: NodeJS.ProcessEnv = process.env,
  io: RunIo = {},
): Promise<RunResult> {
  const platformLayer = layer ?? defaultLayer()
  const parsed = parseArgv(argv)
  if ("message" in parsed) {
    return refused(parsed.message)
  }

  if (parsed.subcommand === null) {
    return runTui({
      config: parsed.config,
      device: parsed.device,
      yes: parsed.yes,
      noEject: parsed.noEject,
      strict: parsed.strict,
      forceModel: parsed.forceModel,
      layer: platformLayer,
      env,
    })
  }

  if (parsed.subcommand === "status") {
    return runStatus(parsed, env)
  }

  if (parsed.subcommand === "plan") {
    return runPlan(parsed, platformLayer, env)
  }

  if (parsed.subcommand === "sync") {
    return runSyncCommand(parsed, platformLayer, env, io)
  }

  if (parsed.subcommand !== "devices") {
    return refused(unknownCommand(parsed.subcommand))
  }

  const program = listDeviceReports.pipe(
    Effect.map((reports) => {
      const stdout = parsed.json ? formatJson(reports) : formatTable(reports)
      return { code: ExitCode.Success, stdout, stderr: "" } satisfies RunResult
    }),
    Effect.provide(platformLayer),
    Effect.catchAllDefect((defect) =>
      Effect.succeed(
        refused(defect instanceof Error ? defect.message : String(defect)),
      ),
    ),
  )

  return Effect.runPromise(program)
}
