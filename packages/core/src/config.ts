import { access, constants, mkdir, readdir, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { Either, ParseResult, Schema } from "effect"
import { parse, TomlError } from "smol-toml"
import { LIBRARY_NOT_SET } from "./refusals.ts"

const PARSE_OPTIONS = { onExcessProperty: "error" as const, errors: "all" as const }

export type ConfigIssue = {
  readonly file: string
  readonly line: number
  readonly reason: string
}

export type SelectionRule =
  | { readonly kind: "album_artist"; readonly albumArtist: string }
  | { readonly kind: "album"; readonly albumArtist: string; readonly album: string }
  | { readonly kind: "path"; readonly path: string }

export type AppSelection = {
  readonly version: 1
  readonly include: ReadonlyArray<SelectionRule>
  readonly exclude: ReadonlyArray<SelectionRule>
}

export type DeviceRecord = {
  readonly serial: string
  readonly name: string
}

export type AppConfig = {
  readonly version: 1
  readonly library: string
  readonly devices: ReadonlyArray<DeviceRecord>
  readonly dir: string
  readonly file: string
}

export type LoadConfigResult =
  | { readonly kind: "ready"; readonly config: AppConfig }
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "issue"; readonly issue: ConfigIssue }

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: ConfigIssue }

const DeviceTableSchema = Schema.Struct({
  name: Schema.String,
})

const ConfigSchema = Schema.Struct({
  version: Schema.Number,
  library: Schema.String,
  devices: Schema.optional(Schema.Record({ key: Schema.String, value: DeviceTableSchema })),
})

const AlbumRuleSchema = Schema.Struct({
  album_artist: Schema.String,
  album: Schema.String,
})

const AlbumArtistRuleSchema = Schema.Struct({
  album_artist: Schema.String,
})

const PathRuleSchema = Schema.Struct({
  path: Schema.String,
})

const RuleSchema = Schema.Union(AlbumRuleSchema, AlbumArtistRuleSchema, PathRuleSchema)

const SelectionSchema = Schema.Struct({
  version: Schema.Number,
  include: Schema.optional(Schema.Array(RuleSchema)),
  exclude: Schema.optional(Schema.Array(RuleSchema)),
})

export function formatConfigIssue(issue: ConfigIssue): string {
  if (issue.reason === "Missing library.") {
    return `${issue.file}: ${LIBRARY_NOT_SET}`
  }
  return `${issue.file}:${issue.line}: ${issue.reason}`
}

export function resolveConfigDir(input: {
  readonly xdgConfigHome?: string | undefined
  readonly home?: string | undefined
  readonly flag?: string | null | undefined
  readonly envValue?: string | undefined
}): string {
  const xdg = input.xdgConfigHome
  const home = input.home
  const xdgDir =
    xdg && xdg.length > 0
      ? join(xdg, "omatune")
      : join(home && home.length > 0 ? home : ".", ".config", "omatune")
  let dir = xdgDir
  if (input.flag && input.flag.length > 0) {
    dir = input.flag
  }
  if (input.envValue && input.envValue.length > 0) {
    dir = input.envValue
  }
  return dir
}

export function starterConfigText(): string {
  return 'version = 1\n\n# library = "/path/to/music"\n'
}

export function emptySelection(): AppSelection {
  return { version: 1, include: [], exclude: [] }
}

export function serializeSelection(selection: AppSelection): string {
  const include = sortRules(selection.include)
  const exclude = sortRules(selection.exclude)
  const lines = ["version = 1"]
  for (const rule of include) {
    lines.push("", "[[include]]", ...ruleLines(rule))
  }
  for (const rule of exclude) {
    lines.push("", "[[exclude]]", ...ruleLines(rule))
  }
  return `${lines.join("\n")}\n`
}

export function parseConfigText(file: string, text: string): Outcome<Omit<AppConfig, "dir" | "file" | "library"> & { library: string }> {
  const parsed = parseToml(file, text)
  if (!parsed.ok) {
    return parsed
  }
  const versionIssue = checkVersion(file, text, parsed.value)
  if (versionIssue) {
    return { ok: false, issue: versionIssue }
  }
  const decoded = decodeSchema(file, text, ConfigSchema, parsed.value)
  if (!decoded.ok) {
    return decoded
  }
  const devices: DeviceRecord[] = []
  for (const [serial, table] of Object.entries(decoded.value.devices ?? {})) {
    devices.push({ serial: serial.toLowerCase(), name: table.name })
  }
  return {
    ok: true,
    value: {
      version: 1,
      library: decoded.value.library,
      devices,
    },
  }
}

