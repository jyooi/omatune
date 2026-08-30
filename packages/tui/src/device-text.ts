import { bold, dim, fg } from "@opentui/core"
import { formatBytes } from "./bytes.ts"
import { palette } from "./palette.ts"
import { st } from "./styled.ts"

export type DeviceFacts = {
  readonly serial: string
  readonly family: string | null
  readonly tier: string
  readonly volumeFormat: string
  readonly freeBytes: number
  readonly ownerState: string
  readonly mountPoint: string | null
  readonly notes: ReadonlyArray<string>
}

export function deviceLines(facts: DeviceFacts) {
  const notes = facts.notes.length > 0 ? facts.notes.join(" ") : "-"
  return [
    st`${bold("SERIAL")}  ${facts.serial}`,
    st`${bold("FAMILY")}  ${facts.family ?? "-"}`,
    st`${bold("TIER")}    ${fg(palette.green)(facts.tier)}`,
    st`${bold("FORMAT")}  ${facts.volumeFormat}`,
    st`${bold("FREE")}    ${formatBytes(facts.freeBytes)}`,
    st`${bold("OWNER")}   ${facts.ownerState}`,
    st`${bold("MOUNT")}   ${facts.mountPoint ?? "-"}`,
    st`${bold("NOTES")}   ${dim(notes)}`,
  ]
}
