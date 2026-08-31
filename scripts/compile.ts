#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

export const BUN_VERSION = "1.4.0"
export const OPENTUI_CORE_VERSION = "0.5.9"

export type TargetName = "linux-x64" | "linux-arm64" | "darwin-arm64" | "darwin-x64"

export type CompileTarget = {
  readonly name: TargetName
  readonly bunTarget: Bun.Build.CompileTarget
  readonly libc: "glibc" | null
  readonly budgetBytes: number
}

export const TARGETS: ReadonlyArray<CompileTarget> = [
  { name: "linux-x64", bunTarget: "bun-linux-x64", libc: "glibc", budgetBytes: 125 * 1024 * 1024 },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", libc: "glibc", budgetBytes: 125 * 1024 * 1024 },
  { name: "darwin-arm64", bunTarget: "bun-darwin-arm64", libc: null, budgetBytes: 75 * 1024 * 1024 },
  { name: "darwin-x64", bunTarget: "bun-darwin-x64", libc: null, budgetBytes: 75 * 1024 * 1024 },
]

const NATIVE_PACKAGES: Record<TargetName, string> = {
  "linux-x64": "@opentui/core-linux-x64",
  "linux-arm64": "@opentui/core-linux-arm64",
  "darwin-arm64": "@opentui/core-darwin-arm64",
  "darwin-x64": "@opentui/core-darwin-x64",
}

export function hostTarget(): TargetName {
  const key = `${process.platform}-${process.arch}`
  if (key === "linux-x64") return "linux-x64"
  if (key === "linux-arm64") return "linux-arm64"
  if (key === "darwin-arm64") return "darwin-arm64"
  if (key === "darwin-x64") return "darwin-x64"
  throw new Error(`No compile target for ${key}.`)
}

export function binaryName(name: TargetName): string {
  return `omatune-${name}`
}

function repoRoot(): string {
  return join(import.meta.dir, "..")
}

export function assertToolPins(): void {
  if (Bun.version !== BUN_VERSION) {
    throw new Error(`Bun must be ${BUN_VERSION}. This host has ${Bun.version}.`)
  }
  const tuiPath = join(repoRoot(), "packages/tui/package.json")
  const tui = Bun.file(tuiPath)
  if (tui.size === 0) {
    throw new Error("packages/tui/package.json is missing.")
  }
}

export async function opentuiCoreVersion(): Promise<string> {
  const tui = (await Bun.file(join(repoRoot(), "packages/tui/package.json")).json()) as {
    dependencies?: { "@opentui/core"?: string }
  }
  const version = tui.dependencies?.["@opentui/core"]
  if (version !== OPENTUI_CORE_VERSION) {
    throw new Error(`@opentui/core must be ${OPENTUI_CORE_VERSION}. Found ${version ?? "none"}.`)
  }
  return version
}

export async function assertNativePackage(name: TargetName): Promise<void> {
  const pkg = NATIVE_PACKAGES[name]
  const result = Bun.spawnSync(["bun", "pm", "ls", "--all"], {
    cwd: repoRoot(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const text = result.stdout.toString() + result.stderr.toString()
  if (!text.includes(`${pkg}@`)) {
    throw new Error(`Missing ${pkg}. Run bun install --os="*" --cpu="*" then compile again.`)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function compileTarget(target: CompileTarget, outdir: string): Promise<{ path: string; bytes: number }> {
  await assertNativePackage(target.name)
  await mkdir(outdir, { recursive: true })
  const outfile = join(outdir, binaryName(target.name))
  const previousLibc = process.env.OPENTUI_LIBC
  if (target.libc) {
    process.env.OPENTUI_LIBC = target.libc
  } else {
    delete process.env.OPENTUI_LIBC
  }
  const define: Record<string, string> = {}
  if (target.libc) {
    define["process.env.OPENTUI_LIBC"] = JSON.stringify(target.libc)
  }
  try {
    const result = await Bun.build({
      entrypoints: [join(repoRoot(), "packages/cli/src/bin.ts")],
      outfile,
      target: "bun",
      define,
      compile: {
        target: target.bunTarget,
        outfile,
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
    })
    if (!result.success) {
      const detail = result.logs.map((log) => String(log)).join("\n")
      throw new Error(`Compile failed for ${target.name}.\n${detail}`)
    }
  } finally {
    if (previousLibc === undefined) {
      delete process.env.OPENTUI_LIBC
    } else {
      process.env.OPENTUI_LIBC = previousLibc
    }
  }
  const file = Bun.file(outfile)
  const bytes = file.size
  if (bytes === 0) {
    throw new Error(`Compile wrote an empty file for ${target.name}.`)
  }
  return { path: outfile, bytes }
}

function parseArgs(argv: ReadonlyArray<string>): { targets: ReadonlyArray<CompileTarget>; outdir: string } {
  let names: TargetName[] | "host" | "all" = "all"
  let outdir = join(repoRoot(), "dist")
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--host") {
      names = "host"
      continue
    }
    if (arg === "--target") {
      const value = argv[i + 1]
      if (!value) {
        throw new Error("--target needs a value.")
      }
      const match = TARGETS.find((target) => target.name === value)
      if (!match) {
        throw new Error(`Unknown target ${value}.`)
      }
      names = [match.name]
      i += 1
      continue
    }
    if (arg === "--outdir") {
      const value = argv[i + 1]
      if (!value) {
        throw new Error("--outdir needs a value.")
      }
      outdir = value
      i += 1
      continue
    }
    throw new Error(`Unknown argument ${arg}.`)
  }
  if (names === "all") {
    return { targets: TARGETS, outdir }
  }
  if (names === "host") {
    const name = hostTarget()
    const target = TARGETS.find((item) => item.name === name)
    if (!target) {
      throw new Error(`No compile target for host ${name}.`)
    }
    return { targets: [target], outdir }
  }
  return {
    targets: TARGETS.filter((target) => names.includes(target.name)),
    outdir,
  }
}

async function main(): Promise<void> {
  assertToolPins()
  await opentuiCoreVersion()
  const { targets, outdir } = parseArgs(Bun.argv.slice(2))
  for (const target of targets) {
    const compiled = await compileTarget(target, outdir)
    const over = compiled.bytes > target.budgetBytes ? " over budget" : ""
    console.log(`${target.name} ${formatMb(compiled.bytes)} (budget ${formatMb(target.budgetBytes)})${over}`)
    console.log(compiled.path)
  }
}

if (import.meta.main) {
  await main()
}
