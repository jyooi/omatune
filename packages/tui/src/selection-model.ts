import {
  albumIdentity,
  buildPlan,
  evaluateSelection,
  normaliseName,
  type AppSelection,
  type Ledger,
  type ScannedFile,
  type SelectionRule,
  type SyncPlan,
  type TrackTags,
} from "@omatune/core"
import { formatBytes } from "./bytes.ts"

export type TickState = "all" | "some" | "none"

export type LibraryTrack = {
  readonly relativePath: string
  readonly size: number
  readonly albumArtist: string
  readonly album: string
  readonly title: string
  readonly track: number | null
  readonly disc: number | null
}

export type AlbumNode = {
  readonly albumArtist: string
  readonly album: string
  readonly tracks: ReadonlyArray<LibraryTrack>
}

export type ArtistNode = {
  readonly name: string
  readonly albums: ReadonlyArray<AlbumNode>
}

export type TreeRow =
  | { readonly kind: "artist"; readonly name: string; readonly state: TickState }
  | {
      readonly kind: "album"
      readonly albumArtist: string
      readonly album: string
      readonly state: TickState
      readonly trackCount: number
    }
  | {
      readonly kind: "track"
      readonly title: string
      readonly path: string
      readonly selected: boolean
    }

export type VisibleRule = {
  readonly group: "include" | "exclude"
  readonly rule: SelectionRule
  readonly sign: "+" | "-"
  readonly text: string
}

export type MirrorRow =
  | { readonly kind: "artist"; readonly name: string }
  | {
      readonly kind: "album"
      readonly album: string
      readonly marker: "+" | "-" | " "
      readonly count: string
    }

export function groupLibrary(files: ReadonlyArray<ScannedFile>): ArtistNode[] {
  const artists = new Map<string, Map<string, LibraryTrack[]>>()
  for (const file of files) {
    if (!readableTags(file.tags)) {
      continue
    }
    const identity = albumIdentity(file.tags)
    if (identity.albumArtist.length === 0 || identity.album.length === 0) {
      continue
    }
    let albums = artists.get(identity.albumArtist)
    if (!albums) {
      albums = new Map()
      artists.set(identity.albumArtist, albums)
    }
    let tracks = albums.get(identity.album)
    if (!tracks) {
      tracks = []
      albums.set(identity.album, tracks)
    }
    tracks.push({
      relativePath: file.relativePath,
      size: file.size,
      albumArtist: identity.albumArtist,
      album: identity.album,
      title: (file.tags.title ?? file.relativePath.split("/").pop() ?? file.relativePath).trim(),
      track: file.tags.track,
      disc: file.tags.disc,
    })
  }
  const nodes: ArtistNode[] = []
  const artistNames = [...artists.keys()].sort((a, b) => a.localeCompare(b))
  for (const name of artistNames) {
    const albums = artists.get(name)
    if (!albums) {
      continue
    }
    const albumNodes: AlbumNode[] = []
    const albumNames = [...albums.keys()].sort((a, b) => a.localeCompare(b))
    for (const album of albumNames) {
      const tracks = [...(albums.get(album) ?? [])]
      tracks.sort(byTrack)
      albumNodes.push({ albumArtist: name, album, tracks })
    }
    nodes.push({ name, albums: albumNodes })
  }
  return nodes
}

export function selectedPathsOf(
  files: ReadonlyArray<ScannedFile>,
  selection: AppSelection,
): Set<string> {
  const { selected } = evaluateSelection(files, selection)
  return new Set(selected.map((track) => track.relativePath))
}

export function tickState(tracks: ReadonlyArray<LibraryTrack>, selected: ReadonlySet<string>): TickState {
  let on = 0
  for (const track of tracks) {
    if (selected.has(track.relativePath)) {
      on += 1
    }
  }
  if (on === 0) {
    return "none"
  }
  if (on === tracks.length) {
    return "all"
  }
  return "some"
}

