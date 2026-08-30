import type { DeviceReport, SyncPlan } from "@omatune/core"

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value
  }
  return value + " ".repeat(width - value.length)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const label = units[unit] ?? "KiB"
  return `${value.toFixed(1)} ${label}`
}

export function formatJson(reports: ReadonlyArray<DeviceReport>): string {
  if (reports.length === 0) {
    return ""
  }
  return reports.map((report) => JSON.stringify(report)).join("\n") + "\n"
}

export function formatPlanJson(plan: SyncPlan): string {
  return `${JSON.stringify(plan)}\n`
}

export function formatPlanText(plan: SyncPlan): string {
  const lines = [
    `Kind: ${plan.kind}`,
    `Add: ${plan.add.length}`,
    `Remove: ${plan.remove.length}`,
    `Keep: ${plan.keep.length}`,
    `Skipped: ${plan.skipped.length}`,
    `Bytes needed: ${formatBytes(plan.bytesNeeded)}`,
    `Free space after: ${formatBytes(plan.freeSpaceAfter)}`,
  ]
  if (plan.forceModel) {
    lines.push(`Force model: ${plan.forceModel}`)
  }
  for (const skip of plan.skipped) {
    lines.push(`Skip ${skip.path}: ${skip.reason}`)
  }
  return `${lines.join("\n")}\n`
}

export function formatTable(reports: ReadonlyArray<DeviceReport>): string {
  const headers = ["SERIAL", "FAMILY", "TIER", "FORMAT", "FREE", "OWNER", "MOUNT", "NOTES"]
  const rows = reports.map((report) => [
    report.serial,
    report.family ?? "-",
    report.supportTier ?? "-",
    report.volumeFormat,
    formatBytes(report.freeSpaceBytes),
    report.ownerState,
    report.mountPoint ?? "-",
    report.notes.join(" "),
  ])
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  )
  const line = (cells: string[]) =>
    cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  ")
  const out = [line(headers), ...rows.map(line)]
  return out.join("\n") + "\n"
}
