import { expect, test } from "bun:test"
import { join } from "node:path"
import { allFamilies, lookupByLibgpodKey, lookupByModelNumStr } from "./lookup.ts"
import { parseSupportTable } from "./parse-support-table.ts"

const supportPath = join(import.meta.dir, "../../../../docs/support-table.md")

test("every support table family resolves to a Support Tier", async () => {
  const markdown = await Bun.file(supportPath).text()
  const rows = parseSupportTable(markdown)
  expect(rows.length).toBeGreaterThan(0)
  const families = allFamilies()
  expect(families.length).toBe(rows.length)
  for (const row of rows) {
    const family = families.find((entry) => entry.family === row.family)
    expect(family?.supportTier).toBe(row.supportTier)
    expect(family?.libgpodKeys).toEqual(row.libgpodKeys)
  }
})

test("classic 120 GB maps ModelNumStr and libgpod key", () => {
  const byModel = lookupByModelNumStr("MB562")
  const byKey = lookupByLibgpodKey("CLASSIC_2")
  expect(byModel?.family).toBe("iPod classic 120 GB (2008)")
  expect(byKey?.family).toBe(byModel?.family)
  expect(byKey?.supportTier).toBe("Verified")
  expect(byKey?.signature).toBe("hash58")
  expect(byKey?.playCountsEntryLength).toBe(0x1c)
  expect(byKey?.artworkFormatIds).toEqual([1055, 1060, 1061])
})

test("nano 5G is Unsupported", () => {
  const family = lookupByLibgpodKey("NANO_5")
  expect(family?.supportTier).toBe("Unsupported")
  expect(family?.notes.length).toBeGreaterThan(0)
})

test("nano 4G range includes an interior ModelNumStr", () => {
  const family = lookupByModelNumStr("MB700")
  expect(family?.family).toBe("iPod nano 4G")
})

test("exact appleModels match wins overlapping ranges", () => {
  expect(lookupByModelNumStr("MA004")?.family).toBe("iPod nano 1G")
  expect(lookupByModelNumStr("M9724")?.family).toBe("iPod shuffle 1G to 4G")
})

test("narrowest covering range wins before onward", () => {
  expect(lookupByModelNumStr("MA005")?.family).toBe("iPod nano 1G")
})
