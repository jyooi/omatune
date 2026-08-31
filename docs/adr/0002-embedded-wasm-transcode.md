---
status: accepted
date: 2026-08-31
ticket: HUF-277
---

# Transcode FLAC to ALAC with WASM codecs embedded in the binary

omatune must play FLAC Tracks on iPods, which read ALAC but not FLAC.
The Transcode runs inside Sync, so the engine choice decides what every user machine must carry.
ADR-0001 commits to one self-contained binary per target with no native dependency, and an external ffmpeg would break that promise: FLAC support would depend on what each machine happens to have installed.
We compile a FLAC decoder, an ALAC encoder, and a resampler with dithering to WebAssembly, embed the modules in the binary, and run them through bun's built-in WebAssembly runtime.

## Considered options

- Embedded WASM codecs (chosen): identical behavior on every machine, no runtime dependency, a few MB of binary size, slower than native ffmpeg but the cost is a one-time hit per new Track.
- External ffmpeg on PATH: zero build cost and fastest, but per-machine variance, a silent capability cliff when ffmpeg is absent, and a contradiction of ADR-0001.
- Pure TypeScript codecs: no mature ALAC encoder exists in TypeScript; the largest effort for the slowest runtime.

## Consequences

- The build gains a WASM compilation step for the codec modules, pinned and reproducible, with the compiled artifacts embedded by `bun build --compile`.
- Transcode output must be deterministic per (source bytes, parameters, module version), because the Transcode Cache and the Ledger record it.
- Lossy sources (Opus, Vorbis) stay Skipped: this ADR covers lossless-to-lossless only, and a lossy path would need its own honest story.
