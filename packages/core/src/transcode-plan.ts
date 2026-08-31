import type { AudioCeiling } from "@omatune/transcode"

/**
 * The one ceiling every Transcode targets.
 *
 * A source at or below both numbers comes through bit-perfect. A source above
 * either one comes down to the ceiling, with dither on the depth reduction.
 * The value is one constant because every Device omatune supports plays
 * 16-bit 48 kHz ALAC. A family that needs a different ceiling gets a column in
 * the family table, and not before.
 */
export const TRANSCODE_CEILING: AudioCeiling = {
  sampleRate: 48000,
  bitsPerSample: 16,
}

/**
 * How much larger than its source a Transcode is allowed to be in the budget.
 *
 * ALAC compresses a little worse than FLAC, so the estimate adds headroom
 * instead of guessing. The Sync Plan marks these adds as estimates, and the
 * disk-full path catches whatever the estimate misses.
 */
export const TRANSCODE_SIZE_MARGIN = 0.15

/** One source format the Transcode engine handles. */
export type TranscodeRoute = {
  /** Library file extension, lower case and without the dot. */
  readonly from: string
  /** Device file extension the Transcode writes. */
  readonly to: string
  /** Cache key label for the format pair. */
  readonly conversion: string
}

/**
 * The formats a Sync converts.
 *
 * v1 carries FLAC alone. The seam is a table so a second lossless source
 * needs a row plus an engine, not a new shape.
 */
export const TRANSCODE_ROUTES: ReadonlyArray<TranscodeRoute> = [
  { from: "flac", to: "m4a", conversion: "flac-alac" },
]

export function transcodeRouteFor(extension: string): TranscodeRoute | null {
  const needle = extension.replace(/^\./, "").toLowerCase()
  return TRANSCODE_ROUTES.find((route) => route.from === needle) ?? null
}

export function isTranscodedExtension(extension: string): boolean {
  return transcodeRouteFor(extension) !== null
}

/** The extension the Device file carries for a Library file. */
export function deviceExtensionFor(extension: string): string {
  return transcodeRouteFor(extension)?.to ?? extension.replace(/^\./, "").toLowerCase()
}

/**
 * The size a Sync Plan budgets for one transcoded add.
 *
 * The real size is unknown until the Transcode runs, so the Plan reserves the
 * source size plus the margin and marks the number as an estimate.
 */
export function estimatedTranscodedSize(sourceSize: number): number {
  return Math.ceil(sourceSize * (1 + TRANSCODE_SIZE_MARGIN))
}