export function flattenTree(
  artists: ReadonlyArray<ArtistNode>,
  selected: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  for (const artist of artists) {
    const artistTracks = artist.albums.flatMap((album) => album.tracks)
    rows.push({ kind: "artist", name: artist.name, state: tickState(artistTracks, selected) })
    for (const album of artist.albums) {
      rows.push({
        kind: "album",
        albumArtist: artist.name,
        album: album.album,
        state: tickState(album.tracks, selected),
        trackCount: album.tracks.length,
      })
      if (expanded.has(albumKey(artist.name, album.album))) {
        for (const track of album.tracks) {
          rows.push({
            kind: "track",
            title: track.title,
            path: track.relativePath,
            selected: selected.has(track.relativePath),
          })
        }
      }
    }
  }
  return rows
}

export function albumKey(albumArtist: string, album: string): string {
  return `${albumArtist}\0${album}`
}

export function visibleRules(selection: AppSelection): VisibleRule[] {
  const rows: VisibleRule[] = []
  for (const rule of selection.include) {
    if (rule.kind === "path") {
      rows.push({ group: "include", rule, sign: "+", text: formatRule(rule) })
    }
  }
  for (const rule of selection.exclude) {
    rows.push({ group: "exclude", rule, sign: "-", text: formatRule(rule) })
  }
  return rows
}

export function formatRule(rule: SelectionRule): string {
  if (rule.kind === "path") {
    return `path = ${quote(rule.path)}`
  }
  if (rule.kind === "album") {
    return `album_artist = ${quote(rule.albumArtist)}, album = ${quote(rule.album)}`
  }
  return `album_artist = ${quote(rule.albumArtist)}`
}

export function deleteVisibleRule(selection: AppSelection, index: number): AppSelection {
  const rows = visibleRules(selection)
  const target = rows[index]
  if (!target) {
    return selection
  }
  if (target.group === "include") {
    return {
      ...selection,
      include: removeRule(selection.include, target.rule),
    }
  }
  return {
    ...selection,
    exclude: removeRule(selection.exclude, target.rule),
  }
}

export function toggleArtist(selection: AppSelection, artist: string, state: TickState): AppSelection {
  const without = selection.include.filter((rule) => !tagRuleForArtist(rule, artist))
  if (state === "all") {
    return { ...selection, include: without }
  }
  return {
    ...selection,
    include: [...without, { kind: "album_artist", albumArtist: artist }],
  }
}

export function toggleAlbum(
  selection: AppSelection,
  artist: ArtistNode,
  album: AlbumNode,
  state: TickState,
): AppSelection {
  if (state === "all") {
    const hadArtist = selection.include.some((rule) => tagArtistOnly(rule, artist.name))
    const without = selection.include.filter(
      (rule) => !tagArtistOnly(rule, artist.name) && !tagAlbum(rule, artist.name, album.album),
    )
    if (!hadArtist) {
      return { ...selection, include: without }
    }
    const extras: SelectionRule[] = []
    for (const other of artist.albums) {
      if (other.album === album.album) {
        continue
      }
      extras.push({ kind: "album", albumArtist: artist.name, album: other.album })
    }
    return { ...selection, include: [...without, ...extras] }
  }
  if (selection.include.some((rule) => tagAlbum(rule, artist.name, album.album))) {
    return selection
  }
  return {
    ...selection,
    include: [
      ...selection.include,
      { kind: "album", albumArtist: artist.name, album: album.album },
    ],
  }
}

export function planOf(
  files: ReadonlyArray<ScannedFile>,
  selection: AppSelection,
  ledger: Ledger | null,
  freeBytes: number,
): SyncPlan {
  const { selected, skipped } = evaluateSelection(files, selection)
  return buildPlan({
    kind: "normal",
    selected,
    skipped,
    ledger,
    hashes: new Map(),
    freeBytes,
    forceModel: null,
  })
}

export function formatPlanSummary(plan: SyncPlan): string {
  const fits = plan.freeSpaceAfter >= 0 ? "fits" : "does not fit"
  return `+${plan.add.length} -${plan.remove.length}  ${formatBytes(plan.bytesNeeded)}  ${fits}`
}

