import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeLayer, stubLayer, writeFakeDevice } from "@omatune/platform"
import { runMain } from "./main.ts"

const SERIAL = "aaaaaaaaaaaaaaaa"

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.OMATUNE_CONFIG
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  return env
}

async function makeDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

async function writeConfig(dir: string, body: string, library?: string): Promise<{ library: string }> {
  const music = library ?? join(dir, "music")
  await mkdir(music, { recursive: true })
  await writeFile(join(dir, "config.toml"), body.replaceAll("LIBRARY", music))
  return { library: music }
}

async function register(
  dir: string,
  layer: Parameters<typeof runMain>[1] = stubLayer,
  extra: string[] = [],
) {
  return runMain(["register", "--device", SERIAL, "--config", dir, ...extra], layer, testEnv())
}

test("register needs --device", async () => {
  const dir = await makeDir("omatune-register-noargs-")
  const result = await runMain(["register", "--config", dir], stubLayer, testEnv())
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("register needs --device")
})

test("register writes config.toml with the serial as the fallback name", async () => {
  const dir = await makeDir("omatune-register-fallback-")
  await writeConfig(
    dir,
    `version = 1
# keep this comment
library = "LIBRARY"
`,
  )
  const result = await register(dir)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain(SERIAL)
  expect(result.stdout).toContain("config.toml")
  const config = await Bun.file(join(dir, "config.toml")).text()
  expect(config).toContain("# keep this comment")
  expect(config).toContain(`[devices."${SERIAL}"]`)
  expect(config).toContain(`name = "${SERIAL}"`)
  const selection = await Bun.file(join(dir, "devices", SERIAL, "selection.toml")).text()
  expect(selection).toContain("version = 1")
  expect(selection).not.toContain("[[include]]")
})

test("register names an attached, known Device by family and size", async () => {
  const dir = await makeDir("omatune-register-family-")
  const fake = await makeDir("omatune-register-fake-")
  await writeConfig(dir, `version = 1\nlibrary = "LIBRARY"\n`)
  await writeFakeDevice(fake, {
    serial: SERIAL,
    modelString: "MB562",
    filesystemType: "FAT32",
    owner: "omatune",
  })
  const result = await register(dir, fakeLayer(fake))
  expect(result.code).toBe(0)
  const config = await Bun.file(join(dir, "config.toml")).text()
  expect(config).toContain(`name = "Classic 120GB"`)
})

test("register on an already-registered Device does not duplicate the entry", async () => {
  const dir = await makeDir("omatune-register-twice-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "My iPod"
`,
  )
  const result = await register(dir)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("already registered")
  expect(result.stdout).toContain("My iPod")
  const config = await Bun.file(join(dir, "config.toml")).text()
  expect(config.match(new RegExp(`\\[devices\\.${SERIAL}\\]|\\[devices\\."${SERIAL}"\\]`, "gi"))?.length).toBe(1)
})

test("register on a first run offers the starter config refusal", async () => {
  const dir = await makeDir("omatune-register-first-run-")
  const result = await register(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("library is not set")
})
