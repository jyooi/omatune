import { expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

type WorkflowStep = {
  run?: string
  uses?: string
  if?: string
  with?: { "bun-version"?: string }
}

type TestJob = {
  "runs-on"?: string
  strategy?: {
    matrix?: {
      include?: Array<{ os?: string; target?: string; libc?: string }>
    }
  }
  steps?: WorkflowStep[]
}

type ReleaseJob = {
  "runs-on"?: string
  permissions?: { contents?: string }
  steps?: WorkflowStep[]
}

function bashAssign(text: string, name: string): string | undefined {
  const prefix = `${name}=`
  const line = text.split("\n").find((row) => row.startsWith(prefix))
  return line?.slice(prefix.length)
}

function unwrapBashValue(raw: string): string {
  let value = raw.trim()
  if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1).trim()
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
  }
  return value
}

function sourceAsset(assignment: string | undefined): string | undefined {
  if (assignment === undefined) {
    return undefined
  }
  const value = unwrapBashValue(assignment)
  const url = value.includes("::") ? value.slice(value.indexOf("::") + 2) : value
  const parts = url.split("/")
  return parts[parts.length - 1]
}

function packageDest(pkgbuild: string): string | undefined {
  for (const row of pkgbuild.split("\n")) {
    const trimmed = row.trim()
    if (!trimmed.startsWith("install ")) {
      continue
    }
    const dest = trimmed.split(/\s+/u).at(-1)
    if (dest === undefined) {
      return undefined
    }
    return dest.replaceAll('"', "").replace("${pkgdir}", "")
  }
  return undefined
}

function formulaClass(text: string): string | undefined {
  const line = text.split("\n").find((row) => row.startsWith("class ") && row.includes(" < Formula"))
  return line?.slice("class ".length).split(" ")[0]
}

function quotedField(text: string, key: string): string[] {
  const prefix = `${key} "`
  const values: string[] = []
  for (const row of text.split("\n")) {
    const trimmed = row.trim()
    if (!trimmed.startsWith(prefix) || !trimmed.endsWith('"')) {
      continue
    }
    values.push(trimmed.slice(prefix.length, -1))
  }
  return values
}

function formulaInstallName(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith("bin.install "))
  if (line === undefined) {
    return undefined
  }
  const marker = '=> "'
  const index = line.indexOf(marker)
  if (index < 0) {
    return undefined
  }
  const rest = line.slice(index + marker.length)
  return rest.endsWith('"') ? rest.slice(0, -1) : rest
}

function aptPackages(run: string | undefined): string[] {
  if (run === undefined) {
    return []
  }
  const commands = run.split("&&").map((part) => part.trim())
  const install = commands.find((command) => {
    const tokens = command.split(/\s+/u)
    return tokens.includes("apt-get") && tokens.includes("install")
  })
  if (install === undefined) {
    return []
  }
  return install.split(/\s+/u).filter((token) => token !== "sudo" && token !== "apt-get" && token !== "install" && !token.startsWith("-"))
}

test("test workflow runs workspace tests and a pty binary on Linux and macOS", async () => {
  const workflow = Bun.YAML.parse(await Bun.file(join(root, ".github/workflows/test.yml")).text()) as {
    jobs?: { test?: TestJob }
  }
  const job = workflow.jobs?.test
  const include = job?.strategy?.matrix?.include ?? []
  expect(include.map((row) => row.os)).toEqual(["ubuntu-latest", "macos-latest"])
  expect(include.map((row) => row.target)).toEqual(["linux-x64", "darwin-arm64"])
  expect(job?.["runs-on"]).toBe("${{ matrix.os }}")
  const steps = job?.steps ?? []
  const bunSetup = steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"))
  expect(bunSetup?.with?.["bun-version"]).toBe("1.4.0")
  const runs = steps.map((step) => step.run)
  expect(runs).toContain("bun install --frozen-lockfile --os=\"*\" --cpu=\"*\"")
  expect(runs).toContain("bun test")
  expect(runs).toContain("bun scripts/render.ts --check")
  expect(runs).toContain("bun scripts/compile.ts --target ${{ matrix.target }}")
  expect(runs).toContain("bun scripts/pty-devices.ts dist/omatune-${{ matrix.target }}")
  const linuxPrep = steps.find((step) => step.if === "runner.os == 'Linux'")
  expect(aptPackages(linuxPrep?.run)).toContain("udisks2")
})

test("release workflow attaches four binaries on a tag", async () => {
  const workflow = Bun.YAML.parse(await Bun.file(join(root, ".github/workflows/release.yml")).text()) as {
    on?: { push?: { tags?: string[] } }
    jobs?: { release?: ReleaseJob }
  }
  expect(workflow.on?.push?.tags).toEqual(["v*"])
  const job = workflow.jobs?.release
  expect(job?.permissions?.contents).toBe("write")
  const attach = job?.steps?.find((step) => step.run?.includes("gh release"))
  expect(attach?.run).toContain("omatune-linux-x64")
  expect(attach?.run).toContain("omatune-linux-arm64")
  expect(attach?.run).toContain("omatune-darwin-arm64")
  expect(attach?.run).toContain("omatune-darwin-x64")
  expect(job?.steps?.some((step) => step.run === "bun scripts/compile.ts")).toBe(true)
})

test("AUR and Homebrew manifests install GitHub Release binaries", async () => {
  const pkgbuild = await Bun.file(join(root, "packaging/aur/omatune-bin/PKGBUILD")).text()
  expect(bashAssign(pkgbuild, "pkgname")).toBe("omatune-bin")
  expect(bashAssign(pkgbuild, "options")).toBe("('!strip')")
  expect(sourceAsset(bashAssign(pkgbuild, "source_x86_64"))).toBe("omatune-linux-x64")
  expect(sourceAsset(bashAssign(pkgbuild, "source_aarch64"))).toBe("omatune-linux-arm64")
  expect(packageDest(pkgbuild)).toBe("/usr/bin/omatune")
  const formula = await Bun.file(join(root, "packaging/homebrew/omatune.rb")).text()
  expect(formulaClass(formula)).toBe("Omatune")
  expect(quotedField(formula, "url").map((url) => url.split("/").at(-1))).toEqual([
    "omatune-darwin-arm64",
    "omatune-darwin-x64",
  ])
  expect(formulaInstallName(formula)).toBe("omatune")
})
