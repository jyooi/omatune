import { ExitCode, listDeviceReports } from "@omatune/core"
import { fakeLayer, linuxLayer, stubLayer, type Platform } from "@omatune/platform"
import { runTui } from "@omatune/tui"
import { Effect, type Layer } from "effect"
import { parseArgv } from "./flags.ts"
import { formatJson, formatTable } from "./format.ts"
import { runPlan } from "./plan.ts"
import { runStatus } from "./status.ts"

export type RunResult = {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const NOT_IMPLEMENTED = new Set(["sync"])

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
): Promise<RunResult> {
  const parsed = parseArgv(argv)
  if ("message" in parsed) {
    return refused(parsed.message)
  }

  if (parsed.subcommand === null) {
    const tui = runTui()
    return { code: tui.code, stdout: tui.stdout, stderr: tui.stderr }
  }

  if (parsed.subcommand === "status") {
    return runStatus(parsed, env)
  }

  if (parsed.subcommand === "plan") {
    return runPlan(parsed, layer, env)
  }

  if (NOT_IMPLEMENTED.has(parsed.subcommand)) {
    return refused(`${parsed.subcommand} is not implemented.`)
  }

  if (parsed.subcommand !== "devices") {
    return refused(`Unknown command ${parsed.subcommand}.`)
  }

  const program = listDeviceReports.pipe(
    Effect.map((reports) => {
      const stdout = parsed.json ? formatJson(reports) : formatTable(reports)
      return { code: ExitCode.Success, stdout, stderr: "" } satisfies RunResult
    }),
    Effect.provide(layer),
    Effect.catchAllDefect((defect) =>
      Effect.succeed(
        refused(defect instanceof Error ? defect.message : String(defect)),
      ),
    ),
  )

  return Effect.runPromise(program)
}
