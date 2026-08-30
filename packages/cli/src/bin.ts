#!/usr/bin/env bun
import { runMain } from "./main.ts"

const result = await runMain(Bun.argv.slice(2))
if (result.stdout.length > 0) {
  await Bun.write(Bun.stdout, result.stdout)
}
if (result.stderr.length > 0) {
  await Bun.write(Bun.stderr, result.stderr)
}
process.exit(result.code)
