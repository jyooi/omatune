import { mkdir, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export function syncLockPath(configDir: string, serial: string): string {
  return join(configDir, "devices", serial.toLowerCase(), "sync.lock")
}

export async function acquireSerialLock(configDir: string, serial: string): Promise<string> {
  const path = syncLockPath(configDir, serial)
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, `${process.pid}\n`, { flag: "wx" })
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code === "EEXIST") {
      throw new Error(`Device ${serial} is locked.`)
    }
    throw cause
  }
  return path
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
