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

export function lookupByModelNumStr(model: string): FamilyRecord | undefined {
  const needle = model.trim().toUpperCase()
  const parsed = parseModelNum(needle)
  for (const family of modelTable) {
    if (family.appleModels.includes(needle)) {
      return family
    }
    if (!parsed) {
      continue
    }
    if (family.ranges.some((range) => range.prefix === parsed.prefix && parsed.num >= range.start && parsed.num <= range.end)) {
      return family
    }
    if (family.onward.some((entry) => entry.prefix === parsed.prefix && parsed.num >= entry.start)) {
      return family
    }
  }
  return undefined
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
