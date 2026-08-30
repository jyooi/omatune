import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export function syncLockPath(configDir: string, serial: string): string {
  return join(configDir, "devices", serial.toLowerCase(), "sync.lock")
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readLockPid(path: string): Promise<number | null> {
  try {
    const text = await readFile(path, "utf8")
    const pid = Number.parseInt(text.trim(), 10)
    if (!Number.isInteger(pid) || pid <= 0) {
      return null
    }
    return pid
  } catch {
    return null
  }
}

export async function acquireSerialLock(configDir: string, serial: string): Promise<string> {
  const path = syncLockPath(configDir, serial)
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, `${process.pid}\n`, { flag: "wx" })
      return path
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (code !== "EEXIST") {
        throw cause
      }
      const pid = await readLockPid(path)
      if (pid !== null && processIsAlive(pid)) {
        throw new Error(`Device ${serial} is locked.`)
      }
      try {
        await unlink(path)
      } catch (unlinkCause) {
        const unlinkCode = (unlinkCause as { code?: string }).code
        if (unlinkCode !== "ENOENT") {
          throw unlinkCause
        }
      }
    }
  }
  throw new Error(`Device ${serial} is locked.`)
}

export async function releaseSerialLock(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code !== "ENOENT") {
      throw cause
    }
  }
}
