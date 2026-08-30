# Verification Library

This folder is the public CC0 Verification Library.
Reporters and tests use this fixed set of Tracks.
The Device Checklist in `docs/verification/device-checklist.yaml` uses this set.

## License

CC0 1.0 applies to every file in this folder.
The legal text is in `CC0.txt`.
The Tracks are tones from the generate script.
They contain no third-party recordings.

## Layout

- `library/` holds the audio Tracks.
- `manifest.json` states expected counts and tags.
- `generate.ts` builds the Tracks and the manifest.
- `read-tags.ts` exports the tag reader in `packages/core/src/tags.ts` for tests.

## Counts

The Verification Library has 12 Tracks, 3 Albums, and 2 album artists.
11 Tracks have Artwork.
1 Track has no Artwork.
One Album is MP3.
One Album is AAC in m4a.
One Album is ALAC in m4a.

One Album is a compilation under Various Artists.
One Album is multi-disc.
Two MP3 Tracks form a gapless pair with LAME delay and padding.

## Generate

The script needs ffmpeg on PATH.

```
bun fixtures/audio/generate.ts
```

If ffmpeg is absent, the script writes an error and exits with status 1.

## Determinism

The script sets ffmpeg bitexact flags.
The script writes the LAME encoder string, delay, and padding.
The script writes Artwork PNG bytes.
AAC frames change across ffmpeg versions.
Commit a new generate run only to refresh the bytes.

## Manifest

`manifest.json` is JSON.
`counts.tracks` is the Track count for Device Checklist item DC-02.
`counts.albums` is the Album count.
`counts.albumArtists` is the album-artist count.
`counts.tracksWithArtwork` is the Track count with Artwork.

Each `tracks[]` entry states path, codec, title, artist, album, albumArtist, track numbers, disc numbers, compilation flag, Artwork flag, duration, and gapless fields when they apply.
Tests read these values.
