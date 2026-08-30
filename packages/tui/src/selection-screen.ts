import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SystemClock,
  TextRenderable,
  bold,
  dim,
  fg,
  type CliRenderer,
  type Clock,
  type KeyEvent,
} from "@opentui/core"
import type { AppSelection, Ledger, ScannedFile } from "@omatune/core"
import { formatBytes } from "./bytes.ts"
import { palette } from "./palette.ts"
import {
  albumKey,
  deleteVisibleRule,
  flattenTree,
  groupLibrary,
  mirrorRows,
  planOf,
  selectedPathsOf,
  toggleAlbum,
  toggleArtist,
  visibleRules,
  type TreeRow,
} from "./selection-model.ts"
import { st } from "./styled.ts"

const REDRAW_MS = 100
const WIDE_MIN = 110
const SCROLL = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 } as const

export type SelectionHost = {
  readonly libraryRoot: string
  readonly deviceName: string
  readonly serial: string
  readonly tier: string
  readonly freeBytes: number
  readonly tracksOnDevice: number
  readonly files: ReadonlyArray<ScannedFile>
  readonly selection: AppSelection
  readonly ledger: Ledger | null
  readonly writeSelection: (selection: AppSelection) => Promise<void>
}

export type SelectionHandle = {
  dispose: () => void
  flush: () => Promise<void>
  selection: () => AppSelection
  treeRowPoint: (index: number) => { x: number; y: number } | null
}

