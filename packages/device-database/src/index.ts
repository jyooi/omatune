export {
  allFamilies,
  lookupByLibgpodKey,
  lookupByModelNumStr,
  lookupFamily,
} from "./model/lookup.ts"
export { modelTable } from "./model/generated.ts"
export { parseSupportTable } from "./model/parse-support-table.ts"
export {
  artworkFormatRow,
  artworkFormatRows,
} from "./model/format-table.ts"
export type { ArtworkFormatRow } from "./model/format-table.ts"
export type {
  FamilyFormat,
  FamilyRecord,
  ModelOnward,
  ModelRange,
  SignatureScheme,
  SupportTier,
} from "./model/types.ts"
export { ItunesdbParseError } from "./error.ts";
export { ItunesdbSignatureError } from "./signature-error.ts";
export { firewireIdFromSerial, signHash58 } from "./hash58.ts";
export { signItunesdb, signItunesdbForFamily } from "./signature.ts";
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
export {
  PlayCountsParseError,
  isPlayCountsParseError,
  parsePlayCounts,
  playCountsForTracks,
  serializePlayCounts,
  type ParsePlayCountsResult,
  type PlayCounts,
  type PlayCountsEntry,
  type PlayCountsParseReason,
} from "./play-counts.ts";
export {
  artworkFiles,
  fileItems,
  imageItems,
  mhifFormatId,
  mhifImageSize,
  mhiiDbid,
  parseArtworkdb,
  parseMhfd,
  parseMhif,
  parseMhii,
  parseMhli,
  parseMhlf,
  parseMhni,
  serializeArtworkdb,
  serializeMhfd,
  serializeMhif,
  serializeMhii,
  serializeMhli,
  serializeMhlf,
  serializeMhni,
  thumbnailsOf,
  type ArtworkFile,
  type ArtworkThumb,
  type Artworkdb,
} from "./artwork.ts";
export {
  extractThumbnailPpm,
  rgb565LeToRgb888,
  rgb888ToRgb565Le,
  splitIthmbBlocks,
  writePpm,
} from "./ithmb.ts";
export {
  buildArtworkdb,
  type ArtworkFileSpec,
  type ArtworkImageSpec,
  type ArtworkThumbSpec,
} from "./artwork-write.ts";
export {
  FAKE_SERIAL,
  pathPlaceholder,
  placeholderText,
  remapPersistentId,
  scrubArtworkdbBytes,
  scrubItunesdbBytes,
  scrubIthmb,
  scrubMount,
  signScrubbedItunesdb,
} from "./scrub.ts";
export {
  buildSyntheticItunesdb,
  dbidForPath,
  writeSyntheticFixture,
  type Manifest,
  type ManifestTrack,
  type SyntheticTrack,
} from "./synthetic.ts";
export {
  MHIT_FILE_TYPE,
  MHIT_GAPLESS_ALBUM_FLAG,
  MHIT_GAPLESS_TRACK_FLAG,
  MHIT_MEDIA_TYPE,
  MHIT_TYPE_1,
  MHIT_TYPE_2,
  MHIT_UNKNOWN_D0,
  MHYP_MASTER_FLAG,
  MHYP_PERSISTENT_ID,
  MHYP_STRING_MHOD_COUNT,
  MHOD_COUNT,
  fileTypeCodeFor,
  firmwareProblems,
  firmwareReadable,
  formatBytesFor,
  type FirmwareProblem,
} from "./firmware.ts";
