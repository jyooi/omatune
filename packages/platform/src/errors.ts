import { Data } from "effect"

export class DeviceNotFound extends Data.TaggedError("DeviceNotFound")<{
  readonly serial: string
}> {}
