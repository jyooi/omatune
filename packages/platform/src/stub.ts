import { Effect, Layer } from "effect"
import { DeviceNotFound } from "./errors.ts"
import { Platform } from "./platform.ts"

const notFound = (serial: string) => Effect.fail(new DeviceNotFound({ serial }))

export const stubLayer: Layer.Layer<Platform> = Layer.succeed(Platform, {
  listDevices: Effect.succeed([]),
  mount: notFound,
  unmount: notFound,
  powerOff: notFound,
  now: Effect.sync(() => Date.now()),
})
