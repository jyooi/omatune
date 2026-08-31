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
import {
  SyncError,
  type AppSelection,
  type Ledger,
  type ScannedFile,
  type SyncEvent,
  type SyncPlan,
  type SyncProgress,
  type SyncReport,
  type SyncRequest,
} from "@omatune/core"
import { formatBytes } from "./bytes.ts"
import { deviceLines, type DeviceFacts } from "./device-text.ts"
import { palette } from "./palette.ts"
import { planLines } from "./plan-text.ts"
import {
  countersLine,
  currentFileLine,
  progressBar,
  startRate,
  updateRate,
  type CopyRate,
} from "./progress.ts"
import { reportLines, reportStdout } from "./report-text.ts"
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

export type TuiSyncRun = (
  request: SyncRequest,
  onEvent: (event: SyncEvent) => void,
) => Promise<void>

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
  readonly family?: string | null
  readonly volumeFormat?: string
  readonly ownerState?: string
  readonly mountPoint?: string | null
  readonly notes?: ReadonlyArray<string>
  readonly configDir?: string
  readonly dataDir?: string
  readonly yes?: boolean
  readonly noEject?: boolean
  readonly strict?: boolean
  readonly forceModel?: string | null
  readonly eject?: () => Promise<void>
}

export type SelectionHandle = {
  dispose: () => void
  flush: () => Promise<void>
  selection: () => AppSelection
  treeRowPoint: (index: number) => { x: number; y: number } | null
}

