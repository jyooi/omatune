import { join } from "node:path"
import { lookupFamily } from "@omatune/device-database"
import type { SupportTier } from "@omatune/device-database"
import type { DeviceInfo } from "@omatune/platform"

export type OwnerState = "omatune" | "foreign" | "unknown"

export type DeviceReport = {
  readonly serial: string
  readonly family: string | null
  readonly supportTier: SupportTier | null
  readonly mountPoint: string | null
  readonly volumeFormat: string
  readonly freeSpaceBytes: number
  readonly ownerState: OwnerState
  readonly notes: ReadonlyArray<string>
}

const FAT32_TYPES = new Set(["fat32", "vfat", "msdos"])

export function isFat32(filesystemType: string): boolean {
  return FAT32_TYPES.has(filesystemType.trim().toLowerCase())
}

async function pathExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

export async function ownerStateFor(info: DeviceInfo): Promise<OwnerState> {
  if (!isFat32(info.filesystemType) || info.mountPoint === null) {
    return "unknown"
  }
  const itunes = join(info.mountPoint, "iPod_Control", "iTunes")
  const hasDb = await pathExists(join(itunes, "iTunesDB"))
  const hasLegacy = await pathExists(join(itunes, "Omatune"))
  const hasJson = await pathExists(join(info.mountPoint, "iPod_Control", "omatune.json"))
  if (hasDb && (hasLegacy || hasJson)) {
    return "omatune"
  }
  if (hasDb) {
    return "foreign"
  }
  return "unknown"
}

export async function toDeviceReport(info: DeviceInfo): Promise<DeviceReport> {
  const family = lookupFamily({ modelString: info.modelString, productId: info.productId })
  const notes: string[] = []
  if (!isFat32(info.filesystemType)) {
    notes.push("Reformat the Device to FAT32.")
  }
  if (family?.supportTier === "Unsupported" && family.notes) {
    notes.push(family.notes)
  }
  return {
    serial: info.serial,
    family: family?.family ?? null,
    supportTier: family?.supportTier ?? null,
    mountPoint: info.mountPoint,
    volumeFormat: info.filesystemType,
    freeSpaceBytes: info.freeBytes,
    ownerState: await ownerStateFor(info),
    notes,
  }
}
