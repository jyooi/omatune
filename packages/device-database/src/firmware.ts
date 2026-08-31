/*
 * Rules the stock firmware needs before it loads an iTunesDB.
 *
 * A Device Database can parse cleanly, carry a valid hash58, and still be
 * skipped whole by the firmware. When that happens the Device lists no
 * Track, no artist, and no album, and it never writes Play Data back.
 *
 * Every rule here comes from one source: a genuine iTunes-written database
 * from the reference iPod classic 120 GB. A rule earns its place only when
 * every Track in that Fixture obeys it. The golden tests check that.
 *
 * HUF-283 found the first rule the hard way, on real hardware. The writer
 * left the media type at zero, and the firmware skipped all 14 Tracks.
 * Restoring that one field alone brought the whole Library back.
 */

import { readU16, readU32 } from "./bytes.ts"
import type { Chunk } from "./chunk.ts"
import { mhsdType, type Itunesdb } from "./codec.ts"

/** Media type. iTunes writes 1 on every audio Track. Zero hides the Library. */
export const MHIT_MEDIA_TYPE = 0xcc
/** Unknown. iTunes writes 1 next to the media type on every audio Track. */
export const MHIT_UNKNOWN_D0 = 0xd0
/** File type, a four character code such as "M4A " or "MP3 ", stored reversed. */
export const MHIT_FILE_TYPE = 0x18
/** Format byte pair. iTunes writes 1 and 0 for MPEG-4, and 0 and 1 for MP3. */
export const MHIT_TYPE_1 = 0x1c
export const MHIT_TYPE_2 = 0x1d
/** Gapless flags. iTunes writes 1 on every Track and never marks the Album. */
export const MHIT_GAPLESS_TRACK_FLAG = 0x100
export const MHIT_GAPLESS_ALBUM_FLAG = 0x102
/** Master flag. The firmware builds its Music menus from the master playlist. */
export const MHYP_MASTER_FLAG = 0x14
/** Count of string mhods in a playlist. iTunes writes 1 on every playlist. */
export const MHYP_STRING_MHOD_COUNT = 0x28
/** Child mhod count, held at the same offset in mhit, mhyp, and mhip. */
export const MHOD_COUNT = 12

const MHSD_TRACKS = 1
const PLAYLIST_MHSD_TYPES = new Set([2, 3])

export type FirmwareProblem = {
  /** Short stable name, so a test can name the rule that failed. */
  readonly rule: string
  /** Where the problem sits, such as "mhit 3" or "mhyp 0". */
  readonly where: string
  readonly detail: string
}

/**
 * Lists every rule the database breaks.
 * An empty list means the firmware should load it.
 */
export function firmwareProblems(db: Itunesdb): FirmwareProblem[] {
  const problems: FirmwareProblem[] = []
  for (const [index, mhit] of tracksIn(db).entries()) {
    checkTrack(mhit, `mhit ${index}`, problems)
  }
  checkPlaylists(db, problems)
  return problems
}

/** True when the database breaks no rule. */
export function firmwareReadable(db: Itunesdb): boolean {
  return firmwareProblems(db).length === 0
}

/** The four character code the firmware expects for a Device file extension. */
export function fileTypeCodeFor(extension: string): string {
  const clean = extension.replace(/^\./u, "").toLowerCase()
  if (clean === "mp3") {
    return "MP3 "
  }
  if (clean === "wav") {
    return "WAV "
  }
  if (clean === "aif" || clean === "aiff") {
    return "AIFF"
  }
  return "M4A "
}

/** The format byte pair that goes with a Device file extension. */
export function formatBytesFor(extension: string): { type1: number, type2: number } {
  const clean = extension.replace(/^\./u, "").toLowerCase()
  if (clean === "mp3") {
    return { type1: 0, type2: 1 }
  }
  return { type1: 1, type2: 0 }
}