export function parseSelectionText(file: string, text: string): Outcome<AppSelection> {
  const parsed = parseToml(file, text)
  if (!parsed.ok) {
    return parsed
  }
  const versionIssue = checkVersion(file, text, parsed.value)
  if (versionIssue) {
    return { ok: false, issue: versionIssue }
  }
  const decoded = decodeSchema(file, text, SelectionSchema, parsed.value)
  if (!decoded.ok) {
    return decoded
  }
  const include = toRules(decoded.value.include ?? [])
  const exclude = toRules(decoded.value.exclude ?? [])
  const includeIssue =
    firstEmptyRuleIssue(file, text, "include", include) ??
    firstPathIssue(file, text, "include", include)
  if (includeIssue) {
    return { ok: false, issue: includeIssue }
  }
  const excludeIssue =
    firstEmptyRuleIssue(file, text, "exclude", exclude) ??
    firstPathIssue(file, text, "exclude", exclude)
  if (excludeIssue) {
    return { ok: false, issue: excludeIssue }
  }
  return { ok: true, value: { version: 1, include, exclude } }
}

export async function loadConfigDir(dir: string): Promise<LoadConfigResult> {
  const file = join(dir, "config.toml")
  const exists = await Bun.file(file).exists()
  if (!exists) {
    await mkdir(dir, { recursive: true })
    await Bun.write(file, starterConfigText())
    return { kind: "created", path: file }
  }
  const text = await Bun.file(file).text()
  const parsed = parseConfigText(file, text)
  if (!parsed.ok) {
    return { kind: "issue", issue: parsed.issue }
  }
  const readable = await libraryReadable(parsed.value.library)
  if (!readable) {
    return {
      kind: "issue",
      issue: {
        file,
        line: lineOfKey(text, "library"),
        reason: "Library root is not readable. Point library at a folder you can read.",
      },
    }
  }
  return {
    kind: "ready",
    config: {
      ...parsed.value,
      dir,
      file,
    },
  }
}

export async function loadSelection(dir: string, serial: string): Promise<Outcome<AppSelection>> {
  const file = selectionPath(dir, serial)
  const exists = await Bun.file(file).exists()
  if (!exists) {
    return { ok: true, value: emptySelection() }
  }
  const text = await Bun.file(file).text()
  return parseSelectionText(file, text)
}

export async function writeSelection(
  dir: string,
  serial: string,
  selection: AppSelection,
): Promise<void> {
  const file = selectionPath(dir, serial)
  await mkdir(join(dir, "devices", serial.toLowerCase()), { recursive: true })
  await Bun.write(file, serializeSelection(selection))
}

export async function adoptDevice(
  dir: string,
  serial: string,
): Promise<Outcome<DeviceRecord>> {
  const id = serial.toLowerCase()
  const file = join(dir, "config.toml")
  const current = await Bun.file(file).text()
  const suffix = current.endsWith("\n") ? "" : "\n"
  const block = `${suffix}\n[devices.${tomlKey(id)}]\nname = ${tomlString(id)}\n`
  await Bun.write(file, current + block)
  await writeSelection(dir, id, emptySelection())
  return { ok: true, value: { serial: id, name: id } }
}

function selectionPath(dir: string, serial: string): string {
  return join(dir, "devices", serial.toLowerCase(), "selection.toml")
}

function parseToml(file: string, text: string): Outcome<unknown> {
  try {
    return { ok: true, value: parse(text) }
  } catch (cause) {
    const line = cause instanceof TomlError ? cause.line : 1
    return { ok: false, issue: { file, line, reason: "Malformed TOML." } }
  }
}

function checkVersion(file: string, text: string, value: unknown): ConfigIssue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { file, line: 1, reason: "Wrong type for config." }
  }
  if (!Object.prototype.hasOwnProperty.call(value, "version")) {
    return null
  }
  const version = (value as { version: unknown }).version
  if (typeof version !== "number") {
    return null
  }
  if (version !== 1) {
    return {
      file,
      line: lineOfKey(text, "version"),
      reason: `Unsupported version ${version}.`,
    }
  }
  return null
}

