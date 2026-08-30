/**
 * Linux Platform over the system D-Bus (udisks2) and udev.
 *
 * FireWire ID sources, in order:
 * 1. SysInfoExtended field FirewireGuid (also FireWireGUID)
 * 2. SysInfo field FirewireGuid when the value is not empty
 * 3. udev ID_SERIAL_SHORT
 *
 * SysInfo (text, `Key: value` lines) fields we read:
 * - FirewireGuid
 * - ModelNumStr
 *
 * SysInfoExtended (Apple XML plist) fields we read:
 * - FirewireGuid / FireWireGUID
 * - ModelNumStr
 *
 * Those files live under iPod_Control/Device/ on the mounted volume.
 * ModelNumStr can be absent. SysInfo on the reference classic holds FirewireGuid only.
 * Family lookup then uses the USB disk-mode product ID on DeviceInfo.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import type { DeviceInfo } from "./device-info.ts"
import { DeviceNotFound } from "./errors.ts"
import { systemTransport, type LinuxTransport, type UdisksBlock, type UdisksDrive } from "./linux-transport.ts"
import { Platform, type PlatformApi } from "./platform.ts"

const APPLE_VENDOR_ID = 0x05ac
const CLASSIC_PRODUCT_ID = 0x1261
const FAT_TYPES = new Set(["vfat", "fat32", "msdos"])
const SERIAL_PATTERN = /^[0-9a-f]{16}$/
const FS_IFACE = "org.freedesktop.UDisks2.Filesystem"
const DRIVE_IFACE = "org.freedesktop.UDisks2.Drive"

const REFORMAT = "Reformat the Device to FAT32."
const READ_ONLY = "The Device is mounted read-only."
const ID_DISAGREE = "The Device FireWire ID sources disagree."
const ID_MISSING = "The Device has no FireWire ID."
const LAYOUT_MISSING = "The Device is missing iPod_Control/iTunes or iPod_Control/Device."

type Attached = {
  serial: string
  blockPath: string
  drivePath: string
}

function refuse(message: string): never {
  throw new Error(message)
}

function parseHexId(raw: string | undefined): number | null {
  if (!raw) {
    return null
  }
  const hex = raw.trim().toLowerCase().replace(/^0x/u, "")
  if (!/^[0-9a-f]+$/u.test(hex)) {
    return null
  }
  return Number.parseInt(hex, 16)
}

function normalizeFirewire(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null
  }
  const hex = raw.trim().toLowerCase().replace(/^0x/u, "")
  if (hex.length === 0) {
    return null
  }
  if (!SERIAL_PATTERN.test(hex)) {
    refuse(ID_DISAGREE)
  }
  return hex
}

function sysInfoMap(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split(/\r?\n/u)) {
    const cut = line.indexOf(":")
    if (cut <= 0) {
      continue
    }
    map.set(line.slice(0, cut).trim().toLowerCase(), line.slice(cut + 1).trim())
  }
  return map
}

function plistString(xml: string, key: string): string | null {
  const pattern = new RegExp(`<key>${key}</key>\\s*<(string|integer)>([^<]*)</\\1>`, "i")
  const match = pattern.exec(xml)
  const value = match?.[2]?.trim()
  return value && value.length > 0 ? value : null
}

function parseSysInfo(text: string): { firewire: string | null; model: string | null } {
  if (text.trim().length === 0) {
    return { firewire: null, model: null }
  }
  const map = sysInfoMap(text)
  return {
    firewire: normalizeFirewire(map.get("firewireguid") ?? null),
    model: map.get("modelnumstr") || null,
  }
}

function parseSysInfoExtended(xml: string): { firewire: string | null; model: string | null } {
  const firewireRaw =
    plistString(xml, "FirewireGuid") ??
    plistString(xml, "FireWireGUID") ??
    plistString(xml, "FireWireGuid") ??
    plistString(xml, "FirewireGUID")
  return {
    firewire: normalizeFirewire(firewireRaw),
    model: plistString(xml, "ModelNumStr"),
  }
}

async function findChild(dir: string, name: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  const needle = name.toLowerCase()
  const found = entries.find((entry) => entry.toLowerCase() === needle)
  return found === undefined ? null : join(dir, found)
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

function resolveFirewire(sie: string | null, sys: string | null, usb: string | null): string {
  const sources = [sie, sys, usb].filter((value): value is string => value !== null)
  const first = sources[0]
  if (first === undefined) {
    refuse(ID_MISSING)
  }
  for (const value of sources) {
    if (value !== first) {
      refuse(ID_DISAGREE)
    }
  }
  return first
}

type ControlFiles = {
  sieFirewire: string | null
  sysFirewire: string | null
  model: string | null
}

async function readControl(mountPoint: string): Promise<ControlFiles> {
  const control = await findChild(mountPoint, "iPod_Control")
  if (control === null) {
    refuse(LAYOUT_MISSING)
  }
  const itunes = await findChild(control, "iTunes")
  const device = await findChild(control, "Device")
  if (itunes === null || device === null) {
    refuse(LAYOUT_MISSING)
  }
  const sieText = await readOptional(join(device, "SysInfoExtended"))
  const sysText = await readOptional(join(device, "SysInfo"))
  const sie = sieText === null ? { firewire: null, model: null } : parseSysInfoExtended(sieText)
  const sys = sysText === null ? { firewire: null, model: null } : parseSysInfo(sysText)
  return {
    sieFirewire: sie.firewire,
    sysFirewire: sys.firewire,
    model: sie.model ?? sys.model,
  }
}

function isAppleIpod(drive: UdisksDrive): boolean {
  return (
    drive.connectionBus.trim().toLowerCase() === "usb" &&
    drive.vendor.trim().toLowerCase() === "apple" &&
    drive.model.trim().toLowerCase() === "ipod"
  )
}

function filesystemBlock(blocks: ReadonlyArray<UdisksBlock>, drivePath: string): UdisksBlock | null {
  const owned = blocks.filter((block) => block.drive === drivePath && !block.ignore && block.device.length > 0)
  const mounted = owned.find((block) => block.mountPoints.length > 0)
  if (mounted) {
    return mounted
  }
  const fat = owned.find((block) => FAT_TYPES.has(block.idType.trim().toLowerCase()))
  if (fat) {
    return fat
  }
  return owned.find((block) => block.idType.length > 0) ?? null
}

async function ensureMounted(transport: LinuxTransport, block: UdisksBlock): Promise<string> {
  const existing = block.mountPoints[0]
  if (existing) {
    return existing
  }
  const mounted = await transport.call(block.path, FS_IFACE, "Mount")
  if (typeof mounted !== "string" || mounted.length === 0) {
    throw new Error("udisks2 did not return a mount point.")
  }
  return mounted
}

async function probeDrive(
  transport: LinuxTransport,
  drive: UdisksDrive,
  blocks: ReadonlyArray<UdisksBlock>,
): Promise<{ info: DeviceInfo; attached: Attached } | null> {
  if (!isAppleIpod(drive)) {
    return null
  }
  const block = filesystemBlock(blocks, drive.path)
  if (block === null) {
    return null
  }
  const udev = await transport.udevProperties(block.device)
  const vendorId = parseHexId(udev.ID_VENDOR_ID ?? udev.ID_USB_VENDOR_ID)
  const productId = parseHexId(udev.ID_MODEL_ID ?? udev.ID_USB_MODEL_ID)
  if (vendorId !== APPLE_VENDOR_ID || productId !== CLASSIC_PRODUCT_ID) {
    return null
  }
  const fsType = block.idType.trim().toLowerCase()
  if (fsType === "hfsplus" || !FAT_TYPES.has(fsType)) {
    refuse(REFORMAT)
  }
  if (block.readOnly) {
    refuse(READ_ONLY)
  }
  const mountPoint = await ensureMounted(transport, block)
  const stats = await transport.volumeStats(mountPoint)
  if (stats.readOnly) {
    refuse(READ_ONLY)
  }
  const control = await readControl(mountPoint)
  const usbSerial = normalizeFirewire(udev.ID_SERIAL_SHORT ?? udev.ID_USB_SERIAL_SHORT ?? null)
  const serial = resolveFirewire(control.sieFirewire, control.sysFirewire, usbSerial)
  return {
    info: {
      serial,
      vendorId,
      productId,
      filesystemType: block.idType,
      mountPoint,
      modelString: control.model,
      freeBytes: stats.freeBytes,
    },
    attached: {
      serial,
      blockPath: block.path,
      drivePath: drive.path,
    },
  }
}

async function scan(transport: LinuxTransport, attached: Map<string, Attached>): Promise<DeviceInfo[]> {
  const snapshot = await transport.getManagedObjects()
  const devices: DeviceInfo[] = []
  attached.clear()
  for (const drive of snapshot.drives) {
    const found = await probeDrive(transport, drive, snapshot.blocks)
    if (found === null) {
      continue
    }
    devices.push(found.info)
    attached.set(found.attached.serial, found.attached)
  }
  devices.sort((a, b) => a.serial.localeCompare(b.serial))
  return devices
}

function lookup(attached: Map<string, Attached>, serial: string): Attached {
  const key = serial.toLowerCase()
  const found = attached.get(key)
  if (!found) {
    throw new DeviceNotFound({ serial: key })
  }
  return found
}

function asCaught(cause: unknown): DeviceNotFound | Error {
  if (cause instanceof DeviceNotFound) {
    return cause
  }
  if (cause instanceof Error) {
    return cause
  }
  return new Error(String(cause))
}

function fromPromise<A>(tryFn: () => Promise<A>): Effect.Effect<A, DeviceNotFound> {
  return Effect.tryPromise({
    try: tryFn,
    catch: asCaught,
  }).pipe(
    Effect.catchAll((error) => (error instanceof DeviceNotFound ? Effect.fail(error) : Effect.die(error))),
  )
}

export function makeLinux(transport: LinuxTransport): PlatformApi {
  const attached = new Map<string, Attached>()
  return {
    listDevices: Effect.tryPromise({
      try: () => scan(transport, attached),
      catch: asCaught,
    }).pipe(Effect.orDie),
    mount: (serial) =>
      fromPromise(async () => {
        const device = lookup(attached, serial)
        await transport.call(device.blockPath, FS_IFACE, "Mount")
      }),
    unmount: (serial) =>
      fromPromise(async () => {
        const device = lookup(attached, serial)
        await transport.call(device.blockPath, FS_IFACE, "Unmount")
      }),
    powerOff: (serial) =>
      fromPromise(async () => {
        const device = lookup(attached, serial)
        await transport.call(device.drivePath, DRIVE_IFACE, "PowerOff")
      }),
    now: Effect.sync(() => Date.now()),
  }
}

export function ejectDevice(
  api: PlatformApi,
  serial: string,
  noEject: boolean,
): Effect.Effect<void, DeviceNotFound> {
  if (noEject) {
    return Effect.void
  }
  return api.unmount(serial).pipe(Effect.andThen(() => api.powerOff(serial)))
}

export const linuxLayerFrom = (transport: LinuxTransport): Layer.Layer<Platform> =>
  Layer.succeed(Platform, makeLinux(transport))

export const linuxLayer: Layer.Layer<Platform> = linuxLayerFrom(systemTransport)
