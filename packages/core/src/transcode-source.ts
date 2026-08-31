import { join } from "node:path"
import {
  lookupTranscodeCache,
  transcodeCacheKey,
  transcodeCachePath,
  transcodeFlacToAlac,
  writeTranscodeCache,
} from "@omatune/transcode"
import type { SelectedTrack } from "./rules.ts"
import { TRANSCODE_CEILING, transcodeRouteFor } from "./transcode-plan.ts"

/** The file a Sync copies to the Device, and how large it really is. */
export type AddSource = {
  readonly path: string
  readonly size: number
  /** sha256 of the copied bytes, set only when a Transcode produced them. */
  readonly transcodedSha256: string | null
  /** True when the Transcode Cache already held the result. */
  readonly cached: boolean
}

export type MaterialiseInput = {
  readonly libraryRoot: string
  readonly track: SelectedTrack
  /** sha256 of the Library source, which is the Track identity. */
  readonly sourceSha256: string
  readonly cacheDir: string
}

/**
 * Produces the file the copy step reads for one add.
 *
 * A Track that needs no Transcode reports its Library file untouched. A Track
 * that needs one comes back from the Transcode Cache, or gets transcoded into
 * the cache first. The Library file never changes either way.
 */
export async function materialiseAdd(input: MaterialiseInput): Promise<AddSource> {
  const route = transcodeRouteFor(input.track.extension)
  const libraryFile = join(input.libraryRoot, input.track.relativePath)
  if (!route) {
    return {
      path: libraryFile,
      size: input.track.size,
      transcodedSha256: null,
      cached: false,
    }
  }

  const key = transcodeCacheKey({
    sourceSha256: input.sourceSha256,
    ceiling: TRANSCODE_CEILING,
    conversion: route.conversion,
  })
  const cachePath = transcodeCachePath(input.cacheDir, key)

  const hit = await lookupTranscodeCache(input.cacheDir, key)
  if (hit) {
    return {
      path: cachePath,
      size: hit.size,
      transcodedSha256: hit.sha256,
      cached: true,
    }
  }

  const source = await Bun.file(libraryFile).bytes()
  const tags = input.track.tags
  const result = await transcodeFlacToAlac({
    source,
    ceiling: TRANSCODE_CEILING,
    tags: {
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      albumArtist: tags.albumArtist,
      track: tags.track,
      trackTotal: tags.trackTotal,
      disc: tags.disc,
      discTotal: tags.discTotal,
      compilation: tags.compilation,
      artworkBytes: tags.artworkBytes,
      artworkMime: tags.artworkMime,
    },
  })
  const entry = await writeTranscodeCache(input.cacheDir, key, result.bytes, {
    libraryRoot: input.libraryRoot,
    libraryPath: input.track.relativePath,
    size: input.track.size,
    mtime: input.track.mtimeMs,
  })
  return {
    path: cachePath,
    size: entry.size,
    transcodedSha256: entry.sha256,
    cached: false,
  }
}
