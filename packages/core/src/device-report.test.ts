import { expect, test } from "bun:test"
import type { DeviceInfo } from "@omatune/platform"
import { toDeviceReport } from "./device-report.ts"

test("SysInfo FirewireGuid only resolves classic family from USB product id", async () => {
  const info: DeviceInfo = {
    serial: "000a27001395d5a3",
    vendorId: 0x05ac,
    productId: 0x1261,
    filesystemType: "vfat",
    mountPoint: null,
    modelString: null,
    freeBytes: 114418106368,
  }
  const report = await toDeviceReport(info)
  expect(report.serial).toBe("000a27001395d5a3")
  expect(report.family).toBe("iPod classic 120 GB (2008)")
  expect(report.supportTier).toBe("Verified")
})
