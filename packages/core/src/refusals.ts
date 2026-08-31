export const LIBRARY_NOT_SET =
  'library is not set. Uncomment line 3 and point it at your music folder, e.g. library = "/home/you/Music".'

export const SELECTION_EMPTY = "Selection is empty - tick Tracks with Space first."

export const NO_DEVICE_ATTACHED = "No Device attached. Plug in a Device and run again."

export const PASS_DEVICE_OR_ATTACH_ONE = "Pass --device SERIAL or attach one Device."

export const SKIPPED_STRICT =
  "Skipped or Unlisted files in --strict mode. Drop --strict or fix them."

export const DEVICE_FULL = "Device is full. Free space on the Device and Sync again."

export function starterConfigRefusal(path: string): string {
  return `Wrote starter config ${path}. ${LIBRARY_NOT_SET}`
}

export function needsDeviceFlag(command: string): string {
  return `${command} needs --device. Pass --device SERIAL.`
}

export function unknownDevice(serial: string): string {
  return `Unknown Device ${serial}. Register it with omatune register --device ${serial}.`
}

export function deviceNotAttached(serial: string): string {
  return `Device ${serial} is not attached. Plug in that Device and run again.`
}

export function deviceNotMounted(serial: string): string {
  return `Device ${serial} is not mounted. Remount it and run again.`
}

export function unknownForceModel(key: string): string {
  return `Unknown --force-model key ${key}. Pass a key from docs/support-table.md.`
}

export function unknownFamily(familyName: string | null): string {
  if (familyName === null) {
    return "Unknown Device family. See docs/support-table.md, or pass --force-model KEY."
  }
  return `Device family ${familyName} is Unsupported. See docs/support-table.md.`
}

export function deviceLocked(serial: string): string {
  return `Device ${serial} is locked. Wait for the other Sync to finish.`
}

export function selectionDoesNotFit(needed: number, free: number): string {
  return `Selection does not fit. Needs ${needed} bytes. Device has ${free} bytes free. Remove Tracks from the Selection.`
}

export function unknownCommand(command: string): string {
  return `Unknown command ${command}. Use devices, status, register, plan, or sync.`
}

export function malformedJson(kind: string): string {
  return `Malformed ${kind} JSON. Delete the file and Sync again to rebuild it.`
}

export function unsupportedVersion(kind: string, version: number): string {
  return `Unsupported ${kind} version ${version}. Delete the file and Sync again to rebuild it.`
}
