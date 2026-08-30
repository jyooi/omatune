export {
  allFamilies,
  lookupByLibgpodKey,
  lookupByModelNumStr,
  lookupFamily,
} from "./model/lookup.ts"
export { modelTable } from "./model/generated.ts"
export { parseSupportTable } from "./model/parse-support-table.ts"
export type {
  FamilyFormat,
  FamilyRecord,
  ModelOnward,
  ModelRange,
  SignatureScheme,
  SupportTier,
} from "./model/types.ts"
export { ItunesdbParseError } from "./error.ts";
export {
  parseChunk,
  serializeChunk,
  type Chunk,
  type ChunkId,
  type ParsedChunk,
} from "./chunk.ts";
export {
  HASH58_LENGTH,
  HASH58_OFFSET,
  HASH72_LENGTH,
  HASH72_OFFSET,
  databaseVersion,
  hash58,
  hash72,
  hashingScheme,
  mhodType,
  mhsdType,
  parseItunesdb,
  parseMhbd,
  parseMhip,
  parseMhit,
  parseMhlp,
  parseMhlt,
  parseMhod,
  parseMhsd,
  parseMhyp,
  serializeItunesdb,
  serializeMhbd,
  serializeMhip,
  serializeMhit,
  serializeMhlp,
  serializeMhlt,
  serializeMhod,
  serializeMhsd,
  serializeMhyp,
  type Itunesdb,
} from "./codec.ts";
export {
  trackFromMhit,
  tracksOf,
  type Gapless,
  type PlayData,
  type Track,
} from "./track.ts";
