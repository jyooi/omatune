import { expect, test } from "bun:test"
import { assertToolPins, hostTarget, opentuiCoreVersion } from "./compile.ts"

test("assertToolPins accepts the pinned Bun", () => {
  expect(() => assertToolPins()).not.toThrow()
})

test("opentui core pin matches the tui package", async () => {
  expect(await opentuiCoreVersion()).toBe("0.5.9")
})

test("host target matches this machine", () => {
  const key = `${process.platform}-${process.arch}`
  if (key === "linux-x64" || key === "linux-arm64" || key === "darwin-arm64" || key === "darwin-x64") {
    expect(hostTarget()).toBe(key)
    return
  }
  expect(() => hostTarget()).toThrow()
})
