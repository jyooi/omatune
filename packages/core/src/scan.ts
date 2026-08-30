import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { readTrackTags, type TrackTags } from "./tags.ts"

export type ScannedFile = {
  readonly relativePath: string
  readonly size: number
  readonly mtimeMs: number
  readonly extension: string
  readonly tags: TrackTags | null
}

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "mp4",
  "aac",
  "wav",
  "flac",
  "ogg",
  "opus",
  "wma",
  "aiff",
  "aif",
])

const SUPPORTED_EXTENSIONS = new Set(["mp3", "m4a"])

export function extensionOf(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return ""
  }
  return base.slice(dot + 1).toLowerCase()
}

export function isAudioExtension(extension: string): boolean {
  return AUDIO_EXTENSIONS.has(extension)
}

export function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extension)
}

export async function scanLibrary(root: string): Promise<ReadonlyArray<ScannedFile>> {
  const files: ScannedFile[] = []
  await walk(root, "", files)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return files
}

async function walk(absDir: string, relDir: string, out: ScannedFile[]): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true })
  for (const entry of entries) {
    const relativePath = relDir === "" ? entry.name : `${relDir}/${entry.name}`
    const absPath = join(absDir, entry.name)
    if (entry.isDirectory()) {
      await walk(absPath, relativePath, out)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const extension = extensionOf(relativePath)
    if (!isAudioExtension(extension)) {
      continue
    }
    const info = await stat(absPath)
    let tags: TrackTags | null = null
    if (isSupportedExtension(extension)) {
      try {
        const bytes = new Uint8Array(await Bun.file(absPath).arrayBuffer())
        tags = readTrackTags(bytes)
      } catch {
        tags = null
      }
    }
    out.push({
      relativePath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      extension,
      tags,
    })
  }
}
