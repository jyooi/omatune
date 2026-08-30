import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireSerialLock, processIsAlive, releaseSerialLock, syncLockPath } from "./lock.ts"

test("a live lock pid is refused and a dead pid is taken over", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omatune-lock-"))
  const serial = "aaaaaaaaaaaaaaaa"
  const path = syncLockPath(dir, serial)
  await mkdir(join(dir, "devices", serial), { recursive: true })
  await writeFile(path, `${process.pid}\n`)
  expect(processIsAlive(process.pid)).toBe(true)
  await expect(acquireSerialLock(dir, serial)).rejects.toThrow("locked")
  const child = Bun.spawn(["sleep", "30"])
  const pid = child.pid
  child.kill()
  await child.exited
  expect(processIsAlive(pid)).toBe(false)
  await writeFile(path, `${pid}\n`)
  const taken = await acquireSerialLock(dir, serial)
  expect(taken).toBe(path)
  expect(await Bun.file(path).text()).toBe(`${process.pid}\n`)
  await releaseSerialLock(path)
  expect(await Bun.file(path).exists()).toBe(false)
})
