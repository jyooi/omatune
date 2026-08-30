import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { DeviceNotFound } from "./errors.ts"
import { ejectDevice, makeLinux } from "./linux.ts"
import type { LinuxTransport, UdisksBlock, UdisksDrive, UdisksSnapshot, VolumeStats } from "./linux-transport.ts"

const SERIAL = "000a27001395d5a3"
const DRIVE_PATH = "/org/freedesktop/UDisks2/drives/Apple_iPod_000A27001395D5A3"
const BLOCK_PATH = "/org/freedesktop/UDisks2/block_devices/sda1"
const DEVICE_NODE = "/dev/sda1"
const FS_IFACE = "org.freedesktop.UDisks2.Filesystem"
const DRIVE_IFACE = "org.freedesktop.UDisks2.Drive"

type Call = {
  path: string
  iface: string
  method: string
}

type Script = {
  drives: UdisksDrive[]
  blocks: UdisksBlock[]
  udev: Record<string, Record<string, string>>
  stats: Record<string, VolumeStats>
  mountResult?: string
}

function sieXml(firewire: string, model = "MB562"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>FirewireGuid</key>
<string>${firewire}</string>
<key>ModelNumStr</key>
<string>${model}</string>
</dict>
</plist>
`
}

function sysInfoText(firewire: string | null, model = "MB562"): string {
  const guid = firewire === null ? "" : `FirewireGuid: 0x${firewire.toUpperCase()}\n`
  return `ModelNumStr: ${model}\n${guid}`
}

async function makeVolume(
  controlName = "iPod_Control",
  options?: {
    itunes?: boolean
    device?: boolean
    sysInfo?: string
    sysInfoExtended?: string
    dirName?: string
  },
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), options?.dirName ?? "omatune-ipod-"))
  const control = join(root, controlName)
  if (options?.itunes !== false) {
    await mkdir(join(control, "iTunes"), { recursive: true })
  }
  if (options?.device !== false) {
    await mkdir(join(control, "Device"), { recursive: true })
  } else {
    await mkdir(control, { recursive: true })
  }
  if (options?.sysInfo !== undefined && options?.device !== false) {
    await writeFile(join(control, "Device", "SysInfo"), options.sysInfo)
  }
  if (options?.sysInfoExtended !== undefined && options?.device !== false) {
    await writeFile(join(control, "Device", "SysInfoExtended"), options.sysInfoExtended)
  }
  return root
}

function appleDrive(overrides?: Partial<UdisksDrive>): UdisksDrive {
  return {
    path: DRIVE_PATH,
    connectionBus: "usb",
    vendor: "Apple",
    model: "iPod",
    ...overrides,
  }
}

function appleBlock(mountPoint: string | null, overrides?: Partial<UdisksBlock>): UdisksBlock {
  return {
    path: BLOCK_PATH,
    drive: DRIVE_PATH,
    idType: "vfat",
    idLabel: "iPod",
    device: DEVICE_NODE,
    readOnly: false,
    ignore: false,
    mountPoints: mountPoint === null ? [] : [mountPoint],
    ...overrides,
  }
}

function appleUdev(serial = SERIAL.toUpperCase()): Record<string, string> {
  return {
    ID_VENDOR_ID: "05ac",
    ID_MODEL_ID: "1261",
    ID_SERIAL_SHORT: serial,
  }
}

class ScriptedTransport implements LinuxTransport {
  readonly calls: Call[] = []
  poweredOff = false

  constructor(private readonly script: Script) {}

  async getManagedObjects(): Promise<UdisksSnapshot> {
    return {
      drives: this.script.drives,
      blocks: this.script.blocks,
    }
  }

  async call(path: string, iface: string, method: string): Promise<unknown> {
    this.calls.push({ path, iface, method })
    if (method === "Mount") {
      const block = this.script.blocks.find((entry) => entry.path === path)
      const mountPoint = this.script.mountResult
      if (!mountPoint) {
        throw new Error("script has no mount result")
      }
      if (block) {
        const index = this.script.blocks.indexOf(block)
        this.script.blocks[index] = { ...block, mountPoints: [mountPoint] }
      }
      return mountPoint
    }
    if (method === "Unmount") {
      const block = this.script.blocks.find((entry) => entry.path === path)
      if (block) {
        const index = this.script.blocks.indexOf(block)
        this.script.blocks[index] = { ...block, mountPoints: [] }
      }
      return null
    }
    if (method === "PowerOff") {
      this.poweredOff = true
      return null
    }
    throw new Error(`unexpected method ${method}`)
  }

  async udevProperties(deviceNode: string): Promise<Record<string, string>> {
    return this.script.udev[deviceNode] ?? {}
  }

  async volumeStats(mountPoint: string): Promise<VolumeStats> {
    const stats = this.script.stats[mountPoint]
    if (!stats) {
      throw new Error(`no volume stats for ${mountPoint}`)
    }
    return stats
  }
}

function transportFor(
  volume: string,
  options?: {
    mounted?: boolean
    drive?: Partial<UdisksDrive>
    block?: Partial<UdisksBlock>
    udev?: Record<string, string>
    freeBytes?: number
    volumeReadOnly?: boolean
    extraDrives?: UdisksDrive[]
    extraBlocks?: UdisksBlock[]
  },
): ScriptedTransport {
  const mounted = options?.mounted ?? true
  return new ScriptedTransport({
    drives: [appleDrive(options?.drive), ...(options?.extraDrives ?? [])],
    blocks: [appleBlock(mounted ? volume : null, options?.block), ...(options?.extraBlocks ?? [])],
    udev: { [DEVICE_NODE]: options?.udev ?? appleUdev() },
    stats: {
      [volume]: {
        freeBytes: options?.freeBytes ?? 1024,
        readOnly: options?.volumeReadOnly ?? false,
      },
    },
    mountResult: volume,
  })
}

async function list(transport: ScriptedTransport) {
  return Effect.runPromise(makeLinux(transport).listDevices)
}

function listedMethods(transport: ScriptedTransport): string[] {
  return transport.calls.map((call) => call.method)
}

test("lists a USB Apple iPod after udev 05ac/1261 and records the serial", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfoExtended: sieXml(SERIAL),
  })
  const transport = transportFor(volume, { freeBytes: 4096 })
  const devices = await list(transport)
  expect(devices).toHaveLength(1)
  expect(devices[0]).toMatchObject({
    serial: SERIAL,
    vendorId: 0x05ac,
    productId: 0x1261,
    filesystemType: "vfat",
    mountPoint: volume,
    modelString: "MB562",
    freeBytes: 4096,
  })
  expect(listedMethods(transport)).not.toContain("Mount")
})

test("ignores drives that are not USB Apple iPod", async () => {
  const volume = await makeVolume()
  const transport = new ScriptedTransport({
    drives: [
      appleDrive({ connectionBus: "ata" }),
      appleDrive({ path: "/org/freedesktop/UDisks2/drives/Other", vendor: "Samsung", model: "SSD" }),
    ],
    blocks: [appleBlock(volume)],
    udev: { [DEVICE_NODE]: appleUdev() },
    stats: { [volume]: { freeBytes: 1, readOnly: false } },
  })
  expect(await list(transport)).toEqual([])
})

test("ignores Apple iPod with the wrong udev product id", async () => {
  const volume = await makeVolume()
  const transport = transportFor(volume, {
    udev: { ID_VENDOR_ID: "05ac", ID_MODEL_ID: "1260", ID_SERIAL_SHORT: SERIAL },
  })
  expect(await list(transport)).toEqual([])
})

test("refuses hfsplus with a reformat message and does not mount", async () => {
  const volume = await makeVolume()
  const transport = transportFor(volume, {
    mounted: false,
    block: { idType: "hfsplus" },
  })
  await expect(list(transport)).rejects.toMatchObject({ message: "Reformat the Device to FAT32." })
  expect(listedMethods(transport)).not.toContain("Mount")
})

test("refuses a non-vfat volume with a reformat message", async () => {
  const volume = await makeVolume()
  const transport = transportFor(volume, { block: { idType: "exfat" } })
  await expect(list(transport)).rejects.toMatchObject({ message: "Reformat the Device to FAT32." })
})

test("refuses a read-only block before mount", async () => {
  const volume = await makeVolume()
  const transport = transportFor(volume, {
    mounted: false,
    block: { readOnly: true },
  })
  await expect(list(transport)).rejects.toMatchObject({ message: "The Device is mounted read-only." })
  expect(listedMethods(transport)).not.toContain("Mount")
})

test("refuses a read-only mount before any write", async () => {
  const volume = await makeVolume("iPod_Control", { sysInfoExtended: sieXml(SERIAL) })
  const transport = transportFor(volume, { volumeReadOnly: true })
  await expect(list(transport)).rejects.toMatchObject({ message: "The Device is mounted read-only." })
  expect(listedMethods(transport)).not.toContain("Unmount")
  expect(listedMethods(transport)).not.toContain("PowerOff")
})

test("mounts through udisks2 when the volume is not mounted", async () => {
  const volume = await makeVolume("iPod_Control", { sysInfoExtended: sieXml(SERIAL) })
  const transport = transportFor(volume, { mounted: false, freeBytes: 2048 })
  const devices = await list(transport)
  expect(devices[0]?.mountPoint).toBe(volume)
  expect(devices[0]?.freeBytes).toBe(2048)
  expect(transport.calls).toContainEqual({ path: BLOCK_PATH, iface: FS_IFACE, method: "Mount" })
})

test("uses SysInfoExtended FireWire ID first", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfoExtended: sieXml("aaaaaaaaaaaaaaaa"),
    sysInfo: sysInfoText("aaaaaaaaaaaaaaaa"),
  })
  const transport = transportFor(volume, { udev: appleUdev("AAAAAAAAAAAAAAAA") })
  const devices = await list(transport)
  expect(devices[0]?.serial).toBe("aaaaaaaaaaaaaaaa")
})

test("SysInfo with only FirewireGuid leaves modelString null", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfo: "FirewireGuid: 0x000A27001395D5A3\n",
  })
  const transport = transportFor(volume)
  const devices = await list(transport)
  expect(devices).toHaveLength(1)
  expect(devices[0]?.serial).toBe(SERIAL)
  expect(devices[0]?.modelString).toBe(null)
  expect(devices[0]?.productId).toBe(0x1261)
})

test("uses non-empty SysInfo FireWire ID when SysInfoExtended is absent", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfo: sysInfoText(SERIAL),
  })
  const transport = transportFor(volume)
  const devices = await list(transport)
  expect(devices[0]?.serial).toBe(SERIAL)
  expect(devices[0]?.modelString).toBe("MB562")
})

test("uses USB serial when SysInfo is empty and SysInfoExtended is absent", async () => {
  const volume = await makeVolume("iPod_Control", { sysInfo: "" })
  const transport = transportFor(volume)
  const devices = await list(transport)
  expect(devices[0]?.serial).toBe(SERIAL)
})

test("refuses when FireWire ID sources disagree", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfoExtended: sieXml("aaaaaaaaaaaaaaaa"),
    sysInfo: sysInfoText("bbbbbbbbbbbbbbbb"),
  })
  const transport = transportFor(volume)
  await expect(list(transport)).rejects.toMatchObject({
    message: "The Device FireWire ID sources disagree.",
  })
})

test("refuses when SysInfoExtended disagrees with the USB serial", async () => {
  const volume = await makeVolume("iPod_Control", {
    sysInfoExtended: sieXml("aaaaaaaaaaaaaaaa"),
  })
  const transport = transportFor(volume)
  await expect(list(transport)).rejects.toMatchObject({
    message: "The Device FireWire ID sources disagree.",
  })
})

test("resolves iPod_Control case-insensitively and requires iTunes and Device", async () => {
  const volume = await makeVolume("IPOD_CONTROL", {
    sysInfoExtended: sieXml(SERIAL),
  })
  const transport = transportFor(volume)
  const devices = await list(transport)
  expect(devices[0]?.serial).toBe(SERIAL)
})

test("refuses when iTunes or Device is missing under iPod_Control", async () => {
  const volume = await makeVolume("iPod_Control", { device: false, itunes: true })
  const transport = transportFor(volume)
  await expect(list(transport)).rejects.toMatchObject({
    message: "The Device is missing iPod_Control/iTunes or iPod_Control/Device.",
  })
})

test("unmounts and powers off after a Sync", async () => {
  const volume = await makeVolume("iPod_Control", { sysInfoExtended: sieXml(SERIAL) })
  const transport = transportFor(volume)
  const api = makeLinux(transport)
  await Effect.runPromise(api.listDevices)
  await Effect.runPromise(ejectDevice(api, SERIAL, false))
  expect(transport.calls).toContainEqual({ path: BLOCK_PATH, iface: FS_IFACE, method: "Unmount" })
  expect(transport.calls).toContainEqual({ path: DRIVE_PATH, iface: DRIVE_IFACE, method: "PowerOff" })
  expect(transport.poweredOff).toBe(true)
})

test("--no-eject skips unmount and power off", async () => {
  const volume = await makeVolume("iPod_Control", { sysInfoExtended: sieXml(SERIAL) })
  const transport = transportFor(volume)
  const api = makeLinux(transport)
  await Effect.runPromise(api.listDevices)
  await Effect.runPromise(ejectDevice(api, SERIAL, true))
  expect(listedMethods(transport)).not.toContain("Unmount")
  expect(listedMethods(transport)).not.toContain("PowerOff")
  expect(transport.poweredOff).toBe(false)
})

test("volume label bytes that are not ASCII do not break path handling", async () => {
  const parent = await mkdtemp(join(tmpdir(), "omatune-label-"))
  const volume = join(parent, "___ق_IPOD")
  await mkdir(join(volume, "iPod_Control", "iTunes"), { recursive: true })
  await mkdir(join(volume, "iPod_Control", "Device"), { recursive: true })
  await writeFile(join(volume, "iPod_Control", "Device", "SysInfoExtended"), sieXml(SERIAL))
  const transport = transportFor(volume, {
    block: { idLabel: "___ق_IPOD" },
    freeBytes: 512,
  })
  const devices = await list(transport)
  expect(devices[0]?.mountPoint).toBe(volume)
  expect(devices[0]?.serial).toBe(SERIAL)
})

test("unmount of an unknown serial fails DeviceNotFound", async () => {
  const api = makeLinux(
    new ScriptedTransport({
      drives: [],
      blocks: [],
      udev: {},
      stats: {},
    }),
  )
  const result = await Effect.runPromise(api.unmount("ffffffffffffffff").pipe(Effect.flip))
  expect(result).toBeInstanceOf(DeviceNotFound)
  expect(result.serial).toBe("ffffffffffffffff")
})
