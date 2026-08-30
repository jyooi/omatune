import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import type { DeviceInfo } from "./device-info.ts"
import { DeviceNotFound } from "./errors.ts"
import { Platform, type PlatformApi } from "./platform.ts"

const SERIAL_PATTERN = /^[0-9a-fA-F]{16}$/

export type FakeOwner = "omatune" | "foreign" | "empty"

export type FakeDeviceSpec = {
  readonly serial: string
  readonly vendorId?: number
  readonly productId?: number
  readonly filesystemType?: string
  readonly modelString?: string | null
  readonly freeBytes?: number
  readonly mounted?: boolean
  readonly poweredOff?: boolean
  readonly owner?: FakeOwner
}

type DeviceMeta = {
  vendorId: number
  productId: number
  filesystemType: string
  modelString: string | null
  freeBytes: number
  mounted: boolean
  poweredOff: boolean
}

const ITUNES_DIR = ["iPod_Control", "iTunes"] as const

function metaPath(root: string, serial: string): string {
  return join(root, serial.toLowerCase(), "device.json")
}

function volumePath(root: string, serial: string): string {
  return join(root, serial.toLowerCase(), "volume")
}

function itunesPath(root: string, serial: string, file: string): string {
  return join(volumePath(root, serial), ...ITUNES_DIR, file)
}

async function readMeta(root: string, serial: string): Promise<DeviceMeta | null> {
  const file = Bun.file(metaPath(root, serial))
  if (!(await file.exists())) {
    return null
  }
  return (await file.json()) as DeviceMeta
}

async function writeMeta(root: string, serial: string, meta: DeviceMeta): Promise<void> {
  await mkdir(join(root, serial.toLowerCase()), { recursive: true })
  await writeFile(metaPath(root, serial), `${JSON.stringify(meta, null, 2)}\n`)
}

async function writeOwnerFiles(root: string, serial: string, owner: FakeOwner): Promise<void> {
  if (owner === "empty") {
    return
  }
  await mkdir(join(volumePath(root, serial), ...ITUNES_DIR), { recursive: true })
  await writeFile(itunesPath(root, serial, "iTunesDB"), "iTunesDB\n")
  if (owner === "omatune") {
    await writeFile(itunesPath(root, serial, "Omatune"), "omatune\n")
  }
}

export async function writeFakeDevice(root: string, spec: FakeDeviceSpec): Promise<void> {
  if (!SERIAL_PATTERN.test(spec.serial)) {
    throw new Error(`Device serial must be 16 hex characters: ${spec.serial}`)
  }
  const serial = spec.serial.toLowerCase()
  const meta: DeviceMeta = {
    vendorId: spec.vendorId ?? 0x05ac,
    productId: spec.productId ?? 0x1261,
    filesystemType: spec.filesystemType ?? "FAT32",
    modelString: spec.modelString ?? null,
    freeBytes: spec.freeBytes ?? 0,
    mounted: spec.mounted ?? true,
    poweredOff: spec.poweredOff ?? false,
  }
  await writeMeta(root, serial, meta)
  await mkdir(volumePath(root, serial), { recursive: true })
  await writeOwnerFiles(root, serial, spec.owner ?? "empty")
}

function toInfo(root: string, serial: string, meta: DeviceMeta): DeviceInfo {
  return {
    serial,
    vendorId: meta.vendorId,
    productId: meta.productId,
    filesystemType: meta.filesystemType,
    mountPoint: meta.mounted && !meta.poweredOff ? volumePath(root, serial) : null,
    modelString: meta.modelString,
    freeBytes: meta.freeBytes,
  }
}

export function makeFake(root: string, options?: { now?: () => number }): PlatformApi {
  const clock = options?.now ?? (() => Date.now())

  const load = (serial: string) =>
    Effect.tryPromise({
      try: async () => {
        if (!SERIAL_PATTERN.test(serial)) {
          return null
        }
        return readMeta(root, serial.toLowerCase())
      },
      catch: (cause) => new Error(String(cause)),
    }).pipe(Effect.orDie)

  const requireDevice = (serial: string) =>
    load(serial).pipe(
      Effect.flatMap((meta) => {
        if (!meta || meta.poweredOff) {
          return Effect.fail(new DeviceNotFound({ serial: serial.toLowerCase() }))
        }
        return Effect.succeed({ serial: serial.toLowerCase(), meta })
      }),
    )

  const patch = (serial: string, update: Partial<DeviceMeta>) =>
    requireDevice(serial).pipe(
      Effect.flatMap(({ serial: id, meta }) =>
        Effect.tryPromise({
          try: () => writeMeta(root, id, { ...meta, ...update }),
          catch: (cause) => new Error(String(cause)),
        }).pipe(Effect.orDie),
      ),
    )

  return {
    listDevices: Effect.tryPromise({
      try: async () => {
        let entries
        try {
          entries = await readdir(root, { withFileTypes: true })
        } catch (cause) {
          const code = (cause as { code?: string }).code
          if (code === "ENOENT") {
            return []
          }
          throw cause
        }
        const devices: DeviceInfo[] = []
        for (const entry of entries) {
          if (!entry.isDirectory() || !SERIAL_PATTERN.test(entry.name)) {
            continue
          }
          const serial = entry.name.toLowerCase()
          const meta = await readMeta(root, serial)
          if (!meta || meta.poweredOff) {
            continue
          }
          devices.push(toInfo(root, serial, meta))
        }
        devices.sort((a, b) => a.serial.localeCompare(b.serial))
        return devices
      },
      catch: (cause) => new Error(String(cause)),
    }).pipe(Effect.orDie),
    mount: (serial) => patch(serial, { mounted: true }),
    unmount: (serial) => patch(serial, { mounted: false }),
    powerOff: (serial) => patch(serial, { poweredOff: true, mounted: false }),
    now: Effect.sync(clock),
  }
}

export const fakeLayer = (root: string, options?: { now?: () => number }): Layer.Layer<Platform> =>
  Layer.succeed(Platform, makeFake(root, options))
