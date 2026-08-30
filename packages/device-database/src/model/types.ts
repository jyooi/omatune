export type SupportTier = "Verified" | "Expected" | "Unsupported"

export type SignatureScheme =
  | "none"
  | "hash58"
  | "hash72"
  | "hashAB"
  | "itunes-sd"

export type ModelRange = {
  readonly prefix: string
  readonly start: number
  readonly end: number
}

export type ModelOnward = {
  readonly prefix: string
  readonly start: number
}

export type FamilyFormat = {
  readonly signature: SignatureScheme
  readonly playCountsEntryLength: number
  readonly artworkFormatIds: ReadonlyArray<number>
  readonly fxxFolderCount: number
  readonly gapless: boolean
  readonly colourScreen: boolean
}

export type FamilyRecord = FamilyFormat & {
  readonly family: string
  readonly libgpodKeys: ReadonlyArray<string>
  readonly appleModels: ReadonlyArray<string>
  readonly ranges: ReadonlyArray<ModelRange>
  readonly onward: ReadonlyArray<ModelOnward>
  readonly supportTier: SupportTier
  readonly verifiedBy: string
  readonly notes: string
}
