import { expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

type WorkflowStep = {
  run?: string
  uses?: string
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
  expect(pkgbuild.includes("omatune-linux-x64")).toBe(true)
  expect(pkgbuild.includes("omatune-linux-arm64")).toBe(true)
  const formula = await Bun.file(join(root, "packaging/homebrew/omatune.rb")).text()
  expect(formula.includes("class Omatune")).toBe(true)
  expect(formula.includes("omatune-darwin-arm64")).toBe(true)
  expect(formula.includes("omatune-darwin-x64")).toBe(true)
  expect(formula.includes('bin.install binary => "omatune"')).toBe(true)
})