function decodeSchema<A, I>(
  file: string,
  text: string,
  schema: Schema.Schema<A, I, never>,
  value: unknown,
): Outcome<A> {
  const decoded = Schema.decodeUnknownEither(schema, PARSE_OPTIONS)(value)
  if (Either.isRight(decoded)) {
    return { ok: true, value: decoded.right }
  }
  const issues = ParseResult.ArrayFormatter.formatErrorSync(decoded.left)
  const first = issues[0]
  if (!first) {
    return { ok: false, issue: { file, line: 1, reason: "Invalid config." } }
  }
  return {
    ok: false,
    issue: {
      file,
      line: lineForPath(text, first.path),
      reason: reasonFromIssue(first),
    },
  }
}

function reasonFromIssue(issue: ParseResult.ArrayFormatterIssue): string {
  const last = issue.path[issue.path.length - 1]
  const key = last === undefined ? "value" : String(last)
  if (issue._tag === "Unexpected") {
    return `Unknown key ${key}.`
  }
  if (typeof last === "number") {
    return "Malformed Rule."
  }
  const inRule = issue.path.includes("include") || issue.path.includes("exclude")
  if (issue._tag === "Type") {
    return `Wrong type for ${key}.`
  }
  if (issue._tag === "Missing") {
    if (inRule) {
      return "Malformed Rule."
    }
    return `Missing ${key}.`
  }
  if (inRule) {
    return "Malformed Rule."
  }
  const message = issue.message
  return message.endsWith(".") ? message : `${message}.`
}

function toRules(
  rows: ReadonlyArray<{
    readonly album_artist?: string
    readonly album?: string
    readonly path?: string
  }>,
): SelectionRule[] {
  return rows.map((row) => {
    if (row.path !== undefined) {
      return { kind: "path", path: row.path }
    }
    if (row.album !== undefined && row.album_artist !== undefined) {
      return { kind: "album", albumArtist: row.album_artist, album: row.album }
    }
    return { kind: "album_artist", albumArtist: row.album_artist ?? "" }
  })
}

function firstEmptyRuleIssue(
  file: string,
  text: string,
  group: "include" | "exclude",
  rules: ReadonlyArray<SelectionRule>,
): ConfigIssue | null {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (!rule) {
      continue
    }
    const empty =
      (rule.kind === "path" && rule.path.length === 0) ||
      (rule.kind === "album_artist" && rule.albumArtist.length === 0) ||
      (rule.kind === "album" && (rule.albumArtist.length === 0 || rule.album.length === 0))
    if (empty) {
      return {
        file,
        line: lineForPath(text, [group, index]),
        reason: "Malformed Rule.",
      }
    }
  }
  return null
}

function firstPathIssue(
  file: string,
  text: string,
  group: "include" | "exclude",
  rules: ReadonlyArray<SelectionRule>,
): ConfigIssue | null {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (!rule || rule.kind !== "path") {
      continue
    }
    const reason = pathReason(rule.path)
    if (reason) {
      return {
        file,
        line: lineForPath(text, [group, index, "path"]),
        reason,
      }
    }
  }
  return null
}

function pathReason(value: string): string | null {
  if (value.length === 0) {
    return "Malformed Rule."
  }
  if (isAbsolute(value)) {
    return "path must not be absolute."
  }
  const parts = value.split(/[\\/]/)
  if (parts.includes("..")) {
    return "path must not contain .."
  }
  return null
}

function sortRules(rules: ReadonlyArray<SelectionRule>): SelectionRule[] {
  return [...rules].sort((left, right) => {
    const a = ruleSortKey(left)
    const b = ruleSortKey(right)
    for (let i = 0; i < a.length; i += 1) {
      const av = a[i] ?? ""
      const bv = b[i] ?? ""
      if (typeof av === "number" && typeof bv === "number") {
        if (av !== bv) {
          return av - bv
        }
        continue
      }
      const cmp = String(av).localeCompare(String(bv))
      if (cmp !== 0) {
        return cmp
      }
    }
    return 0
  })
}

function ruleSortKey(rule: SelectionRule): Array<number | string> {
  if (rule.kind === "album_artist") {
    return [0, rule.albumArtist, "", ""]
  }
  if (rule.kind === "album") {
    return [1, rule.albumArtist, rule.album, ""]
  }
  return [2, "", "", rule.path]
}

