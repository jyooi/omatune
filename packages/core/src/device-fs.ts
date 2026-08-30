import { mkdir, open, readdir, rename, rm, stat, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"

export const COPY_CHUNK_BYTES = 4 * 1024 * 1024
export const HASH_AHEAD = 4

export const WIPE_DIRS = ["Music", "iTunes", "Artwork"] as const

export const SYNCING_MARKER = join("iPod_Control", "omatune.syncing")
export const OWNER_JSON = join("iPod_Control", "omatune.json")
export const ITUNESDB = join("iPod_Control", "iTunes", "iTunesDB")
export const PLAY_COUNTS = join("iPod_Control", "iTunes", "Play Counts")
export const ARTWORK_DIR = join("iPod_Control", "Artwork")
export const ARTWORKDB = join(ARTWORK_DIR, "ArtworkDB")

export async function copyFileChunked(source: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const input = await open(source, "r")
  try {
    const output = await open(dest, "w")
    const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
    let offset = 0
    let outOffset = 0
    try {
      while (true) {
        const read = await input.read(buffer, 0, buffer.length, offset)
        if (read.bytesRead === 0) {
          break
        }
        await output.write(buffer, 0, read.bytesRead, outOffset)
        offset += read.bytesRead
        outOffset += read.bytesRead
      }
      await output.sync()
    } finally {
      await output.close()
    }
  } finally {
    await input.close()
  }
}

export async function wipeIpodControl(mountPoint: string): Promise<void> {
  for (const dir of WIPE_DIRS) {
    await rm(join(mountPoint, "iPod_Control", dir), { recursive: true, force: true })
  }
}

export async function listMusicFiles(mountPoint: string): Promise<string[]> {
  const root = join(mountPoint, "iPod_Control", "Music")
  return relativeFiles(root, "iPod_Control/Music")
}

async function relativeFiles(abs: string, prefix: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code === "ENOENT") {
      return []
    }
    throw cause
  }
  const out: string[] = []
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`
    const child = join(abs, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await relativeFiles(child, rel)))
      continue
    }
    if (entry.isFile()) {
      out.push(rel)
    }
  }
  return out
}

export async function deleteDeviceFile(mountPoint: string, devicePath: string): Promise<void> {
  try {
    await unlink(join(mountPoint, devicePath))
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code !== "ENOENT") {
      throw cause
    }
  }
}

export async function writeFileAtomic(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await Bun.write(tmp, bytes)
  await rename(tmp, path)
}

export async function pathExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

export async function presentWithSize(path: string, size: number): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size === size
  } catch {
    return false
  }
}

export async function fileSizeOrZero(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}