export function mirrorRows(artists: ReadonlyArray<ArtistNode>, plan: SyncPlan): MirrorRow[] {
  const add = groupPaths(artists, plan.add.map((track) => track.path))
  const keep = groupPaths(artists, plan.keep.map((track) => track.path))
  const remove = groupPaths(artists, plan.remove.map((track) => track.path))
  const onDevice = new Set([
    ...plan.add.map((track) => track.path),
    ...plan.keep.map((track) => track.path),
  ])
  const rows: MirrorRow[] = []
  for (const artist of artists) {
    const albumRows: MirrorRow[] = []
    for (const album of artist.albums) {
      const key = albumKey(artist.name, album.album)
      const joining = add.has(key)
      const staying = keep.has(key)
      const leaving = remove.has(key)
      if (joining || staying) {
        const count = album.tracks.filter((track) => onDevice.has(track.relativePath)).length
        albumRows.push({
          kind: "album",
          album: album.album,
          marker: joining && !staying ? "+" : " ",
          count: String(count),
        })
      } else if (leaving) {
        albumRows.push({
          kind: "album",
          album: album.album,
          marker: "-",
          count: "removed",
        })
      }
    }
    if (albumRows.length === 0) {
      continue
    }
    rows.push({ kind: "artist", name: artist.name })
    rows.push(...albumRows)
  }
  return rows
}

function groupPaths(artists: ReadonlyArray<ArtistNode>, paths: ReadonlyArray<string>): Set<string> {
  const set = new Set(paths)
  const keys = new Set<string>()
  for (const artist of artists) {
    for (const album of artist.albums) {
      if (album.tracks.some((track) => set.has(track.relativePath))) {
        keys.add(albumKey(artist.name, album.album))
      }
    }
  }
  return keys
}

function byTrack(left: LibraryTrack, right: LibraryTrack): number {
  const disc = (left.disc ?? 0) - (right.disc ?? 0)
  if (disc !== 0) {
    return disc
  }
  const track = (left.track ?? 0) - (right.track ?? 0)
  if (track !== 0) {
    return track
  }
  return left.relativePath.localeCompare(right.relativePath)
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function tagRuleForArtist(rule: SelectionRule, artist: string): boolean {
  if (rule.kind === "path") {
    return false
  }
  return namesEqual(rule.albumArtist, artist)
}

function tagArtistOnly(rule: SelectionRule, artist: string): boolean {
  return rule.kind === "album_artist" && namesEqual(rule.albumArtist, artist)
}

function tagAlbum(rule: SelectionRule, artist: string, album: string): boolean {
  return rule.kind === "album" && namesEqual(rule.albumArtist, artist) && namesEqual(rule.album, album)
}

function namesEqual(left: string, right: string): boolean {
  return normaliseName(left) === normaliseName(right)
}

function ruleEqual(left: SelectionRule, right: SelectionRule): boolean {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === "path" && right.kind === "path") {
    return left.path === right.path
  }
  if (left.kind === "album_artist" && right.kind === "album_artist") {
    return namesEqual(left.albumArtist, right.albumArtist)
  }
  if (left.kind === "album" && right.kind === "album") {
    return namesEqual(left.albumArtist, right.albumArtist) && namesEqual(left.album, right.album)
  }
  return false
}

function readableTags(tags: TrackTags | null): tags is TrackTags {
  if (tags === null) {
    return false
  }
  const title = (tags.title ?? "").trim()
  const artist = (tags.artist ?? "").trim()
  const album = (tags.album ?? "").trim()
  return title.length > 0 || artist.length > 0 || album.length > 0
}

function removeRule(rules: ReadonlyArray<SelectionRule>, target: SelectionRule): SelectionRule[] {
  let removed = false
  const out: SelectionRule[] = []
  for (const rule of rules) {
    if (!removed && ruleEqual(rule, target)) {
      removed = true
      continue
    }
    out.push(rule)
  }
  return out
}
