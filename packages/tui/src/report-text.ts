import { bold, dim, fg } from "@opentui/core"
import type { SyncReport } from "@omatune/core"
import { palette } from "./palette.ts"
import { skipReasonText } from "./plan-text.ts"
import { formatClock } from "./progress.ts"
import { st } from "./styled.ts"

export const EJECTED_LINE = "Ejected - safe to unplug."
export const STILL_MOUNTED_LINE = "Still mounted - the iPod shows no music until it is ejected."

export function mountStateLine(ejected: boolean): string {
  return ejected ? EJECTED_LINE : STILL_MOUNTED_LINE
}

export function reportLines(input: {
  readonly report: SyncReport | null
  readonly elapsedMs: number
  readonly exitReason: string | null
  readonly ejected: boolean
  readonly skipped?: ReadonlyArray<{ readonly path: string; readonly reason: string }>
}) {
  const lines = []
  const elapsed = formatClock(input.elapsedMs / 1000)
  if (input.report) {
    lines.push(
      st`${bold(fg(palette.green)("Sync complete"))} ${dim(`in ${elapsed}`)}`,
    )
    lines.push(
      st`${fg(palette.green)(`+${input.report.added}`)} added  ${fg(palette.red)(`-${input.report.removed}`)} removed  ${input.report.kept} kept  ${input.report.skipped} skipped`,
    )
    for (const skip of input.skipped ?? []) {
      lines.push(st`  ${fg(palette.yellow)("!")} ${skip.path} ${dim(skipReasonText(skip.reason))}`)
    }
    for (const skip of input.report.artworkSkipped) {
      lines.push(
        st`  ${fg(palette.yellow)("!")} ${skip.path} ${dim(`artwork ${skipReasonText(skip.reason)}`)}`,
      )
    }
  } else {
    lines.push(st`${bold(fg(palette.red)("Sync stopped"))} ${dim(`in ${elapsed}`)}`)
  }
  if (input.exitReason) {
    lines.push(st`${fg(palette.red)(input.exitReason)}`)
  }
  if (input.ejected) {
    lines.push(st`${bold(fg(palette.green)(EJECTED_LINE))}`)
  } else {
    lines.push(st`${fg(palette.yellow)(STILL_MOUNTED_LINE)}`)
  }
  return lines
}

export function reportStdout(input: {
  readonly report: SyncReport | null
  readonly elapsedMs: number
  readonly exitReason: string | null
  readonly ejected: boolean
  readonly skipped?: ReadonlyArray<{ readonly path: string; readonly reason: string }>
}): string {
  const lines: string[] = []
  if (input.report) {
    lines.push(`Added: ${input.report.added}`)
    lines.push(`Removed: ${input.report.removed}`)
    lines.push(`Kept: ${input.report.kept}`)
    lines.push(`Skipped: ${input.report.skipped}`)
    for (const skip of input.skipped ?? []) {
      lines.push(`Skipped ${skip.path}: ${skip.reason}`)
    }
    for (const skip of input.report.artworkSkipped) {
      lines.push(`Skipped-for-artwork ${skip.path}: ${skip.reason}`)
    }
  }
  lines.push(`Elapsed: ${formatClock(input.elapsedMs / 1000)}`)
  if (input.exitReason) {
    lines.push(input.exitReason)
  }
  lines.push(mountStateLine(input.ejected))
  return `${lines.join("\n")}\n`
}