export type TuiFinish = {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

type Mode = "select" | "plan" | "wipe" | "sync" | "report" | "device"

export function attachSelectionScreen(
  renderer: CliRenderer,
  host: SelectionHost,
  options: {
    clock?: Clock
    onQuit?: (code: 0 | 1) => void
    onFinish?: (result: TuiFinish) => void
    runSync?: TuiSyncRun
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
  let lastMode: Mode = "select"
  let disposed = false
  let mode: Mode = "select"
  let previousMode: Mode = "select"
  let livePlan: SyncPlan | null = null
  let pendingConfirm: ((ok: boolean) => void) | null = null
  let earlyConfirm: boolean | null = null
  let wipeBuf = ""
  let progress: SyncProgress | null = null
  let rate: CopyRate | null = null
  let report: SyncReport | null = null
  let deviceEjected = false
  let ejecting = false
  let ejectError: string | null = null
  let exitReason: string | null = null
  let syncStartedAt = 0
  let syncEndedAt = 0
  let syncing = false
  let finishCode: 0 | 1 | 2 = 0

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

  const deviceBody = new ScrollBoxRenderable(renderer, {
    ...SCROLL,
    scrollX: false,
    contentOptions: { flexDirection: "column", paddingLeft: 1 },
  })
  const deviceScreen = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    borderStyle: "single",
    borderColor: palette.accent,
    title: " Device ",
    titleColor: palette.text,
  })
  deviceScreen.add(deviceBody)

  const stripBody = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    scrollX: false,
    contentOptions: { flexDirection: "column" },
  })
  const promptLine = new TextRenderable(renderer, { content: "", fg: palette.text })
  const strip = new BoxRenderable(renderer, {
    flexDirection: "column",
    height: 4,
    flexShrink: 0,
    borderStyle: "single",
    borderColor: palette.muted,
    paddingLeft: 1,
  })
  strip.add(stripBody)
  strip.add(promptLine)

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
    writing = writing.then(() => host.writeSelection(next)).catch(() => undefined)
    requestDraw()
  }

  function requestDraw(): void {
    if (disposed) {
      return
    }
    const modeChanged = lastMode !== mode
    lastMode = mode
    if (modeChanged) {
      if (drawTimer !== null) {
        clock.clearTimeout(drawTimer)
        drawTimer = null
      }
      draw()
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
    const packed = packHeader(host, renderer.width)
    headerLeft.content = st`${bold(fg(palette.accent)("omatune"))} ${packed.root} ${dim("->")} ${bold(packed.deviceName)} ${dim(host.serial)} ${fg(palette.green)(host.tier)}`
    headerRight.content = packed.compactRight
      ? st`${packed.free} ${dim("·")} ${packed.tracks}`
      : st`${packed.free} free ${dim("·")} ${packed.tracks}`

    const selected = selectedPathsOf(host.files, selection)
    const treeRows = flattenTree(artists, selected, expanded)
    const rules = visibleRules(selection)
    const localPlan = planOf(host.files, selection, host.ledger, host.freeBytes)
    paintTree(treeRows)
    paintRules(rules, treeRows.length)
    paintMirror(livePlan ?? localPlan)
    paintDevice()
    paintStrip(localPlan)
    showDevice(mode === "device")
    renderer.requestRender()
  }

  function showDevice(on: boolean): void {
    const children = [...root.getChildren()]
    for (const child of children) {
      if (child === panes || child === deviceScreen) {
        root.remove(child)
      }
    }
    root.remove(strip)
    root.add(on ? deviceScreen : panes)
    root.add(strip)
  }

  function paintDevice(): void {
    for (const child of [...deviceBody.getChildren()]) {
      deviceBody.remove(child)
      child.destroy()
    }
    for (const line of deviceLines(deviceFacts(host))) {
      deviceBody.add(new TextRenderable(renderer, { content: line }))
    }
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
          if (mode !== "select") {
            return
          }
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

  function clearStripBody(): void {
    for (const child of [...stripBody.getChildren()]) {
      stripBody.remove(child)
      child.destroy()
    }
  }

  function paintStrip(localPlan: SyncPlan): void {
    clearStripBody()
    const viewing = mode === "device" ? previousMode : mode
    if (viewing === "select") {
      strip.height = 4
      strip.borderColor = palette.muted
      strip.title = undefined
      const fits = localPlan.freeSpaceAfter >= 0 ? "fits" : "does not fit"
      stripBody.add(
        new TextRenderable(renderer, {
          content: st`${fg(palette.green)(`+${localPlan.add.length}`)} ${fg(palette.red)(`-${localPlan.remove.length}`)}  ${formatBytes(localPlan.bytesNeeded)}  ${fits}`,
        }),
      )
      promptLine.content = mode === "device" ? deviceKeys() : keyHelp()
      return
    }
    if (viewing === "plan" || viewing === "wipe") {
      const plan = livePlan ?? localPlan
      const cap = Math.min(16, Math.max(8, renderer.height - 10))
      strip.height = cap
      strip.borderColor = palette.accent
      strip.title = " Sync Plan "
      for (const line of planLines(plan)) {
        stripBody.add(new TextRenderable(renderer, { content: line }))
      }
      promptLine.content = confirmPrompt()
      return
    }
    if (viewing === "sync") {
      strip.height = 7
      strip.borderColor = palette.accent
      strip.title = " Sync "
      const phase = progress?.phase ?? "copy"
      stripBody.add(new TextRenderable(renderer, { content: st`${bold(fg(palette.accent)(`Phase: ${phase}`))}` }))
      const width = Math.max(10, renderer.width - 8)
      stripBody.add(
        new TextRenderable(renderer, {
          content: progressBar(width, progress?.bytesDone ?? 0, progress?.bytesTotal ?? 0),
        }),
      )
      stripBody.add(
        new TextRenderable(renderer, {
          content: countersLine({
            bytesDone: progress?.bytesDone ?? 0,
            bytesTotal: progress?.bytesTotal ?? 0,
            filesDone: progress?.filesDone ?? 0,
            filesTotal: progress?.filesTotal ?? 0,
            bytesPerSec: rate?.bytesPerSec ?? 0,
          }),
        }),
      )
      stripBody.add(
        new TextRenderable(renderer, {
          content: currentFileLine(progress?.currentFile ?? null),
        }),
      )
      promptLine.content = st`${dim("Ctrl-C leaves the Device ready to resume")}`
      return
    }
    strip.height = Math.min(14, Math.max(8, renderer.height - 10))
    strip.borderColor = palette.green
    strip.title = " Report "
    const elapsedMs = Math.max(0, syncEndedAt - syncStartedAt)
    for (const line of reportLines({
      report,
      elapsedMs,
      exitReason,
      ejected: deviceEjected,
      ejectError,
      skipped: livePlan?.skipped ?? [],
    })) {
      stripBody.add(new TextRenderable(renderer, { content: line }))
    }
    promptLine.content =
      mode === "device"
        ? deviceKeys()
        : deviceEjected
          ? st`${pair("Enter", "exit")}  ${pair("q", "quit")}`
          : st`${pair("Enter", "exit")}  ${pair("e", "eject")}  ${pair("q", "quit")}`
  }

  function confirmPrompt() {
    if (mode === "device") {
      return deviceKeys()
    }
    if (mode === "wipe") {
      return st`${bold(fg(palette.yellow)("Wipe and Sync?"))} ${wipeBuf}${dim(" (type wipe)")}`
    }
    return st`${bold(fg(palette.yellow)("Sync now? [y/N]"))}  ${pair("Esc", "back")}`
  }

  function deviceKeys() {
    return st`${pair("Esc", "back")}  ${pair("i", "Device")}`
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

  function openDevice(): void {
    if (mode === "device") {
      mode = previousMode
      requestDraw()
      return
    }
    previousMode = mode
    mode = "device"
    requestDraw()
  }

  function answerConfirm(ok: boolean): void {
    const pending = pendingConfirm
    pendingConfirm = null
    if (!pending) {
      earlyConfirm = ok
      if (!ok) {
        mode = "select"
        livePlan = null
        requestDraw()
      }
      return
    }
    earlyConfirm = null
    if (!ok) {
      mode = "select"
      livePlan = null
      requestDraw()
    }
    pending(ok)
  }

  function onConfirm(plan: SyncPlan): Promise<boolean> {
    livePlan = plan
    wipeBuf = ""
    if (earlyConfirm === false) {
      earlyConfirm = null
      mode = "select"
      livePlan = null
      requestDraw()
      return Promise.resolve(false)
    }
    if ((host.yes || earlyConfirm === true) && plan.kind !== "wipe") {
      earlyConfirm = null
      mode = "plan"
      requestDraw()
      return Promise.resolve(true)
    }
    earlyConfirm = null
    mode = plan.kind === "wipe" ? "wipe" : "plan"
    requestDraw()
    return new Promise((resolve) => {
      pendingConfirm = resolve
    })
  }

  function onSyncEvent(event: SyncEvent): void {
    if (disposed) {
      return
    }
    if (event.type === "plan") {
      if (earlyConfirm === false) {
        return
      }
      livePlan = event.plan
      if (mode === "select") {
        mode = event.plan.kind === "wipe" ? "wipe" : "plan"
      }
      requestDraw()
      return
    }
    if (event.type === "progress") {
      mode = "sync"
      progress = event
      rate = rate ? updateRate(rate, clock, event.bytesDone) : startRate(clock, event.bytesDone)
      requestDraw()
      return
    }
    if (event.type === "report") {
      report = event
      deviceEjected = event.ejected
      ejectError = null
      syncEndedAt = clock.now()
      mode = "report"
      finishCode = 0
      exitReason = null
      requestDraw()
    }
  }

  async function ejectNow(): Promise<void> {
    if (deviceEjected || ejecting || !host.eject) {
      return
    }
    ejecting = true
    try {
      await host.eject()
      deviceEjected = true
      ejectError = null
      if (report) {
        report = { ...report, ejected: true }
      }
      requestDraw()
    } catch (cause) {
      ejectError = toSyncError(cause).message
      requestDraw()
    } finally {
      ejecting = false
    }
  }

  async function beginSync(): Promise<void> {
    if (!options.runSync || syncing || mode !== "select") {
      return
    }
    syncing = true
    livePlan = null
    earlyConfirm = null
    progress = null
    rate = null
    report = null
    deviceEjected = false
    ejectError = null
    exitReason = null
    finishCode = 0
    syncStartedAt = clock.now()
    syncEndedAt = syncStartedAt
    mode = "plan"
    requestDraw()
    const request: SyncRequest = {
      serial: host.serial,
      configDir: host.configDir ?? "",
      yes: host.yes === true,
      noEject: host.noEject === true,
      strict: host.strict === true,
      forceModel: host.forceModel ?? null,
      dataDir: host.dataDir ?? "",
      confirm: onConfirm,
    }
    try {
      await options.runSync(request, onSyncEvent)
    } catch (cause) {
      if (disposed) {
        return
      }
      const error = toSyncError(cause)
      syncEndedAt = clock.now()
      if (error.message === "Sync cancelled.") {
        mode = "select"
        livePlan = null
        pendingConfirm = null
        requestDraw()
        return
      }
      exitReason = error.message
      finishCode = error.code
      deviceEjected = false
      mode = "report"
      requestDraw()
      return
    } finally {
      syncing = false
    }
  }

  function onKey(key: KeyEvent): void {
    if (key.ctrl && key.name === "c") {
      if (mode === "sync") {
        answerConfirm(false)
        finish({ code: 2, stdout: "", stderr: "" })
        return
      }
      finish({ code: 0, stdout: "", stderr: "" })
      return
    }
    if (mode === "device") {
      if (key.name === "i" || key.name === "escape") {
        openDevice()
      }
      if (key.name === "q") {
        finishFromHere()
      }
      return
    }
    if (mode === "report") {
      if (key.name === "i") {
        openDevice()
        return
      }
      if (key.name === "e") {
        void ejectNow()
        return
      }
      if (key.name === "return" || key.name === "q" || key.name === "escape") {
        finishFromHere()
      }
      return
    }
    if (mode === "sync") {
      return
    }
    if (mode === "wipe") {
      if (key.name === "escape") {
        answerConfirm(false)
        return
      }
      if (key.name === "return") {
        answerConfirm(wipeBuf.trim() === "wipe")
        return
      }
      if (key.name === "backspace") {
        wipeBuf = wipeBuf.slice(0, -1)
        requestDraw()
        return
      }
      const ch = key.sequence
      if (ch.length === 1 && !key.ctrl && ch !== "\u001b") {
        wipeBuf += ch
        requestDraw()
      }
      return
    }
    if (mode === "plan") {
      if (key.name === "i") {
        openDevice()
        return
      }
      if (key.name === "escape") {
        answerConfirm(false)
        return
      }
      if (key.name === "y") {
        answerConfirm(true)
        return
      }
      if (key.name === "n" || key.name === "return") {
        answerConfirm(false)
      }
      return
    }
    if (key.name === "q" || key.name === "escape") {
      finish({ code: 0, stdout: "", stderr: "" })
      return
    }
    if (key.name === "i") {
      openDevice()
      return
    }
    if (key.name === "return") {
      void beginSync()
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

  function finishFromHere(): void {
    const elapsedMs = Math.max(0, (syncEndedAt || clock.now()) - syncStartedAt)
    const stdout =
      report || exitReason
        ? reportStdout({
            report,
            elapsedMs,
            exitReason,
            ejected: deviceEjected,
            ejectError,
            skipped: livePlan?.skipped ?? [],
          })
        : ""
    finish({ code: finishCode, stdout, stderr: "" })
  }

  function finish(result: TuiFinish): void {
    if (disposed) {
      return
    }
    answerConfirm(false)
    dispose()
    void writing.then(
      () => {
        options.onFinish?.(result)
        options.onQuit?.(result.code === 0 ? 0 : 1)
      },
      () => {
        options.onFinish?.(result)
        options.onQuit?.(result.code === 0 ? 0 : 1)
      },
    )
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

function toSyncError(cause: unknown): SyncError {
  if (cause instanceof SyncError) {
    return cause
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  const code =
    cause !== null && typeof cause === "object" && "code" in cause && (cause.code === 1 || cause.code === 2)
      ? cause.code
      : 2
  return new SyncError({ message, code })
}

function deviceFacts(host: SelectionHost): DeviceFacts {
  return {
    serial: host.serial,
    family: host.family ?? null,
    tier: host.tier,
    volumeFormat: host.volumeFormat ?? "-",
    freeBytes: host.freeBytes,
    ownerState: host.ownerState ?? "-",
    mountPoint: host.mountPoint ?? null,
    notes: host.notes ?? [],
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

function pair(key: string, label: string) {
  return st`${bold(fg(palette.accent)(key))} ${dim(label)}`
}

function keyHelp() {
  return st`${pair("↑↓/jk", "move")}  ${pair("Space", "tick")}  ${pair("→", "tracks")}  ${pair("d", "delete")}  ${pair("Enter", "plan")}  ${pair("i", "Device")}  ${pair("Esc/q", "quit")}`
}

function formatFree(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

function packHeader(host: SelectionHost, width: number): {
  root: string
  deviceName: string
  free: string
  tracks: string
  compactRight: boolean
} {
  const inner = Math.max(0, width - 2)
  const free = formatFree(host.freeBytes)
  const tracks = `${String(host.tracksOnDevice)} Tracks`
  const rightWide = `${free} free · ${tracks}`
  const rightNarrow = `${free} · ${tracks}`
  const leftOf = (root: string, deviceName: string) =>
    `omatune ${root} -> ${deviceName} ${host.serial} ${host.tier}`
  const fits = (root: string, deviceName: string, right: string) =>
    leftOf(root, deviceName).length + 1 + right.length <= inner
  let root = host.libraryRoot
  let deviceName = host.deviceName
  let right = rightWide
  if (!fits(root, deviceName, right)) {
    right = rightNarrow
  }
  if (!fits(root, deviceName, right)) {
    const budget =
      inner - 1 - right.length - `omatune  -> ${deviceName} ${host.serial} ${host.tier}`.length
    root = ellipsizeStart(host.libraryRoot, Math.max(1, budget))
  }
  if (!fits(root, deviceName, right)) {
    const budget =
      inner - 1 - right.length - `omatune ${root} ->  ${host.serial} ${host.tier}`.length
    deviceName = ellipsizeEnd(host.deviceName, Math.max(1, budget))
  }
  return { root, deviceName, free, tracks, compactRight: right === rightNarrow }
}

function ellipsizeStart(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  if (max <= 1) {
    return "…"
  }
  const tail = text.slice(-(max - 1))
  const slash = tail.indexOf("/")
  if (slash >= 0 && slash < tail.length - 1) {
    const cut = `…${tail.slice(slash)}`
    if (cut.length <= max) {
      return cut
    }
  }
  return `…${tail}`
}

function ellipsizeEnd(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  if (max <= 1) {
    return "…"
  }
  return `${text.slice(0, max - 1)}…`
}