function ruleLines(rule: SelectionRule): string[] {
  if (rule.kind === "album_artist") {
    return [`album_artist = ${tomlString(rule.albumArtist)}`]
  }
  if (rule.kind === "album") {
    return [
      `album_artist = ${tomlString(rule.albumArtist)}`,
      `album = ${tomlString(rule.album)}`,
    ]
  }
  return [`path = ${tomlString(rule.path)}`]
}

function tomlString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
  return `"${escaped}"`
}

function tomlKey(serial: string): string {
  return `"${serial.replaceAll('"', '\\"')}"`
}

async function libraryReadable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      return false
    }
    await access(path, constants.R_OK)
    await readdir(path)
    return true
  } catch {
    return false
  }
}

function lineOfKey(text: string, key: string): number {
  const lines = splitLines(text)
  const assign = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  for (let i = 0; i < lines.length; i += 1) {
    if (assign.test(lines[i] ?? "")) {
      return i + 1
    }
  }
  return 1
}

function lineForPath(text: string, path: ReadonlyArray<PropertyKey>): number {
  if (path.length === 0) {
    return 1
  }
  const lines = splitLines(text)
  const head = path[0]
  if (head === "include" || head === "exclude") {
    return lineForRule(lines, head, path.slice(1))
  }
  if (head === "devices") {
    return lineForDevice(lines, path.slice(1))
  }
  if (typeof head === "string") {
    return lineOfKey(text, head)
  }
  return 1
}

function lineForRule(
  lines: ReadonlyArray<string>,
  group: "include" | "exclude",
  rest: ReadonlyArray<PropertyKey>,
): number {
  const starts = tableStarts(lines, group)
  const index = rest[0]
  if (typeof index !== "number") {
    return starts[0] !== undefined ? starts[0] + 1 : 1
  }
  const from = starts[index] ?? 0
  const to = starts[index + 1] ?? lines.length
  const field = rest[1]
  if (typeof field === "string") {
    const found = findAssign(lines, field, from, to)
    if (found !== 0) {
      return found
    }
  }
  return from + 1
}

function lineForDevice(lines: ReadonlyArray<string>, rest: ReadonlyArray<PropertyKey>): number {
  if (rest.length === 0) {
    const found = findHeader(lines, /^\[devices[.\]]/)
    return found === 0 ? 1 : found
  }
  const serial = String(rest[0])
  const headerIndex = findDeviceHeaderIndex(lines, serial)
  if (headerIndex < 0) {
    return 1
  }
  const field = rest[1]
  if (typeof field === "string") {
    const next = nextHeaderIndex(lines, headerIndex)
    const found = findAssign(lines, field, headerIndex, next)
    if (found !== 0) {
      return found
    }
  }
  return headerIndex + 1
}

function tableStarts(lines: ReadonlyArray<string>, group: string): number[] {
  const starts: number[] = []
  const header = new RegExp(`^\\s*\\[\\[${escapeRegExp(group)}\\]\\]\\s*$`)
  for (let i = 0; i < lines.length; i += 1) {
    if (header.test(lines[i] ?? "")) {
      starts.push(i)
    }
  }
  return starts
}

function findAssign(lines: ReadonlyArray<string>, key: string, from: number, to: number): number {
  const assign = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`)
  for (let i = from; i < to; i += 1) {
    if (assign.test(lines[i] ?? "")) {
      return i + 1
    }
  }
  return 0
}

function findHeader(lines: ReadonlyArray<string>, pattern: RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? "")) {
      return i + 1
    }
  }
  return 0
}

function findDeviceHeaderIndex(lines: ReadonlyArray<string>, serial: string): number {
  const quoted = new RegExp(`^\\s*\\[devices\\.${escapeRegExp(`"${serial}"`)}\\]\\s*$`, "i")
  const bare = new RegExp(`^\\s*\\[devices\\.${escapeRegExp(serial)}\\]\\s*$`, "i")
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ""
    if (quoted.test(line) || bare.test(line)) {
      return i
    }
  }
  return -1
}

function nextHeaderIndex(lines: ReadonlyArray<string>, headerIndex: number): number {
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ""
    if (/^\s*\[[^[]/.test(line)) {
      return i
    }
  }
  return lines.length
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
