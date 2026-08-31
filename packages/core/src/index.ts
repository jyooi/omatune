export { toDeviceReport, ownerStateFor, isFat32 } from "./device-report.ts"
export type { DeviceReport, OwnerState } from "./device-report.ts"
export { ExitCode } from "./exit-code.ts"
export type { ExitCode as ExitCodeValue } from "./exit-code.ts"
export { listDeviceReports } from "./list-devices.ts"
export {
  adoptDevice,
  emptySelection,
  formatConfigIssue,
  loadConfigDir,
  loadSelection,
  parseConfigText,
  parseSelectionText,
  resolveConfigDir,
  serializeSelection,
  starterConfigText,
  writeSelection,
} from "./config.ts"
export {
  DEVICE_FULL,
  LIBRARY_NOT_SET,
  NO_DEVICE_ATTACHED,
  PASS_DEVICE_OR_ATTACH_ONE,
  SELECTION_EMPTY,
  SKIPPED_STRICT,
  deviceLocked,
  deviceNotAttached,
  deviceNotMounted,
  needsDeviceFlag,
  selectionDoesNotFit,
  starterConfigRefusal,
  unknownCommand,
  unknownDevice,
  unknownDeviceOffer,
  unknownFamily,
  unknownForceModel,
} from "./refusals.ts"
export type {
  AppConfig,
  AppSelection,
  ConfigIssue,
  DeviceRecord,
  LoadConfigResult,
  SelectionRule,
} from "./config.ts"
export { loadLedger, ledgerPath, parseLedgerText, serializeLedger, writeLedgerAtomic } from "./ledger.ts"
export type { Ledger, LedgerEntry, LedgerIssue } from "./ledger.ts"
export {
  albumIdentity,
  evaluateSelection,
  isUnstorableName,
  normaliseName,
  pathMatches,
} from "./rules.ts"
export type { SelectedTrack, SkipReason, SkippedTrack } from "./rules.ts"
export { scanLibrary, extensionOf, isAudioExtension, isSupportedExtension } from "./scan.ts"
export type { ScannedFile } from "./scan.ts"
export {
  artworkHashOf,
  buildPlan,
  devicePathFor,
  hashesForAdds,
  planKind,
  resolveForceModel,
  runPool,
  sha256File,
} from "./plan.ts"
export type { PlanKind, PlannedTrack, SyncPlan } from "./plan.ts"
export {
  TRANSCODE_CEILING,
  TRANSCODE_ROUTES,
  TRANSCODE_SIZE_MARGIN,
  deviceExtensionFor,
  estimatedTranscodedSize,
  isTranscodedExtension,
  transcodeRouteFor,
} from "./transcode-plan.ts"
export type { TranscodeRoute } from "./transcode-plan.ts"
export { materialiseAdd } from "./transcode-source.ts"
export type { AddSource, MaterialiseInput } from "./transcode-source.ts"
export { isFlac, parseId3, readFlacStreamInfo, readLameGapless, readTrackTags } from "./tags.ts"
export type { Codec, FlacStreamInfo, Gapless, TrackTags } from "./tags.ts"
export { wipeIpodControl } from "./device-fs.ts"
export { ARTWORK_DIR, ARTWORKDB, artworkCacheDir, writeDeviceArtwork } from "./artwork.ts"
export type { ArtworkSkip, ArtworkWriteResult } from "./artwork.ts"
export {
  artworkFiles,
  artworkFormatRows,
  imageItems,
  mhiiDbid,
  parseArtworkdb,
  thumbnailsOf,
} from "@omatune/device-database"
export {
  emptyPlayData,
  encodePlayCounts,
  loadPlayData,
  mergePlayDataEntry,
  playDataPath,
  resolveDataDir,
  serializePlayData,
  writePlayDataAtomic,
} from "./play-data.ts"
export type { HostPlayData, PlayDataFile, WrittenEcho } from "./play-data.ts"
export {
  FOREIGN_READ_BACK_SKIP,
  countPlayCountsEntries,
  fileNameHashPrefix,
  matchReadBackHash,
  runPlayDataReadBack,
} from "./read-back.ts"
export { runSync, Sync, SyncLive, SyncError, runReadBack, runArtwork } from "./sync.ts"
export type {
  SyncEvent,
  SyncPhase,
  SyncProgress,
  SyncReport,
  SyncRequest,
} from "./sync.ts"
export {
  colonPath,
  buildItunesdb,
  itunesdbReserveBytes,
  readItunesdbTracks,
} from "./itunesdb-write.ts"
