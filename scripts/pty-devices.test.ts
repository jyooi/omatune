import { expect, test } from "bun:test"
import { assertEmptyDeviceList } from "./pty-devices.ts"

test("empty Device list allows blank pty output and exit 0", () => {
  assertEmptyDeviceList({ code: 0, stdout: "\r\n", stderr: "" })
})

test("empty Device list rejects a Device JSON line", () => {
  expect(() =>
    assertEmptyDeviceList({
      code: 0,
      stdout: '{"serial":"aaaaaaaaaaaaaaaa"}',
      stderr: "",
    }),
  ).toThrow(/empty Device list/)
})

test("empty Device list rejects a non-zero exit", () => {
  expect(() => assertEmptyDeviceList({ code: 1, stdout: "", stderr: "fail" })).toThrow(/exited 1/)
})
