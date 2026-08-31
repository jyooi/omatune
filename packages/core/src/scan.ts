import { readdir, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { isFlac, readTrackTags, type TrackTags } from "./tags.ts"

export type ScannedFile = {
  readonly relativePath: string
  readonly size: number
  readonly mtimeMs: number
  readonly extension: string
  readonly tags: TrackTags | null
}

export type UnlistedFile = {
  readonly relativePath: string
  readonly reason: string
}

export type LibraryScan = {
  readonly files: ReadonlyArray<ScannedFile>
  readonly unlisted: ReadonlyArray<UnlistedFile>
}

const SUPPORTED_EXTENSIONS = new Set(["mp3", "m4a", "flac"])

/*
 * Companion files stay silent so Unlisted stays signal.
 * Images: jpg, jpeg, png, gif, webp, bmp, tif, tiff.
 * Notes: txt, md, nfo, cue, log, pdf.
 * Playlists: m3u, m3u8, pls.
 * Hidden: a path component that starts with a dot.
 */
const COMPANION_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "txt",
  "md",
  "nfo",
  "cue",
  "log",
  "pdf",
  "m3u",
  "m3u8",
  "pls",
])

export const UNLISTED_RENAME_ALAC = "rename .alac to .m4a"
export const UNLISTED_MISSING_TAGS = "missing artist/album tags"
export const UNLISTED_UNREADABLE = "unreadable tags"

export function unsupportedFormatReason(extension: string): string {
  if (extension.length === 0) {
    return "unsupported format"
  }
  return `unsupported format (${extension})`
}

export function extensionOf(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return ""
  }
  return base.slice(dot + 1).toLowerCase()
}

export function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extension)
}

export function isCompanionPath(relativePath: string): boolean {
  const parts = relativePath.split("/")
  for (const part of parts) {
    if (part.startsWith(".")) {
      return true
    }
  }
  return COMPANION_EXTENSIONS.has(extensionOf(relativePath))
}

export function canAppearAsTrack(tags: TrackTags): boolean {
  const album = (tags.album ?? "").trim()
  if (album.length === 0) {
    return false
  }
  if (tags.compilation) {
    return true
  }
  const tagged = (tags.albumArtist ?? "").trim()
  const fallback = (tags.artist ?? "").trim()
  return tagged.length > 0 || fallback.length > 0
}

export async function scanLibrary(root: string): Promise<LibraryScan> {
  const files: ScannedFile[] = []
  const unlisted: UnlistedFile[] = []
  const visited = new Set<string>()
  visited.add(await realpath(root))
  await walk(root, "", files, unlisted, visited)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  unlisted.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return { files, unlisted }
}

async function walk(
  absDir: string,
  relDir: string,
  files: ScannedFile[],
  unlisted: UnlistedFile[],
  visited: Set<string>,
): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue
    }
    const relativePath = relDir === "" ? entry.name : `${relDir}/${entry.name}`
    const absPath = join(absDir, entry.name)
    let resolved: string
    try {
      resolved = await realpath(absPath)
    } catch {
      continue
    }
    if (visited.has(resolved)) {
      continue
    }
    visited.add(resolved)
    let info
    try {
      info = await stat(resolved)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      await walk(absPath, relativePath, files, unlisted, visited)
      continue
    }
    if (!info.isFile()) {
      continue
    }
    if (isCompanionPath(relativePath)) {
      continue
    }
    const classified = await classifyFile(resolved, relativePath, info.size, info.mtimeMs)
    if (classified.kind === "track") {
      files.push(classified.file)
    } else {
      unlisted.push({ relativePath, reason: classified.reason })
    }
  }
}

type Classified =
  | { readonly kind: "track"; readonly file: ScannedFile }
  | { readonly kind: "unlisted"; readonly reason: string }

async function classifyFile(
  absPath: string,
  relativePath: string,
  size: number,
  mtimeMs: number,
): Promise<Classified> {
  const extension = extensionOf(relativePath)
  if (extension === "alac") {
    return { kind: "unlisted", reason: UNLISTED_RENAME_ALAC }
  }
  if (!isSupportedExtension(extension)) {
    return { kind: "unlisted", reason: unsupportedFormatReason(extension) }
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await Bun.file(absPath).arrayBuffer())
  } catch {
    return { kind: "unlisted", reason: UNLISTED_UNREADABLE }
  }
  if (!looksLikeSupported(extension, bytes)) {
    return { kind: "unlisted", reason: UNLISTED_UNREADABLE }
  }
  let tags: TrackTags
  try {
    tags = readTrackTags(bytes)
  } catch {
    return { kind: "unlisted", reason: UNLISTED_UNREADABLE }
  }
  if (!canAppearAsTrack(tags)) {
    return { kind: "unlisted", reason: UNLISTED_MISSING_TAGS }
  }
  return {
    kind: "track",
    file: {
      relativePath,
      size,
      mtimeMs,
      extension,
      tags,
    },
  }
}

function looksLikeSupported(extension: string, bytes: Uint8Array): boolean {
  if (extension === "flac") {
    return isFlac(bytes)
  }
  if (extension === "mp3") {
    return looksLikeMp3(bytes)
  }
  if (extension === "m4a") {
    return looksLikeM4a(bytes)
  }
  return false
}

function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true
  }
  const limit = Math.min(bytes.length - 1, 8192)
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0xff && ((bytes[i + 1] ?? 0) & 0xe0) === 0xe0) {
      return true
    }
  }
  return false
}

function looksLikeM4a(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false
  }
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
}
