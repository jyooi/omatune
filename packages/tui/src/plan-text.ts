import { bold, dim, fg } from "@opentui/core"
import type { SyncPlan } from "@omatune/core"
import { formatBytes } from "./bytes.ts"
import { palette } from "./palette.ts"
import { st } from "./styled.ts"

export function skipReasonText(reason: string): string {
  return reason.replaceAll("_", " ")
}

export function planLines(plan: SyncPlan) {
  const lines = [
    st`${bold(fg(palette.green)(`Add ${plan.add.length}`))} ${dim(formatBytes(plan.bytesNeeded))}`,
  ]
  for (const track of plan.add) {
    lines.push(st`  ${fg(palette.green)("+")} ${track.path} ${dim(formatBytes(track.size))}`)
  }
  lines.push(st`${bold(fg(palette.red)(`Remove ${plan.remove.length}`))}`)
  for (const track of plan.remove) {
    lines.push(st`  ${fg(palette.red)("-")} ${track.path} ${dim(formatBytes(track.size))}`)
  }
  lines.push(st`${bold(`Keep ${plan.keep.length}`)}`)
  for (const track of plan.keep) {
    lines.push(st`  ${track.path}`)
  }
  lines.push(st`${bold(fg(palette.yellow)(`Skipped ${plan.skipped.length}`))}`)
  for (const skip of plan.skipped) {
    lines.push(st`  ${fg(palette.yellow)("!")} ${skip.path} ${dim(skipReasonText(skip.reason))}`)
  }
  const free =
    plan.freeSpaceAfter >= 0
      ? formatBytes(plan.freeSpaceAfter)
      : `${formatBytes(plan.freeSpaceAfter)} (does not fit)`
  lines.push(st`${dim("bytes")} ${formatBytes(plan.bytesNeeded)}  ${dim("free after")} ${free}`)
  return lines
}

export function planSummary(plan: SyncPlan) {
  const fits = plan.freeSpaceAfter >= 0 ? "fits" : "does not fit"
  return st`${fg(palette.green)(`+${plan.add.length}`)} ${fg(palette.red)(`-${plan.remove.length}`)}  ${formatBytes(plan.bytesNeeded)}  ${fits}`
}
