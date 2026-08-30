import type { ModelOnward, ModelRange, SupportTier } from "./types.ts"

export type SupportRow = {
  family: string
  appleModelsRaw: string
  appleModels: string[]
  ranges: ModelRange[]
  onward: ModelOnward[]
  libgpodKeys: string[]
  supportTier: SupportTier
  verifiedBy: string
  notes: string
}

const TIERS = new Set<SupportTier>(["Verified", "Expected", "Unsupported"])

export function parseModelNum(token: string): { prefix: string; num: number } | null {
  const match = token.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null
  }
  return { prefix: match[1], num: Number(match[2]) }
}

export function parseAppleModels(raw: string): {
  appleModels: string[]
  ranges: ModelRange[]
  onward: ModelOnward[]
} {
  const appleModels: string[] = []
  const ranges: ModelRange[] = []
  const onward: ModelOnward[] = []
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean)

  for (const part of parts) {
    const onwardMatch = part.match(/^([A-Za-z]+\d+)\s+onward$/i)
    if (onwardMatch && onwardMatch[1] !== undefined) {
      const parsed = parseModelNum(onwardMatch[1])
      if (parsed) {
        onward.push({ prefix: parsed.prefix, start: parsed.num })
        appleModels.push(onwardMatch[1].toUpperCase())
      }
      continue
    }

    const rangeMatch = part.match(/^([A-Za-z]+\d+)\s+to\s+([A-Za-z]+\d+)$/i)
    if (rangeMatch && rangeMatch[1] !== undefined && rangeMatch[2] !== undefined) {
      const start = parseModelNum(rangeMatch[1])
      const end = parseModelNum(rangeMatch[2])
      appleModels.push(rangeMatch[1].toUpperCase())
      appleModels.push(rangeMatch[2].toUpperCase())
      if (start && end && start.prefix === end.prefix) {
        ranges.push({ prefix: start.prefix, start: start.num, end: end.num })
      }
      continue
    }

    appleModels.push(part.toUpperCase())
  }

  return { appleModels, ranges, onward }
}

export function parseSupportTable(markdown: string): SupportRow[] {
  const rows: SupportRow[] = []
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      continue
    }
    const cells = line.split("|").map((cell) => cell.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1)
    if (cells.length < 6) {
      continue
    }
    const family = cells[0] ?? ""
    const appleModelsRaw = cells[1] ?? ""
    const libgpodRaw = cells[2] ?? ""
    const tier = cells[3] ?? ""
    const verifiedBy = cells[4] ?? ""
    const notes = cells[5] ?? ""
    if (family === "Family" || family.startsWith("---")) {
      continue
    }
    if (!TIERS.has(tier as SupportTier)) {
      throw new Error(`Unknown Support Tier ${tier} for family ${family}`)
    }
    const parsedModels = parseAppleModels(appleModelsRaw)
    rows.push({
      family,
      appleModelsRaw,
      appleModels: parsedModels.appleModels,
      ranges: parsedModels.ranges,
      onward: parsedModels.onward,
      libgpodKeys: libgpodRaw.split(",").map((key) => key.trim()).filter(Boolean),
      supportTier: tier as SupportTier,
      verifiedBy,
      notes,
    })
  }
  return rows
}
