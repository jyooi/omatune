export type Flags = {
  subcommand: string | null
  json: boolean
  yes: boolean
  noEject: boolean
  strict: boolean
  device: string | null
  forceModel: string | null
  config: string | null
}

export type ParseFailure = {
  message: string
}

export type RunIo = {
  stdin?: string
  stderrWrite?: (text: string) => void
  stdoutWrite?: (text: string) => void
}

export type RunResult = {
  code: 0 | 1 | 2
  stdout: string
  stderr: string
}

const VALUE_FLAGS = new Set(["--device", "--force-model", "--config"])
const BOOL_FLAGS = new Set(["--json", "--yes", "--no-eject", "--strict"])

export function parseArgv(argv: ReadonlyArray<string>): Flags | ParseFailure {
  const flags: Flags = {
    subcommand: null,
    json: false,
    yes: false,
    noEject: false,
    strict: false,
    device: null,
    forceModel: null,
    config: null,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === undefined) {
      break
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      const name = eq === -1 ? arg : arg.slice(0, eq)
      const inline = eq === -1 ? undefined : arg.slice(eq + 1)
      if (BOOL_FLAGS.has(name)) {
        if (inline !== undefined) {
          return { message: `Flag ${name} does not take a value.` }
        }
        if (name === "--json") flags.json = true
        if (name === "--yes") flags.yes = true
        if (name === "--no-eject") flags.noEject = true
        if (name === "--strict") flags.strict = true
        i += 1
        continue
      }
      if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[i + 1]
        if (!value || value.startsWith("--")) {
          return { message: `Flag ${name} needs a value.` }
        }
        if (name === "--device") flags.device = value
        if (name === "--force-model") flags.forceModel = value
        if (name === "--config") flags.config = value
        i += inline !== undefined ? 1 : 2
        continue
      }
      return { message: `Unknown flag ${name}.` }
    }
    if (flags.subcommand === null) {
      flags.subcommand = arg
      i += 1
      continue
    }
    return { message: `Unexpected argument ${arg}.` }
  }

  return flags
}
