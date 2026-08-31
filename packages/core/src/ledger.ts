import { randomBytes } from "node:crypto"
import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Either, ParseResult, Schema } from "effect"
import { malformedJson, unsupportedVersion } from "./refusals.ts"

export type LedgerEntry = {
  readonly libraryPath: string
  readonly size: number
  readonly mtime: number
  readonly sha256: string
  readonly devicePath: string
  readonly dbid: string
  readonly artworkHash: string | null
  readonly writtenRating: number | null
  readonly lastPlayed: number | null
  readonly bookmark: number | null
  readonly writtenPlayCount?: number
  readonly writtenSkipCount?: number
  readonly writtenLastSkipped?: number
  /* Set only when a Transcode wrote this Device file. `size` and `sha256`
   * always describe the Library source, so the identity of the Track never
   * depends on how it was encoded. */
  readonly transcodedSize?: number
  readonly transcodedSha256?: string
}

export type Ledger = {
  readonly version: 1
  readonly serial: string
  readonly libraryRoot: string
  readonly lastCommitTime: number
  readonly tracks: ReadonlyArray<LedgerEntry>
}

export type LedgerIssue = {
  readonly file: string
  readonly line: number
  readonly reason: string
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: LedgerIssue }

const EntrySchema = Schema.Struct({
  libraryPath: Schema.String,
  size: Schema.Number,
  mtime: Schema.Number,
  sha256: Schema.String,
  devicePath: Schema.String,
  dbid: Schema.String,
  artworkHash: Schema.NullOr(Schema.String),
  writtenRating: Schema.NullOr(Schema.Number),
  lastPlayed: Schema.NullOr(Schema.Number),
  bookmark: Schema.NullOr(Schema.Number),
  writtenPlayCount: Schema.optional(Schema.Number),
  writtenSkipCount: Schema.optional(Schema.Number),
  writtenLastSkipped: Schema.optional(Schema.Number),
  transcodedSize: Schema.optional(Schema.Number),
  transcodedSha256: Schema.optional(Schema.String),
})

const LedgerSchema = Schema.Struct({
  version: Schema.Number,
  serial: Schema.String,
  libraryRoot: Schema.String,
  lastCommitTime: Schema.Number,
  tracks: Schema.Array(EntrySchema),
})

export function ledgerPath(dir: string, serial: string): string {
  return join(dir, "devices", serial.toLowerCase(), "ledger.json")
}

export function parseLedgerText(file: string, text: string): Outcome<Ledger> {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { ok: false, issue: { file, line: 1, reason: malformedJson("Ledger") } }
  }
  const decoded = Schema.decodeUnknownEither(LedgerSchema, {
    onExcessProperty: "error",
    errors: "all",
  })(value)
  if (Either.isLeft(decoded)) {
    const issues = ParseResult.ArrayFormatter.formatErrorSync(decoded.left)
    const first = issues[0]
    const reason = first ? first.message : "Invalid Ledger."
    return {
      ok: false,
      issue: { file, line: 1, reason: reason.endsWith(".") ? reason : `${reason}.` },
    }
  }
  if (decoded.right.version !== 1) {
    return {
      ok: false,
      issue: { file, line: 1, reason: unsupportedVersion("Ledger", decoded.right.version) },
    }
  }
  return {
    ok: true,
    value: {
      version: 1,
      serial: decoded.right.serial,
      libraryRoot: decoded.right.libraryRoot,
      lastCommitTime: decoded.right.lastCommitTime,
      tracks: decoded.right.tracks,
    },
  }
}

export async function loadLedger(dir: string, serial: string): Promise<Outcome<Ledger | null>> {
  const file = ledgerPath(dir, serial)
  const exists = await Bun.file(file).exists()
  if (!exists) {
    return { ok: true, value: null }
  }
  const text = await Bun.file(file).text()
  return parseLedgerText(file, text)
}

export function serializeLedger(ledger: Ledger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`
}

export async function writeLedgerAtomic(dir: string, ledger: Ledger): Promise<void> {
  const file = ledgerPath(dir, ledger.serial)
  const tmp = `${file}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await Bun.write(tmp, serializeLedger(ledger))
  await rename(tmp, file)
}

export function freshDbid(used: Set<string>): string {
  while (true) {
    const bytes = randomBytes(8)
    const value = bytes.readBigUInt64LE(0)
    if (value === 0n) {
      continue
    }
    const text = value.toString()
    if (!used.has(text)) {
      used.add(text)
      return text
    }
  }
}
