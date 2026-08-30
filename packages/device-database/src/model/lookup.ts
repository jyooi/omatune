import { modelTable } from "./generated.ts"
import { parseModelNum } from "./parse-support-table.ts"
import type { FamilyRecord } from "./types.ts"

export function allFamilies(): ReadonlyArray<FamilyRecord> {
  return modelTable
}

function keyMatches(family: FamilyRecord, key: string): boolean {
  if (family.libgpodKeys.includes(key)) {
    return true
  }
  return family.libgpodKeys.some((pattern) => pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1)))
}

export function lookupByLibgpodKey(key: string): FamilyRecord | undefined {
  return modelTable.find((family) => keyMatches(family, key))
}

function rangeWidth(range: { start: number; end: number }): number {
  return range.end - range.start
}

export function lookupByModelNumStr(model: string): FamilyRecord | undefined {
  const needle = model.trim().toUpperCase()
  const exact = modelTable.find((family) => family.appleModels.includes(needle))
  if (exact) {
    return exact
  }
  const parsed = parseModelNum(needle)
  if (!parsed) {
    return undefined
  }
  let narrowest: FamilyRecord | undefined
  let narrowestWidth = Number.POSITIVE_INFINITY
  for (const family of modelTable) {
    for (const range of family.ranges) {
      if (range.prefix !== parsed.prefix || parsed.num < range.start || parsed.num > range.end) {
        continue
      }
      const width = rangeWidth(range)
      if (width < narrowestWidth) {
        narrowest = family
        narrowestWidth = width
      }
    }
  }
  if (narrowest) {
    return narrowest
  }
  return modelTable.find((family) =>
    family.onward.some((entry) => entry.prefix === parsed.prefix && parsed.num >= entry.start),
  )
}

export function lookupFamily(input: { modelString?: string | null; libgpodKey?: string | null }): FamilyRecord | undefined {
  if (input.modelString) {
    const byModel = lookupByModelNumStr(input.modelString)
    if (byModel) {
      return byModel
    }
  }
  if (input.libgpodKey) {
    return lookupByLibgpodKey(input.libgpodKey)
  }
  return undefined
}
