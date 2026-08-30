/*
 * Clean-room Play Counts codec.
 *
 * Sources:
 * - ipodlinux wiki Play Counts File, Wayback 2012:
 *   https://web.archive.org/web/2012/http://ipodlinux.org/wiki/ITunesDB/Play_Counts_File
 * - Repo research notes on branch research/device-database-format-map:
 *   docs/research/device-database-format-map.md
 *
 * Little endian. Entry length comes from the mhdp header.
 * Entries map to iTunesDB Track order by position.
 * Corrupt files return a typed error. The parser does not throw.
 */

import { concatBytes, readU32, writeU32 } from "./bytes.ts";

export type PlayCountsParseReason =
  | "bad-magic"
  | "bad-header-length"
  | "bad-entry-length"
  | "size-mismatch";

export class PlayCountsParseError {
  readonly name = "PlayCountsParseError";

  constructor(
    readonly reason: PlayCountsParseReason,
    readonly message: string,
    readonly offset: number,
  ) {}
}

export type ParsePlayCountsResult =
  | { ok: true; value: PlayCounts }
  | { ok: false; error: PlayCountsParseError };

export type PlayCountsEntry = {
  playCount: number;
  lastPlayed: number;
  bookmark: number;
  rating: number;
  unknown: number;
  skipCount: number;
  lastSkipped: number;
  tail: Uint8Array;
};

export type PlayCounts = {
  headerLength: number;
  entryLength: number;
  headerTail: Uint8Array;
  entries: PlayCountsEntry[];
};

export function isPlayCountsParseError(
  value: unknown,
): value is PlayCountsParseError {
  return value instanceof PlayCountsParseError;
}

export function parsePlayCounts(bytes: Uint8Array): ParsePlayCountsResult {
  if (bytes.byteLength < 4) {
    return fail(
      "bad-header-length",
      `need 4 byte magic, have ${bytes.byteLength}`,
      0,
    );
  }
  if (!hasMagic(bytes, "mhdp")) {
    return fail("bad-magic", "expected mhdp", 0);
  }
  if (bytes.byteLength < 16) {
    return fail(
      "bad-header-length",
      `need 16 byte header prefix, have ${bytes.byteLength}`,
      0,
    );
  }
  const headerLength = readU32(bytes, 4);
  if (headerLength < 16 || headerLength > bytes.byteLength) {
    return fail(
      "bad-header-length",
      `header length ${headerLength} is not valid`,
      4,
    );
  }
  const entryLength = readU32(bytes, 8);
  if (entryLength <= 0) {
    return fail(
      "bad-entry-length",
      `entry length ${entryLength} is not valid`,
      8,
    );
  }
  const entryCount = readU32(bytes, 12);
  const bodyLength = bytes.byteLength - headerLength;
  if (bodyLength % entryLength !== 0) {
    return fail(
      "size-mismatch",
      `body ${bodyLength} is not a multiple of entry length ${entryLength}`,
      headerLength,
    );
  }
  const actualCount = bodyLength / entryLength;
  if (actualCount !== entryCount) {
    return fail(
      "size-mismatch",
      `header has ${entryCount} entries, body has ${actualCount}`,
      12,
    );
  }
  const entries: PlayCountsEntry[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    const start = headerLength + i * entryLength;
    entries.push(readEntry(bytes.subarray(start, start + entryLength)));
  }
  return {
    ok: true,
    value: {
      headerLength,
      entryLength,
      headerTail: bytes.slice(16, headerLength),
      entries,
    },
  };
}

export function serializePlayCounts(playCounts: PlayCounts): Uint8Array {
  const header = new Uint8Array(playCounts.headerLength);
  writeAscii(header, 0, "mhdp");
  writeU32(header, 4, playCounts.headerLength);
  writeU32(header, 8, playCounts.entryLength);
  writeU32(header, 12, playCounts.entries.length);
  header.set(
    playCounts.headerTail.subarray(0, Math.max(0, playCounts.headerLength - 16)),
    16,
  );
  const parts: Uint8Array[] = [header];
  for (const entry of playCounts.entries) {
    parts.push(serializeEntry(entry, playCounts.entryLength));
  }
  return concatBytes(parts);
}

export function playCountsForTracks<T>(
  playCounts: PlayCounts,
  tracks: readonly T[],
): Array<{ track: T; entry: PlayCountsEntry }> {
  const count = Math.min(playCounts.entries.length, tracks.length);
  const out: Array<{ track: T; entry: PlayCountsEntry }> = [];
  for (let i = 0; i < count; i += 1) {
    const track = tracks[i];
    const entry = playCounts.entries[i];
    if (track === undefined || entry === undefined) {
      continue;
    }
    out.push({ track, entry });
  }
  return out;
}

function fail(
  reason: PlayCountsParseReason,
  message: string,
  offset: number,
): ParsePlayCountsResult {
  return {
    ok: false,
    error: new PlayCountsParseError(reason, message, offset),
  };
}

function hasMagic(bytes: Uint8Array, magic: string): boolean {
  return (
    bytes[0] === magic.charCodeAt(0) &&
    bytes[1] === magic.charCodeAt(1) &&
    bytes[2] === magic.charCodeAt(2) &&
    bytes[3] === magic.charCodeAt(3)
  );
}

function readEntry(bytes: Uint8Array): PlayCountsEntry {
  return {
    playCount: u32At(bytes, 0),
    lastPlayed: u32At(bytes, 4),
    bookmark: u32At(bytes, 8),
    rating: u32At(bytes, 12),
    unknown: u32At(bytes, 16),
    skipCount: u32At(bytes, 20),
    lastSkipped: u32At(bytes, 24),
    tail: bytes.byteLength > 28 ? bytes.slice(28) : new Uint8Array(0),
  };
}

function serializeEntry(entry: PlayCountsEntry, length: number): Uint8Array {
  const out = new Uint8Array(length);
  writeField(out, 0, entry.playCount);
  writeField(out, 4, entry.lastPlayed);
  writeField(out, 8, entry.bookmark);
  writeField(out, 12, entry.rating);
  writeField(out, 16, entry.unknown);
  writeField(out, 20, entry.skipCount);
  writeField(out, 24, entry.lastSkipped);
  if (length > 28) {
    out.set(entry.tail.subarray(0, length - 28), 28);
  }
  return out;
}

function writeField(bytes: Uint8Array, offset: number, value: number): void {
  if (offset + 4 > bytes.byteLength) {
    return;
  }
  writeU32(bytes, offset, value);
}

function u32At(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    return 0;
  }
  return readU32(bytes, offset);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    bytes[offset + i] = text.charCodeAt(i);
  }
}
