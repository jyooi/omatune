import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stubLayer } from "@omatune/platform"
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

async function writeConfig(
  dir: string,
  body: string,
  library?: string,
): Promise<{ library: string }> {
  const music = library ?? join(dir, "music")
  await mkdir(music, { recursive: true })
  await writeFile(join(dir, "config.toml"), body.replaceAll("LIBRARY", music))
  return { library: music }
}

async function status(
  dir: string,
  extra: string[] = [],
  env: NodeJS.ProcessEnv = testEnv(),
) {
  return runMain(["status", "--device", SERIAL, "--config", dir, ...extra], stubLayer, env)
}

test("first run writes a starter config and exits 1", async () => {
  const dir = await makeDir("omatune-first-run-")
  const result = await status(dir)
  expect(result.code).toBe(1)
  const path = join(dir, "config.toml")
  expect(result.stderr).toContain(path)
  const text = await Bun.file(path).text()
  expect(text).toContain("version = 1")
  expect(text).toContain("# library =")
  expect(text.includes("\nlibrary =")).toBe(false)
})

test("newer version exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-version-")
  await writeConfig(
    dir,
    `version = 2
library = "LIBRARY"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("config.toml:1:")
  expect(result.stderr).toContain("Unsupported version 2")
})

test("unknown key exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-unknown-key-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"
extra = true
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("config.toml:3:")
  expect(result.stderr).toContain("Unknown key extra")
})

test("wrong type exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-wrong-type-")
  await writeConfig(
    dir,
    `version = 1
library = 12
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("config.toml:2:")
  expect(result.stderr).toContain("Wrong type for library")
})

test("malformed Rule exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-malformed-rule-")
  const { library } = await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Classic"
`,
  )
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "selection.toml"),
    `version = 1

[[include]]
album = "OK Computer"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("selection.toml:")
  expect(result.stderr).toContain("Malformed Rule")
  expect(library.length).toBeGreaterThan(0)
})

test("absolute path Rule exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-abs-path-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Classic"
`,
  )
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "selection.toml"),
    `version = 1

[[include]]
path = "/etc/passwd"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("selection.toml:4:")
  expect(result.stderr).toContain("absolute")
})

test("dot-dot path Rule exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-dotdot-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Classic"
`,
  )
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "selection.toml"),
    `version = 1

[[include]]
path = "../outside"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("selection.toml:4:")
  expect(result.stderr).toContain("..")
})

test("unreadable Library root exits 1 with file, line, and reason", async () => {
  const dir = await makeDir("omatune-library-")
  await writeFile(
    join(dir, "config.toml"),
    `version = 1
library = "${join(dir, "missing-music")}"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("config.toml:2:")
  expect(result.stderr).toContain("Library root is not readable")
})

test("status prints Rule count and empty Ledger", async () => {
  const dir = await makeDir("omatune-status-ok-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Classic"
`,
  )
  await mkdir(join(dir, "devices", SERIAL), { recursive: true })
  await writeFile(
    join(dir, "devices", SERIAL, "selection.toml"),
    `version = 1

[[include]]
album_artist = "Radiohead"

[[include]]
album_artist = "Radiohead"
album = "OK Computer"

[[exclude]]
path = "Radiohead/bonus"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout).toContain(`Device ${SERIAL} (Classic)`)
  expect(result.stdout).toContain("Rules: 3")
  expect(result.stdout).toContain("Ledger: empty")
})

test("unknown Device prints offer text without --yes", async () => {
  const dir = await makeDir("omatune-unknown-device-")
  await writeConfig(
    dir,
    `version = 1
library = "LIBRARY"
`,
  )
  const result = await status(dir)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Unknown Device")
  expect(result.stderr).toContain("--yes")
  expect(await Bun.file(join(dir, "devices", SERIAL, "selection.toml")).exists()).toBe(false)
})

test("--yes appends an unknown Device and creates empty selection.toml", async () => {
  const dir = await makeDir("omatune-adopt-")
  await writeConfig(
    dir,
    `version = 1
# keep this comment
library = "LIBRARY"
`,
  )
  const result = await status(dir, ["--yes"])
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("Rules: 0")
  expect(result.stdout).toContain("Ledger: empty")
  const config = await Bun.file(join(dir, "config.toml")).text()
  expect(config).toContain("# keep this comment")
  expect(config).toContain(`[devices."${SERIAL}"]`)
  expect(config).toContain(`name = "${SERIAL}"`)
  const selection = await Bun.file(join(dir, "devices", SERIAL, "selection.toml")).text()
  expect(selection).toContain("version = 1")
  expect(selection).not.toContain("[[include]]")
})

test("--config overrides XDG_CONFIG_HOME", async () => {
  const xdg = await makeDir("omatune-xdg-")
  const flagged = await makeDir("omatune-flagged-")
  await mkdir(join(xdg, "omatune"), { recursive: true })
  await writeConfig(
    join(xdg, "omatune"),
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Xdg"
`,
  )
  await writeConfig(
    flagged,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Flag"
`,
  )
  const result = await runMain(
    ["status", "--device", SERIAL, "--config", flagged],
    stubLayer,
    testEnv({ XDG_CONFIG_HOME: xdg }),
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("(Flag)")
  expect(result.stdout).not.toContain("(Xdg)")
})

test("OMATUNE_CONFIG overrides --config", async () => {
  const flagged = await makeDir("omatune-flag-")
  const envDir = await makeDir("omatune-env-")
  await writeConfig(
    flagged,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Flag"
`,
  )
  await writeConfig(
    envDir,
    `version = 1
library = "LIBRARY"

[devices.${SERIAL}]
name = "Env"
`,
  )
  const result = await runMain(
    ["status", "--device", SERIAL, "--config", flagged],
    stubLayer,
    testEnv({ OMATUNE_CONFIG: envDir }),
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("(Env)")
  expect(result.stdout).not.toContain("(Flag)")
})

test("sync stays refused before change", async () => {
  const result = await runMain(["sync"], stubLayer, testEnv())
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("not implemented")
})
