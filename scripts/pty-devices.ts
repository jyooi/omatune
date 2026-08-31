#!/usr/bin/env bun
import { resolve } from "node:path"

const PYTHON = `
import os
import pty
import sys

bin_path = sys.argv[1]
argv = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(bin_path, argv)
chunks = []
while True:
    try:
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data:
        break
    chunks.append(data)
sys.stdout.buffer.write(b"".join(chunks))
_pid, status = os.waitpid(pid, 0)
raise SystemExit(os.waitstatus_to_exitcode(status))
`

function stripPty(text: string): string {
  return text.replaceAll("\r", "").replaceAll("\u0000", "").trim()
}

export async function runDevicesJsonInPty(binary: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const abs = resolve(binary)
  const file = Bun.file(abs)
  if (file.size === 0) {
    throw new Error(`Binary not found: ${abs}`)
  }
  const proc = Bun.spawn(["python3", "-c", PYTHON, abs, "devices", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, stdout, stderr }
}

export function assertEmptyDeviceList(result: { code: number; stdout: string; stderr: string }): void {
  if (result.code !== 0) {
    throw new Error(`devices --json exited ${result.code}.\n${result.stderr}\n${result.stdout}`)
  }
  const output = stripPty(result.stdout)
  if (output !== "") {
    throw new Error(`Expected an empty Device list. Output:\n${output}`)
  }
}

async function main(): Promise<void> {
  const binary = Bun.argv[2]
  if (!binary) {
    throw new Error("Pass the compiled binary path.")
  }
  const result = await runDevicesJsonInPty(binary)
  assertEmptyDeviceList(result)
}

if (import.meta.main) {
  await main()
}
