import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { parseArtworkdb, parseItunesdb, serializeArtworkdb, serializeItunesdb, tracksOf } from "../src/index.ts"
import { writeSyntheticFixture, type Manifest } from "../src/synthetic.ts"
import { syntheticFixtureDir } from "./fixture-paths.ts"

const repoRoot = join(import.meta.dir, "../../..")
const audioRoot = join(repoRoot, "fixtures/audio")
const manifestPath = join(audioRoot, "manifest.json")

describe("synthetic Fixture", () => {
  test("regenerates committed bytes", async () => {
    const committedDir = syntheticFixtureDir()
    const committedItunes = join(committedDir, "iTunes", "iTunesDB")
    if (!existsSync(committedItunes)) {
      throw new Error("synthetic Fixture is missing")
    }
    const manifest = (await Bun.file(manifestPath).json()) as Manifest
    const temp = await mkdtemp(join(tmpdir(), "omatune-synthetic-"))
    await writeSyntheticFixture(audioRoot, temp, manifest)
    const names = ["iTunes/iTunesDB", "Artwork/ArtworkDB", "Artwork/F1055_1.ithmb", "Artwork/F1060_1.ithmb", "Artwork/F1061_1.ithmb", "SHA256SUMS"]
    let i = 0
    while (i < names.length) {
      const name = names[i]
      i += 1
      if (!name) {
        continue
      }
      const left = new Uint8Array(await Bun.file(join(committedDir, name)).bytes())
      const right = new Uint8Array(await Bun.file(join(temp, name)).bytes())
      expect(left.byteLength).toBe(right.byteLength)
      expect(firstMismatch(left, right)).toBe(-1)
    }
  })

  test("synthetic iTunesDB parses and round-trips", async () => {
    const path = join(syntheticFixtureDir(), "iTunes", "iTunesDB")
    const bytes = new Uint8Array(await Bun.file(path).bytes())
    const db = parseItunesdb(bytes)
    const out = serializeItunesdb(db)
    expect(firstMismatch(bytes, out)).toBe(-1)
    expect(tracksOf(db).length).toBe(12)
  })

  test("synthetic ArtworkDB parses and round-trips", async () => {
    const path = join(syntheticFixtureDir(), "Artwork", "ArtworkDB")
    const bytes = new Uint8Array(await Bun.file(path).bytes())
    const db = parseArtworkdb(bytes)
    const out = serializeArtworkdb(db)
    expect(firstMismatch(bytes, out)).toBe(-1)
  })
})

function firstMismatch(left: Uint8Array, right: Uint8Array): number {
  const limit = Math.min(left.byteLength, right.byteLength)
  let i = 0
  while (i < limit) {
    if (left[i] !== right[i]) {
      return i
    }
    i += 1
  }
  if (left.byteLength !== right.byteLength) {
    return limit
  }
  return -1
}
