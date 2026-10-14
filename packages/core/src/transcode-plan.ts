import type { AudioCeiling } from "@omatune/transcode"

export const TRANSCODE_CEILING: AudioCeiling = {
  sampleRate: 48000,
  bitsPerSample: 16,
}

export const TRANSCODE_SIZE_MARGIN = 0.15

export type TranscodeRoute = {
  /** Library file extension, lower case and without the dot. */
  readonly from: string
  readonly to: string
  readonly conversion: string
}

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

export function deviceExtensionFor(extension: string): string {
  return transcodeRouteFor(extension)?.to ?? extension.replace(/^\./, "").toLowerCase()
}

export function estimatedTranscodedSize(sourceSize: number): number {
  return Math.ceil(sourceSize * (1 + TRANSCODE_SIZE_MARGIN))
}
