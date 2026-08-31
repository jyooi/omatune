import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeLayer, stubLayer, writeFakeDevice } from "@omatune/platform"
import { runMain } from "./main.ts"

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omatune-devices-"))
}

test("devices --json lists fake Devices with exit 0", async () => {
  const root = await makeRoot()
  await writeFakeDevice(root, {
    serial: "aaaaaaaaaaaaaaaa",
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes: 10 * 1024 * 1024 * 1024,
    owner: "omatune",
  })
  await writeFakeDevice(root, {
    serial: "bbbbbbbbbbbbbbbb",
    modelString: "MB562",
    filesystemType: "exfat",
    freeBytes: 1024,
    owner: "empty",
  })
  await writeFakeDevice(root, {
    serial: "cccccccccccccccc",
    modelString: "MC027",
    filesystemType: "FAT32",
    freeBytes: 2048,
    owner: "foreign",
  })

  const result = await runMain(["devices", "--json"], fakeLayer(root))
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  const lines = result.stdout.trim().split("\n")
  expect(lines).toHaveLength(3)
  const reports = lines.map((line) => JSON.parse(line) as Record<string, unknown>)

  expect(reports[0]).toMatchObject({
    serial: "aaaaaaaaaaaaaaaa",
    family: "iPod classic 120 GB (2008)",
    supportTier: "Verified",
    volumeFormat: "FAT32",
    freeSpaceBytes: 10 * 1024 * 1024 * 1024,
    ownerState: "omatune",
  })
  expect(typeof reports[0]?.mountPoint).toBe("string")
  expect(reports[0]?.notes).toEqual([])

  expect(reports[1]).toMatchObject({
    serial: "bbbbbbbbbbbbbbbb",
    ownerState: "unknown",
    volumeFormat: "exfat",
  })
  expect(reports[1]?.notes).toContain("Reformat the Device to FAT32.")

  expect(reports[2]).toMatchObject({
    serial: "cccccccccccccccc",
    family: "iPod nano 5G",
    supportTier: "Unsupported",
    ownerState: "foreign",
  })
  const notes = reports[2]?.notes as string[]
  expect(notes.some((note) => note.length > 0)).toBe(true)
})

test("devices prints a table of the same facts", async () => {
  const root = await makeRoot()
  await writeFakeDevice(root, {
    serial: "dddddddddddddddd",
    modelString: "MB562",
    filesystemType: "FAT32",
    freeBytes: 4096,
    owner: "omatune",
  })
  const result = await runMain(["devices"], fakeLayer(root))
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("dddddddddddddddd")
  expect(result.stdout).toContain("iPod classic 120 GB (2008)")
  expect(result.stdout).toContain("Verified")
  expect(result.stdout).toContain("FAT32")
  expect(result.stdout).toContain("omatune")
})

test("devices --json with no Devices prints nothing and exits 0", async () => {
  const root = await makeRoot()
  const result = await runMain(["devices", "--json"], fakeLayer(root))
  expect(result.code).toBe(0)
  expect(result.stdout).toBe("")
})

test("sync without --device is refused before change", async () => {
  const result = await runMain(["sync"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("sync needs --device. Pass --device SERIAL.")
})

test("bare command refuses when config is missing", async () => {
  const home = await makeRoot()
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/.config` }
  delete env.OMATUNE_CONFIG
  const result = await runMain([], stubLayer, env)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Wrote starter config")
  expect(result.stderr).toContain("library is not set")
  expect(result.stderr).toContain("Uncomment line 3")
})
