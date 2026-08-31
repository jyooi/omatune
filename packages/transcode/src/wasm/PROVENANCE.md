# transcode.wasm

`transcode.wasm` is a compiled artifact. It is committed so that a build, a
test run, and CI need no C toolchain. Read ADR 0002 for why the codecs are
WebAssembly at all.

## What goes in

| Part | Source | Version | License |
| --- | --- | --- | --- |
| FLAC decoder | [libFLAC](https://xiph.org/flac/) | 1.4.3 | BSD 3-Clause (Xiph.Org) |
| ALAC encoder | [Apple Lossless Audio Codec](https://github.com/macosforge/alac) | commit `c38887c5c5e64a4b31108733bd79ca9b2496d987` | Apache-2.0 |
| Resampler and dither | `../../wasm/src/resample.c` | this repository | the repository license |
| Glue | `../../wasm/src/transcode.cpp` | this repository | the repository license |

Only the decoder half of libFLAC and the encoder half of Apple ALAC are
compiled. The FLAC encoder, the Ogg layer, the metadata iterators, the SIMD
variants, and the ALAC decoder all stay out, which is most of why the module
is small.

Neither upstream project is modified. Both are compiled with settings the
build script supplies:

- `packages/transcode/wasm/src/flac-config.h` replaces the `config.h` that
  autoconf or CMake would generate, because the wasm target is fixed.
- `-DTARGET_RT_LITTLE_ENDIAN=1` is required for Apple ALAC. Its
  `EndianPortable.c` defines that macro for x86 and Win32 only, so a wasm
  build without the flag skips every byte swap and writes a magic cookie and
  a range-coder stream in the wrong order.

## Rebuilding

```
scripts/build-transcode-wasm.sh
```

The script downloads a pinned wasi-sdk, a pinned libFLAC release, and a
pinned Apple ALAC commit into `${OMATUNE_WASM_CACHE:-$HOME/.cache/omatune-wasm}`,
verifies the checksums it knows, compiles, and writes this directory.
It touches nothing else.

Run it only when a codec version, a compiler pin, or a file under
`packages/transcode/wasm/src/` changes. Bump `TRANSCODE_MODULE_VERSION` in
`../engine.ts` in the same commit: the Transcode Cache key carries that
number, so a bump retires every cached Transcode with no migration step.

## Interface

The module imports three functions under the module name `omatune` and
exports `om_transcode`. `../engine.ts` holds the host side. The module reads
no file, no clock, and no network, so the same source bytes and the same
ceiling always produce the same packets.

wasi-libc pulls a few `wasi_snapshot_preview1` imports in through `stdio.h`.
The host stubs every one of them. Nothing on any working path calls them.
