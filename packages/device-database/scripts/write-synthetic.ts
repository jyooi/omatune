import { join } from "node:path"
import { writeSyntheticFixture, type Manifest } from "../src/synthetic.ts"

const repoRoot = join(import.meta.dir, "../../..")
const audioRoot = join(repoRoot, "fixtures/audio")
const outDir = join(repoRoot, "fixtures/device/synthetic-classic")
const manifest = (await Bun.file(join(audioRoot, "manifest.json")).json()) as Manifest
const written = await writeSyntheticFixture(audioRoot, outDir, manifest)
console.log(`wrote ${written.length} files to ${outDir}`)
