import { dim, fg } from "@opentui/core"
import { palette } from "./palette.ts"
import { st } from "./styled.ts"

export type RateClock = {
  now: () => number
}

export type CopyRate = {
  lastBytes: number
  lastAt: number
  startedAt: number
  bytesPerSec: number
}

export function startRate(clock: RateClock, bytesDone = 0): CopyRate {
  const now = clock.now()
  return { lastBytes: bytesDone, lastAt: now, startedAt: now, bytesPerSec: 0 }
}

export function updateRate(rate: CopyRate, clock: RateClock, bytesDone: number): CopyRate {
  const now = clock.now()
  const dt = (now - rate.lastAt) / 1000
  let bytesPerSec = rate.bytesPerSec
  if (dt > 0) {
    const instant = (bytesDone - rate.lastBytes) / dt
    bytesPerSec = bytesPerSec === 0 ? instant : bytesPerSec * 0.6 + instant * 0.4
  }
  return { lastBytes: bytesDone, lastAt: now, startedAt: rate.startedAt, bytesPerSec }
}

export function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) {
    return "0.0 MB/s"
  }
  return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`
}

export function formatEta(bytesDone: number, bytesTotal: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || bytesTotal <= bytesDone) {
    return "--"
  }
  const seconds = Math.max(0, Math.round((bytesTotal - bytesDone) / bytesPerSec))
  return formatClock(seconds)
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

export function progressBar(width: number, done: number, total: number) {
  const inner = Math.max(1, width)
  const ratio = total <= 0 ? 1 : Math.min(1, Math.max(0, done / total))
  const filled = Math.round(inner * ratio)
  const empty = Math.max(0, inner - filled)
  return st`${fg(palette.accent)("█".repeat(filled))}${fg(palette.muted)("░".repeat(empty))}`
}

export function countersLine(input: {
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly filesDone: number
  readonly filesTotal: number
  readonly bytesPerSec: number
}) {
  return st`${formatMb(input.bytesDone)} of ${formatMb(input.bytesTotal)}  ${input.filesDone} of ${input.filesTotal} files  ${formatRate(input.bytesPerSec)}  ETA ${formatEta(input.bytesDone, input.bytesTotal, input.bytesPerSec)}`
}

export function currentFileLine(path: string | null) {
  if (!path) {
    return st`${dim("current")} -`
  }
  return st`${dim("current")} ${path}`
}
