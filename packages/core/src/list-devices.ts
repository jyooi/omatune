import { Platform } from "@omatune/platform"
import { Effect } from "effect"
import { toDeviceReport, type DeviceReport } from "./device-report.ts"

export const listDeviceReports: Effect.Effect<ReadonlyArray<DeviceReport>, never, Platform> =
  Effect.gen(function* () {
    const platform = yield* Platform
    const attached = yield* platform.listDevices
    const reports: DeviceReport[] = []
    for (const info of attached) {
      reports.push(yield* Effect.promise(() => toDeviceReport(info)))
    }
    return reports
  })
