import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { formatTable } from "../src/model/format-table.ts"
import { parseSupportTable } from "../src/model/parse-support-table.ts"

const repoRoot = join(import.meta.dir, "../../..")
const supportPath = join(repoRoot, "docs/support-table.md")
const outPath = join(import.meta.dir, "../src/model/generated.ts")

const markdown = await Bun.file(supportPath).text()
const rows = parseSupportTable(markdown)

const missing = rows.filter((row) => formatTable[row.family] === undefined).map((row) => row.family)
if (missing.length > 0) {
  throw new Error(`Format table missing families: ${missing.join(", ")}`)
}

const extra = Object.keys(formatTable).filter((family) => !rows.some((row) => row.family === family))
if (extra.length > 0) {
  throw new Error(`Format table has extra families: ${extra.join(", ")}`)
}

const records = rows.map((row) => {
  const format = formatTable[row.family]
  if (format === undefined) {
    throw new Error(`Format table missing family ${row.family}`)
  }
  return {
    family: row.family,
    libgpodKeys: row.libgpodKeys,
    appleModels: row.appleModels,
    ranges: row.ranges,
    onward: row.onward,
    supportTier: row.supportTier,
    verifiedBy: row.verifiedBy,
    notes: row.notes,
    ...format,
  }
})

const body = `import type { FamilyRecord } from "./types.ts"

// Generated from docs/support-table.md and src/model/format-table.ts.
// Do not edit. Run: bun run generate

export const modelTable: ReadonlyArray<FamilyRecord> = ${JSON.stringify(records, null, 2)}
`

await mkdir(dirname(outPath), { recursive: true })
await Bun.write(outPath, body)
console.log(`Wrote ${records.length} families to ${outPath}`)
