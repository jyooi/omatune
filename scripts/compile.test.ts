import { expect, test } from "bun:test"
import { TARGETS, assertToolPins, binaryName, hostTarget, opentuiCoreVersion } from "./compile.ts"

test("assertToolPins accepts the pinned Bun", () => {
  expect(() => assertToolPins()).not.toThrow()
})

test("opentui core pin matches the tui package", async () => {
  expect(await opentuiCoreVersion()).toBe("0.5.9")
})

test("binary names match the four release targets", () => {
  expect(TARGETS.map((target) => binaryName(target.name))).toEqual([
    "omatune-linux-x64",
    "omatune-linux-arm64",
    "omatune-darwin-arm64",
    "omatune-darwin-x64",
  ])
})

test("Linux targets pin glibc and Darwin leaves libc unset", () => {
  const linux = TARGETS.filter((target) => target.name.startsWith("linux-"))
  expect(linux.every((target) => target.libc === "glibc")).toBe(true)
  expect(TARGETS.filter((target) => target.name.startsWith("darwin-")).every((target) => target.libc === null)).toBe(
    true,
  )
})

test("host target matches this machine", () => {
  const key = `${process.platform}-${process.arch}`
  if (key === "linux-x64" || key === "linux-arm64" || key === "darwin-arm64" || key === "darwin-x64") {
    expect(hostTarget()).toBe(key)
    return
  }
  expect(() => hostTarget()).toThrow()
})