function checkTrack(mhit: Chunk, where: string, problems: FirmwareProblem[]): void {
  const header = mhit.header
  if (u32(header, MHIT_MEDIA_TYPE) === 0) {
    problems.push({
      rule: "media-type",
      where,
      detail: `media type at 0x${MHIT_MEDIA_TYPE.toString(16)} is 0; the firmware skips the database`,
    })
  }
  if (u32(header, MHIT_UNKNOWN_D0) === 0) {
    problems.push({
      rule: "media-type-companion",
      where,
      detail: `the field at 0x${MHIT_UNKNOWN_D0.toString(16)} is 0; iTunes writes 1 on every Track`,
    })
  }
  const code = fourCc(header, MHIT_FILE_TYPE)
  if (!/^[A-Z0-9 ]{4}$/u.test(code)) {
    problems.push({
      rule: "file-type",
      where,
      detail: `file type at 0x${MHIT_FILE_TYPE.toString(16)} is ${JSON.stringify(code)}, not a four character code`,
    })
  }
  if (byteAt(header, MHIT_TYPE_1) === 0 && byteAt(header, MHIT_TYPE_2) === 0) {
    problems.push({
      rule: "format-bytes",
      where,
      detail: "both format bytes at 0x1c and 0x1d are 0; iTunes always sets one of them",
    })
  }
  if (u16(header, MHIT_GAPLESS_TRACK_FLAG) !== 1) {
    problems.push({
      rule: "gapless-track-flag",
      where,
      detail: `gapless track flag at 0x${MHIT_GAPLESS_TRACK_FLAG.toString(16)} is ${u16(header, MHIT_GAPLESS_TRACK_FLAG)}; iTunes writes 1`,
    })
  }
  if (u16(header, MHIT_GAPLESS_ALBUM_FLAG) !== 0) {
    problems.push({
      rule: "gapless-album-flag",
      where,
      detail: `gapless album flag at 0x${MHIT_GAPLESS_ALBUM_FLAG.toString(16)} is set; iTunes never sets it`,
    })
  }
  checkMhodCount(mhit, where, problems)
}

function checkPlaylists(db: Itunesdb, problems: FirmwareProblem[]): void {
  for (const section of db.chunk.children) {
    if (section.id !== "mhsd" || !PLAYLIST_MHSD_TYPES.has(mhsdType(section))) {
      continue
    }
    for (const list of section.children) {
      if (list.id !== "mhlp") {
        continue
      }
      let masters = 0
      for (const [index, playlist] of list.children.entries()) {
        if (playlist.id !== "mhyp") {
          continue
        }
        const where = `mhyp ${index}`
        if (byteAt(playlist.header, MHYP_MASTER_FLAG) === 1) {
          masters += 1
        }
        if (u16(playlist.header, MHYP_STRING_MHOD_COUNT) === 0) {
          problems.push({
            rule: "playlist-string-mhod-count",
            where,
            detail: `string mhod count at 0x${MHYP_STRING_MHOD_COUNT.toString(16)} is 0; iTunes writes 1`,
          })
        }
        checkMhodCount(playlist, where, problems)
        for (const [itemIndex, item] of playlist.children.entries()) {
          if (item.id === "mhip") {
            checkMhodCount(item, `${where} mhip ${itemIndex}`, problems)
          }
        }
      }
      if (masters === 0) {
        problems.push({
          rule: "master-playlist",
          where: `mhsd ${mhsdType(section)}`,
          detail: "no playlist carries the master flag; the firmware has no Library to show",
        })
      }
    }
  }
}

function checkMhodCount(chunk: Chunk, where: string, problems: FirmwareProblem[]): void {
  const declared = u32(chunk.header, MHOD_COUNT)
  const actual = chunk.children.filter((child) => child.id === "mhod").length
  if (declared !== actual) {
    problems.push({
      rule: "mhod-count",
      where,
      detail: `${chunk.id} declares ${declared} child mhods and holds ${actual}`,
    })
  }
}

function tracksIn(db: Itunesdb): Chunk[] {
  const out: Chunk[] = []
  for (const section of db.chunk.children) {
    if (section.id !== "mhsd" || mhsdType(section) !== MHSD_TRACKS) {
      continue
    }
    for (const list of section.children) {
      if (list.id !== "mhlt") {
        continue
      }
      for (const item of list.children) {
        if (item.id === "mhit") {
          out.push(item)
        }
      }
    }
  }
  return out
}

function byteAt(header: Uint8Array, offset: number): number {
  return header[offset] ?? 0
}

function u16(header: Uint8Array, offset: number): number {
  if (header.byteLength < offset + 2) {
    return 0
  }
  return readU16(header, offset)
}

function u32(header: Uint8Array, offset: number): number {
  if (header.byteLength < offset + 4) {
    return 0
  }
  return readU32(header, offset)
}

function fourCc(header: Uint8Array, offset: number): string {
  if (header.byteLength < offset + 4) {
    return ""
  }
  return String.fromCharCode(
    byteAt(header, offset + 3),
    byteAt(header, offset + 2),
    byteAt(header, offset + 1),
    byteAt(header, offset),
  )
}
