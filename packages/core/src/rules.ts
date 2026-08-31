import type { AppSelection, SelectionRule } from "./config.ts"
import { isSupportedExtension, type ScannedFile } from "./scan.ts"
import { isTranscodedExtension } from "./transcode-plan.ts"
import type { TrackTags } from "./tags.ts"

export type SkipReason =
  | "unsupported_format"
  | "unstorable_name"
  | "disk_full"
  | "transcode_failed"

export type SkippedTrack = {
  readonly path: string
  readonly reason: SkipReason
}

export type SelectedTrack = {
  readonly relativePath: string
  readonly size: number
  readonly mtimeMs: number
  readonly extension: string
  readonly tags: TrackTags
  readonly albumArtist: string
  readonly album: string
  /** True when a Sync converts this Track on the way to the Device. */
  readonly transcode: boolean
}

const FAT32_ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/
const FAT32_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
])

export function normaliseName(value: string): string {
  return value.trim().normalize("NFC").toUpperCase().toLowerCase()
}

export function albumIdentity(tags: TrackTags): { albumArtist: string; album: string } {
  const album = (tags.album ?? "").trim().normalize("NFC")
  if (tags.compilation) {
    return { albumArtist: "Various Artists", album }
  }
  const tagged = (tags.albumArtist ?? "").trim()
  const fallback = (tags.artist ?? "").trim()
  const albumArtist = (tagged.length > 0 ? tagged : fallback).normalize("NFC")
  return { albumArtist, album }
}

export function tagsAreReadable(tags: TrackTags | null): tags is TrackTags {
  if (tags === null) {
    return false
  }
  const title = (tags.title ?? "").trim()
  const artist = (tags.artist ?? "").trim()
  const album = (tags.album ?? "").trim()
  return title.length > 0 || artist.length > 0 || album.length > 0
}

export function isUnstorableName(relativePath: string): boolean {
  const parts = relativePath.split("/")
  for (const part of parts) {
    if (part.length === 0 || part.length > 255) {
      return true
    }
    if (FAT32_ILLEGAL.test(part)) {
      return true
    }
    if (part.endsWith(" ") || part.endsWith(".")) {
      return true
    }
    const stem = part.includes(".") ? part.slice(0, part.lastIndexOf(".")) : part
    if (FAT32_RESERVED.has(stem.toUpperCase())) {
      return true
    }
  }
  return false
}

export function pathMatches(rulePath: string, trackPath: string): boolean {
  const rule = rulePath.replaceAll("\\", "/")
  const path = trackPath.replaceAll("\\", "/")
  if (rule.includes("*")) {
    return globToRegExp(rule).test(path)
  }
  if (path === rule) {
    return true
  }
  const prefix = rule.endsWith("/") ? rule : `${rule}/`
  return path.startsWith(prefix)
}

export function evaluateSelection(
  files: ReadonlyArray<ScannedFile>,
  selection: AppSelection,
): {
  readonly selected: ReadonlyArray<SelectedTrack>
  readonly skipped: ReadonlyArray<SkippedTrack>
} {
  const selected: SelectedTrack[] = []
  const skipped: SkippedTrack[] = []
  for (const file of files) {
    const identity = tagsAreReadable(file.tags) ? albumIdentity(file.tags) : null
    if (!matchesSelection(file, identity, selection)) {
      continue
    }
    if (!isSupportedExtension(file.extension)) {
      skipped.push({ path: file.relativePath, reason: "unsupported_format" })
      continue
    }
    if (isUnstorableName(file.relativePath)) {
      skipped.push({ path: file.relativePath, reason: "unstorable_name" })
      continue
    }
    if (!identity || !file.tags) {
      continue
    }
    selected.push({
      relativePath: file.relativePath,
      size: file.size,
      mtimeMs: file.mtimeMs,
      extension: file.extension,
      tags: file.tags,
      albumArtist: identity.albumArtist,
      album: identity.album,
      transcode: isTranscodedExtension(file.extension),
    })
  }
  return { selected, skipped }
}

function matchesSelection(
  file: ScannedFile,
  identity: { albumArtist: string; album: string } | null,
  selection: AppSelection,
): boolean {
  const included = selection.include.some((rule) => ruleMatches(rule, file.relativePath, identity))
  if (!included) {
    return false
  }
  const excluded = selection.exclude.some((rule) => ruleMatches(rule, file.relativePath, identity))
  return !excluded
}

function ruleMatches(
  rule: SelectionRule,
  relativePath: string,
  identity: { albumArtist: string; album: string } | null,
): boolean {
  if (rule.kind === "path") {
    return pathMatches(rule.path, relativePath)
  }
  if (!identity) {
    return false
  }
  if (rule.kind === "album_artist") {
    return normaliseName(identity.albumArtist) === normaliseName(rule.albumArtist)
  }
  return (
    normaliseName(identity.albumArtist) === normaliseName(rule.albumArtist) &&
    normaliseName(identity.album) === normaliseName(rule.album)
  )
}

function globToRegExp(glob: string): RegExp {
  let out = "^"
  let i = 0
  while (i < glob.length) {
    const char = glob[i]
    if (char === "*" && glob[i + 1] === "*") {
      const next = glob[i + 2]
      if (next === "/") {
        out += "(?:.*/)?"
        i += 3
        continue
      }
      out += ".*"
      i += 2
      continue
    }
    if (char === "*") {
      out += "[^/]*"
      i += 1
      continue
    }
    if (char !== undefined && "\\^$+?.()|[]{}".includes(char)) {
      out += `\\${char}`
      i += 1
      continue
    }
    out += char
    i += 1
  }
  out += "$"
  return new RegExp(out)
}
