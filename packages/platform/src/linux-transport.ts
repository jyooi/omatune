import { access, statfs } from "node:fs/promises"
import { constants } from "node:fs"

export type UdisksDrive = {
  readonly path: string
  readonly connectionBus: string
  readonly vendor: string
  readonly model: string
}

export type UdisksBlock = {
  readonly path: string
  readonly drive: string
  readonly idType: string
  readonly idLabel: string
  readonly device: string
  readonly readOnly: boolean
  readonly ignore: boolean
  readonly mountPoints: ReadonlyArray<string>
}

export type UdisksSnapshot = {
  readonly drives: ReadonlyArray<UdisksDrive>
  readonly blocks: ReadonlyArray<UdisksBlock>
}

export type VolumeStats = {
  readonly freeBytes: number
  readonly readOnly: boolean
}

export type LinuxTransport = {
  readonly getManagedObjects: () => Promise<UdisksSnapshot>
  readonly call: (path: string, iface: string, method: string) => Promise<unknown>
  readonly udevProperties: (deviceNode: string) => Promise<Record<string, string>>
  readonly volumeStats: (mountPoint: string) => Promise<VolumeStats>
}

type DbusValue = {
  readonly type: string
  readonly data: unknown
}

type ManagedObjects = Record<string, Record<string, Record<string, DbusValue>>>

const UDISKS_SERVICE = "org.freedesktop.UDisks2"
const UDISKS_ROOT = "/org/freedesktop/UDisks2"
const DRIVE_IFACE = "org.freedesktop.UDisks2.Drive"
const BLOCK_IFACE = "org.freedesktop.UDisks2.Block"
const FS_IFACE = "org.freedesktop.UDisks2.Filesystem"

function dbusData(value: DbusValue | undefined): unknown {
  return value?.data
}

function decodeAy(data: unknown): string {
  if (typeof data === "string") {
    return data.replace(/\0+$/u, "")
  }
  if (!Array.isArray(data)) {
    return ""
  }
  const bytes = data.filter((item): item is number => typeof item === "number")
  const end = bytes.indexOf(0)
  const slice = end === -1 ? bytes : bytes.slice(0, end)
  return Buffer.from(slice).toString("utf8")
}

function decodeMountPoints(data: unknown): string[] {
  if (!Array.isArray(data)) {
    return []
  }
  return data.map((entry) => decodeAy(entry)).filter((path) => path.length > 0)
}

function asManaged(raw: unknown): ManagedObjects {
  const top = raw as { data?: unknown }
  const data = top.data
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as ManagedObjects
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as ManagedObjects
  }
  throw new Error("udisks2 returned no objects.")
}

function stringProp(iface: Record<string, DbusValue> | undefined, name: string): string {
  const value = dbusData(iface?.[name])
  return typeof value === "string" ? value : ""
}

function boolProp(iface: Record<string, DbusValue> | undefined, name: string): boolean {
  return dbusData(iface?.[name]) === true
}

async function run(command: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(stderr.trim() || `${command} exited ${code}.`)
  }
  return stdout
}

async function busctl(args: string[]): Promise<unknown> {
  const stdout = await run("busctl", ["--json=short", "--system", ...args])
  const text = stdout.trim()
  if (text.length === 0) {
    return null
  }
  return JSON.parse(text) as unknown
}

function snapshotFromManaged(managed: ManagedObjects): UdisksSnapshot {
  const drives: UdisksDrive[] = []
  const blocks: UdisksBlock[] = []
  for (const [path, ifaces] of Object.entries(managed)) {
    const driveIface = ifaces[DRIVE_IFACE]
    if (driveIface) {
      drives.push({
        path,
        connectionBus: stringProp(driveIface, "ConnectionBus"),
        vendor: stringProp(driveIface, "Vendor"),
        model: stringProp(driveIface, "Model"),
      })
    }
    const blockIface = ifaces[BLOCK_IFACE]
    if (!blockIface) {
      continue
    }
    const fsIface = ifaces[FS_IFACE]
    blocks.push({
      path,
      drive: stringProp(blockIface, "Drive"),
      idType: stringProp(blockIface, "IdType"),
      idLabel: stringProp(blockIface, "IdLabel"),
      device: decodeAy(dbusData(blockIface.Device)),
      readOnly: boolProp(blockIface, "ReadOnly"),
      ignore: boolProp(blockIface, "HintIgnore"),
      mountPoints: decodeMountPoints(dbusData(fsIface?.MountPoints)),
    })
  }
  return { drives, blocks }
}

export async function fsVolumeStats(mountPoint: string): Promise<VolumeStats> {
  const stats = await statfs(mountPoint)
  const freeBytes = Number(stats.bavail) * Number(stats.bsize)
  let readOnly = false
  try {
    await access(mountPoint, constants.W_OK)
  } catch {
    readOnly = true
  }
  return { freeBytes, readOnly }
}

export const systemTransport: LinuxTransport = {
  getManagedObjects: async () => {
    const raw = await busctl(["call", UDISKS_SERVICE, UDISKS_ROOT, "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"])
    return snapshotFromManaged(asManaged(raw))
  },
  call: async (path, iface, method) => {
    const raw = await busctl([
      "call",
      UDISKS_SERVICE,
      path,
      iface,
      method,
      "a{sv}",
      "0",
    ])
    if (raw === null) {
      return null
    }
    const wrapped = raw as DbusValue
    if (wrapped.type === "s" && typeof wrapped.data === "string") {
      return wrapped.data
    }
    if (wrapped.type === "ay") {
      return decodeAy(wrapped.data)
    }
    return wrapped.data ?? null
  },
  udevProperties: async (deviceNode) => {
    const stdout = await run("udevadm", ["info", "--query=property", `--name=${deviceNode}`])
    const props: Record<string, string> = {}
    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=")
      if (eq <= 0) {
        continue
      }
      props[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return props
  },
  volumeStats: fsVolumeStats,
}
