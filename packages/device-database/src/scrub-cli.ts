#!/usr/bin/env bun

import { scrubMount } from "./scrub.ts"

const usage = "usage: bun run scrub <mount> <out-dir> --model CLASSIC_2"

function parseArgs(argv: string[]): { mount: string, outDir: string, model: string } {
  const position: string[] = []
  let model: string | null = null
  let i = 0
  while (i < argv.length) {
    const arg = argv[i] ?? ""
    i += 1
    if (arg === "--model") {
      model = argv[i] ?? ""
      i += 1
      continue
    }
    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length)
      continue
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage)
      process.exit(0)
    }
    position.push(arg)
  }
  const mount = position[0]
  const outDir = position[1]
  if (!mount || !outDir || !model) {
    console.error(usage)
    process.exit(1)
  }
  return { mount, outDir, model }
}

const args = parseArgs(Bun.argv.slice(2))
try {
  const written = await scrubMount(args.mount, args.outDir, args.model)
  console.log(`wrote ${written.length} files to ${args.outDir}`)
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause)
  console.error(message)
  process.exit(1)
}
