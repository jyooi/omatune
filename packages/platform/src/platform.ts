import { Context, type Effect } from "effect"
import type { DeviceInfo } from "./device-info.ts"
import type { DeviceNotFound } from "./errors.ts"

export type PlatformApi = {
  readonly listDevices: Effect.Effect<ReadonlyArray<DeviceInfo>>
  readonly mount: (serial: string) => Effect.Effect<void, DeviceNotFound>
  readonly unmount: (serial: string) => Effect.Effect<void, DeviceNotFound>
  readonly powerOff: (serial: string) => Effect.Effect<void, DeviceNotFound>
  readonly now: Effect.Effect<number>
}

export class Platform extends Context.Tag("omatune/Platform")<Platform, PlatformApi>() {}
