import { existsSync } from "node:fs"
import { join } from "node:path"
import { FAKE_SERIAL } from "../src/scrub.ts"

const packageRoot = join(import.meta.dir, "..")
const deviceRoot = join(packageRoot, "..", "..", "fixtures", "device")

export type FixtureCase = {
  name: string
  dir: string
  serial: string | null
}

export function publicFixture(): FixtureCase {
  return {
    name: "public CLASSIC_2",
    dir: join(deviceRoot, "CLASSIC_2"),
    serial: FAKE_SERIAL,
  }
}

export function privateFixture(): FixtureCase {
  return {
    name: "private ipod-classic-120gb",
    dir: join(deviceRoot, "ipod-classic-120gb"),
    serial: null,
  }
}

export function syntheticFixtureDir(): string {
  return join(deviceRoot, "synthetic-classic")
}

export function goldenCases(): FixtureCase[] {
  const cases: FixtureCase[] = []
  const pub = publicFixture()
  if (existsSync(join(pub.dir, "iTunes", "iTunesDB"))) {
    cases.push(pub)
  }
  const priv = privateFixture()
  if (existsSync(join(priv.dir, "iTunes", "iTunesDB"))) {
    cases.push(priv)
  }
  return cases
}

export function itunesdbPath(dir: string): string {
  return join(dir, "iTunes", "iTunesDB")
}

export function playCountsPath(dir: string): string {
  return join(dir, "iTunes", "Play Counts")
}

export function artworkdbPath(dir: string): string {
  return join(dir, "Artwork", "ArtworkDB")
}