export function attachSelectionScreen(
  renderer: CliRenderer,
  host: SelectionHost,
  options: {
    clock?: Clock
    onQuit?: (code: 0 | 1) => void
  } = {},
): SelectionHandle {
  const clock = options.clock ?? new SystemClock()
  const artists = groupLibrary(host.files)
  let selection = host.selection
  let cursor = 0
  const expanded = new Set<string>()
  let writing = Promise.resolve()
  let lastDraw = Number.NEGATIVE_INFINITY
  let drawTimer: ReturnType<Clock["setTimeout"]> | null = null
  let disposed = false

  const headerLeft = new TextRenderable(renderer, { content: "", fg: palette.text })
  const headerRight = new TextRenderable(renderer, { content: "", fg: palette.text })
  const header = new BoxRenderable(renderer, {
    flexDirection: "row",
    justifyContent: "space-between",
    height: 1,
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: palette.panel,
  })
  header.add(headerLeft)
  header.add(headerRight)

  const tree = new ScrollBoxRenderable(renderer, {
    ...SCROLL,
    scrollX: false,
    contentOptions: { flexDirection: "column" },
  })
  const rulesSelect = new SelectRenderable(renderer, {
    showDescription: false,
    showScrollIndicator: false,
    backgroundColor: palette.panel,
    textColor: palette.text,
    selectedBackgroundColor: palette.panelHi,
    selectedTextColor: palette.accent,
    focusedBackgroundColor: palette.panel,
    focusedTextColor: palette.text,
    height: 1,
    options: [],
  })
  const rulesEmpty = new TextRenderable(renderer, {
    content: "Rules",
    fg: palette.muted,
  })
  const rulesBox = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexShrink: 0,
    height: 1,
  })
  rulesBox.add(rulesEmpty)

  const libraryPane = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    borderStyle: "single",
    borderColor: palette.accent,
    title: " Library (tick = on Device) ",
    titleColor: palette.text,
  })
  libraryPane.add(tree)
  libraryPane.add(rulesBox)

  const mirror = new ScrollBoxRenderable(renderer, {
    ...SCROLL,
    scrollX: false,
    contentOptions: { flexDirection: "column" },
  })
  const devicePane = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    borderStyle: "single",
    borderColor: palette.muted,
    title: " Device after Sync ",
    titleColor: palette.text,
  })
  devicePane.add(mirror)

  const panes = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
  })
  panes.add(libraryPane)
  panes.add(devicePane)

  const summary = new TextRenderable(renderer, { content: "", fg: palette.text })
  const keysLine = new TextRenderable(renderer, { content: "", fg: palette.text })
  const strip = new BoxRenderable(renderer, {
    flexDirection: "column",
    height: 4,
    flexShrink: 0,
    borderStyle: "single",
    borderColor: palette.muted,
    paddingLeft: 1,
  })
  strip.add(summary)
  strip.add(keysLine)

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: palette.background,
  })
  root.add(header)
  root.add(panes)
  root.add(strip)
  renderer.root.add(root)

  const treeBoxes: BoxRenderable[] = []

  function rowsNow(): { tree: TreeRow[]; rules: ReturnType<typeof visibleRules> } {
    const selected = selectedPathsOf(host.files, selection)
    return { tree: flattenTree(artists, selected, expanded), rules: visibleRules(selection) }
  }

  function totalRows(): number {
    const now = rowsNow()
    const extra = now.rules.length > 0 ? now.rules.length : 0
    return Math.max(1, now.tree.length + extra)
  }

  function clampCursor(): void {
    const max = totalRows() - 1
    if (cursor < 0) {
      cursor = 0
    }
    if (cursor > max) {
      cursor = max
    }
  }

  function commit(next: AppSelection): void {
    selection = next
    writing = writing.then(() => host.writeSelection(next))
    requestDraw()
  }

  function requestDraw(): void {
    if (disposed) {
      return
    }
    const now = clock.now()
    const wait = REDRAW_MS - (now - lastDraw)
    if (wait <= 0) {
      draw()
      return
    }
    if (drawTimer !== null) {
      return
    }
    drawTimer = clock.setTimeout(() => {
      drawTimer = null
      draw()
    }, wait)
  }

  function draw(): void {
    if (disposed) {
      return
    }
    lastDraw = clock.now()
    clampCursor()
    const wide = renderer.width >= WIDE_MIN
    panes.flexDirection = wide ? "row" : "column"
    headerLeft.content = st`${bold(fg(palette.accent)("omatune"))} ${host.libraryRoot} ${dim("->")} ${bold(host.deviceName)} ${dim(host.serial)} ${fg(palette.green)(host.tier)}`
    headerRight.content = st`${formatFree(host.freeBytes)} free ${dim("·")} ${String(host.tracksOnDevice)} Tracks`

    const selected = selectedPathsOf(host.files, selection)
    const treeRows = flattenTree(artists, selected, expanded)
    const rules = visibleRules(selection)
    const plan = planOf(host.files, selection, host.ledger, host.freeBytes)
    paintTree(treeRows)
    paintRules(rules, treeRows.length)
    paintMirror(plan)
    const fits = plan.freeSpaceAfter >= 0 ? "fits" : "does not fit"
    summary.content = st`${fg(palette.green)(`+${plan.add.length}`)} ${fg(palette.red)(`-${plan.remove.length}`)}  ${formatBytes(plan.bytesNeeded)}  ${fits}`
    keysLine.content = keyHelp()
    renderer.requestRender()
  }

  function paintTree(treeRows: TreeRow[]): void {
    for (const child of [...tree.getChildren()]) {
      tree.remove(child)
      child.destroy()
    }
    treeBoxes.length = 0
    treeRows.forEach((row, index) => {
      const active = cursor === index
      const box = new BoxRenderable(renderer, {
        width: "100%",
        height: 1,
        backgroundColor: active ? palette.panelHi : undefined,
        onMouseDown: () => {
          cursor = index
          if (row.kind === "artist" || row.kind === "album") {
            space()
          } else {
            requestDraw()
          }
        },
      })
      const label = treeLabel(row)
      const marker = active ? fg(palette.accent)("▶") : " "
      box.add(new TextRenderable(renderer, { content: st`${marker}${label}` }))
      tree.add(box)
      treeBoxes.push(box)
    })
    if (treeRows.length > 0 && cursor < treeRows.length) {
      const id = treeBoxes[cursor]?.id
      if (id) {
        tree.scrollChildIntoView(id)
      }
    }
  }

  function paintRules(rules: ReturnType<typeof visibleRules>, treeCount: number): void {
    for (const child of [...rulesBox.getChildren()]) {
      rulesBox.remove(child)
    }
    if (rules.length === 0) {
      rulesBox.height = 1
      rulesBox.border = false
      rulesBox.title = undefined
      rulesEmpty.content = st`${dim("Rules")}`
      rulesBox.add(rulesEmpty)
      return
    }
    const inRules = cursor >= treeCount
    const selectedIndex = inRules ? cursor - treeCount : 0
    rulesSelect.options = rules.map((rule) => ({
      name: `${rule.sign} ${rule.text}`,
      description: "",
      value: rule,
    }))
    rulesSelect.setSelectedIndex(selectedIndex)
    rulesSelect.showSelectionIndicator = inRules
    rulesSelect.height = rules.length
    rulesBox.height = rules.length + 2
    rulesBox.border = true
    rulesBox.borderStyle = "single"
    rulesBox.borderColor = palette.muted
    rulesBox.title = " Rules (path and exclude, d deletes) "
    rulesBox.add(rulesSelect)
  }

  function paintMirror(plan: ReturnType<typeof planOf>): void {
    for (const child of [...mirror.getChildren()]) {
      mirror.remove(child)
      child.destroy()
    }
    for (const row of mirrorRows(artists, plan)) {
      if (row.kind === "artist") {
        mirror.add(new TextRenderable(renderer, { content: st`${bold(row.name)}` }))
        continue
      }
      const mark =
        row.marker === "+"
          ? fg(palette.green)("+")
          : row.marker === "-"
            ? fg(palette.red)("-")
            : " "
      const name = row.marker === "-" ? fg(palette.red)(row.album) : row.album
      mirror.add(
        new TextRenderable(renderer, {
          content: st`  ${mark} ${name} ${dim(row.count)}`,
        }),
      )
    }
  }

  function space(): void {
    const now = rowsNow()
    if (cursor >= now.tree.length) {
      return
    }
    const row = now.tree[cursor]
    if (!row) {
      return
    }
    if (row.kind === "artist") {
      commit(toggleArtist(selection, row.name, row.state))
      return
    }
    if (row.kind === "album") {
      const artist = artists.find((node) => node.name === row.albumArtist)
      const album = artist?.albums.find((node) => node.album === row.album)
      if (!artist || !album) {
        return
      }
      commit(toggleAlbum(selection, artist, album, row.state))
    }
  }

  function onKey(key: KeyEvent): void {
    if (key.ctrl && key.name === "c") {
      quit(0)
      return
    }
    if (key.name === "q" || key.name === "escape") {
      quit(0)
      return
    }
    if (key.name === "return") {
      return
    }
    if (key.name === "up" || key.name === "k") {
      cursor -= 1
      requestDraw()
      return
    }
    if (key.name === "down" || key.name === "j") {
      cursor += 1
      requestDraw()
      return
    }
    if (key.name === "space") {
      space()
      return
    }
    if (key.name === "right") {
      const now = rowsNow()
      const row = now.tree[cursor]
      if (row?.kind === "album") {
        const keyName = albumKey(row.albumArtist, row.album)
        if (expanded.has(keyName)) {
          expanded.delete(keyName)
        } else {
          expanded.add(keyName)
        }
        requestDraw()
      }
      return
    }
    if (key.name === "d") {
      const now = rowsNow()
      if (cursor >= now.tree.length) {
        commit(deleteVisibleRule(selection, cursor - now.tree.length))
      }
    }
  }

  function quit(code: 0 | 1): void {
    if (disposed) {
      return
    }
    dispose()
    options.onQuit?.(code)
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    if (drawTimer !== null) {
      clock.clearTimeout(drawTimer)
      drawTimer = null
    }
    renderer.keyInput.off("keypress", onKey)
    renderer.off("resize", requestDraw)
    root.destroy()
  }

  renderer.keyInput.on("keypress", onKey)
  renderer.on("resize", requestDraw)
  draw()

  return {
    dispose,
    flush: () => writing,
    selection: () => selection,
    treeRowPoint: (index: number) => {
      const box = treeBoxes[index]
      if (!box) {
        return null
      }
      return { x: box.x + 2, y: box.y }
    },
  }
}

function treeLabel(row: TreeRow) {
  if (row.kind === "artist") {
    return st`${tick(row.state)} ${bold(row.name)}`
  }
  if (row.kind === "album") {
    return st`    ${tick(row.state)} ${row.album} ${dim(`(${row.trackCount})`)}`
  }
  const mark = row.selected ? fg(palette.green)("·") : fg(palette.muted)("·")
  return st`        ${mark} ${row.title}`
}

function tick(state: "all" | "some" | "none") {
  if (state === "all") {
    return fg(palette.green)("[x]")
  }
  if (state === "some") {
    return fg(palette.yellow)("[~]")
  }
  return fg(palette.muted)("[ ]")
}

function keyHelp() {
  const pair = (key: string, label: string) => st`${bold(fg(palette.accent)(key))} ${dim(label)}`
  return st`${pair("↑↓/jk", "move")}  ${pair("Space", "tick")}  ${pair("→", "tracks")}  ${pair("d", "delete")}  ${pair("Enter", "plan")}  ${pair("Esc/q", "quit")}`
}

function formatFree(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}
