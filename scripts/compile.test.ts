import { expect, test } from "bun:test"
import { BUN_VERSION, OPENTUI_CORE_VERSION, TARGETS, binaryName, hostTarget } from "./compile.ts"

test("release targets are the four compile names", () => {
  expect(TARGETS.map((target) => target.name)).toEqual([
    "linux-x64",
    "linux-arm64",
    "darwin-arm64",
    "darwin-x64",
  ])
  expect(TARGETS.map((target) => binaryName(target.name))).toEqual([
    "omatune-linux-x64",
    "omatune-linux-arm64",
    "omatune-darwin-arm64",
    "omatune-darwin-x64",
  ])
})

test("Linux targets pin glibc and Bun plus OpenTUI versions stay exact", () => {
  const linux = TARGETS.filter((target) => target.name.startsWith("linux-"))
  expect(linux.every((target) => target.libc === "glibc")).toBe(true)
  expect(TARGETS.filter((target) => target.name.startsWith("darwin-")).every((target) => target.libc === null)).toBe(
    true,
  )
  expect(BUN_VERSION).toBe("1.4.0")
  expect(OPENTUI_CORE_VERSION).toBe("0.5.9")
  expect(Bun.version).toBe(BUN_VERSION)
})

test("host target matches this machine", () => {
  if (process.platform === "linux" && process.arch === "x64") {
    expect(hostTarget()).toBe("linux-x64")
  }
})
