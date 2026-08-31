#!/usr/bin/env bash
#
# Builds packages/transcode/src/wasm/transcode.wasm.
#
# The compiled module is committed, so this script runs only when the codec
# sources or the glue change. A normal build, a normal test run, and CI never
# need it. Read packages/transcode/src/wasm/PROVENANCE.md for what goes in.
#
# Every input is pinned by version and by checksum, so two runs of this script
# on the same wasi-sdk produce the same module.
#
# Usage:
#   scripts/build-transcode-wasm.sh
#
# The script downloads wasi-sdk, libFLAC, and Apple ALAC into a cache under
# ${OMATUNE_WASM_CACHE:-$HOME/.cache/omatune-wasm}. It writes nothing outside
# that cache and the repository.

set -euo pipefail

WASI_SDK_VERSION="34.0"
WASI_SDK_MAJOR="34"
WASI_SDK_SHA256="b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4"

FLAC_VERSION="1.4.3"
FLAC_SHA256="6c58e69cd22348f441b861092b825e591d0b822e106de6eb0ee4d05d27205b70"

# Apple published no tagged release, so the commit is the pin.
ALAC_COMMIT="c38887c5c5e64a4b31108733bd79ca9b2496d987"
ALAC_SHA256="98635ece42fb1c3fceb75eaa4b5164d866e09f0195b3e7ec4085f1123c5e272f"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${OMATUNE_WASM_CACHE:-$HOME/.cache/omatune-wasm}"
GLUE="$ROOT/packages/transcode/wasm/src"
OUT_DIR="$ROOT/packages/transcode/src/wasm"
BUILD="$CACHE/build"

mkdir -p "$CACHE" "$BUILD" "$OUT_DIR"

note() { printf '%s\n' "$*" >&2; }

verify() {
  local file="$1" want="$2"
  if [ -z "$want" ]; then
    return 0
  fi
  local got
  got="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    note "Checksum mismatch for $file"
    note "  expected $want"
    note "  actual   $got"
    exit 1
  fi
}

fetch() {
  local url="$1" file="$2" sum="$3"
  if [ ! -f "$file" ]; then
    note "Downloading $url"
    curl -fsSL -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  verify "$file" "$sum"
}

# --- wasi-sdk ---------------------------------------------------------------
# The SDK carries its own clang and its own libc, so the module does not depend
# on whichever compiler the host happens to have.

SDK_DIR="$CACHE/wasi-sdk-${WASI_SDK_VERSION}-x86_64-linux"
if [ -n "${WASI_SDK_DIR:-}" ]; then
  SDK_DIR="$WASI_SDK_DIR"
elif [ ! -d "$SDK_DIR" ]; then
  SDK_TAR="$CACHE/wasi-sdk-${WASI_SDK_VERSION}-x86_64-linux.tar.gz"
  fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_MAJOR}/wasi-sdk-${WASI_SDK_VERSION}-x86_64-linux.tar.gz" \
    "$SDK_TAR" "$WASI_SDK_SHA256"
  tar xzf "$SDK_TAR" -C "$CACHE"
fi

CC="$SDK_DIR/bin/clang"
CXX="$SDK_DIR/bin/clang++"
if [ ! -x "$CC" ]; then
  note "wasi-sdk clang is missing at $CC"
  exit 1
fi

# --- sources ----------------------------------------------------------------

FLAC_DIR="$CACHE/flac-${FLAC_VERSION}"
if [ ! -d "$FLAC_DIR" ]; then
  FLAC_TAR="$CACHE/flac-${FLAC_VERSION}.tar.xz"
  fetch "https://ftp.osuosl.org/pub/xiph/releases/flac/flac-${FLAC_VERSION}.tar.xz" \
    "$FLAC_TAR" "$FLAC_SHA256"
  tar xf "$FLAC_TAR" -C "$CACHE"
fi

ALAC_DIR="$CACHE/alac-${ALAC_COMMIT}"
if [ ! -d "$ALAC_DIR" ]; then
  ALAC_TAR="$CACHE/alac-${ALAC_COMMIT}.tar.gz"
  fetch "https://codeload.github.com/macosforge/alac/tar.gz/${ALAC_COMMIT}" \
    "$ALAC_TAR" "$ALAC_SHA256"
  tar xzf "$ALAC_TAR" -C "$CACHE"
fi

FLAC_SRC="$FLAC_DIR/src/libFLAC"
ALAC_SRC="$ALAC_DIR/codec"

# --- compile ----------------------------------------------------------------

TARGET="--target=wasm32-wasip1"
# -O3 for the inner loops, -ffp-contract=off so the resampler produces the same
# sums on every toolchain that keeps the same libm.
COMMON="$TARGET -O3 -ffp-contract=off -fvisibility=hidden -DNDEBUG"

rm -rf "$BUILD"
mkdir -p "$BUILD/flac-include"

# libFLAC includes <config.h> by name, so the pinned settings land there.
cp "$GLUE/flac-config.h" "$BUILD/flac-include/config.h"
FLAC_INC="-I$BUILD/flac-include -I$FLAC_DIR/include -I$FLAC_SRC/include -DHAVE_CONFIG_H"

note "Compiling libFLAC ${FLAC_VERSION} (decoder only)"
# The decoder needs these translation units and no others. The encoder, the Ogg
# layer, the metadata iterators, and the SIMD variants all stay out.
for unit in bitmath bitreader cpu crc fixed float format lpc md5 memory stream_decoder window; do
  "$CC" $COMMON $FLAC_INC \
    -Wno-unused-parameter -Wno-sign-compare \
    -c -o "$BUILD/flac_$unit.o" "$FLAC_SRC/$unit.c"
done

note "Compiling Apple ALAC ${ALAC_COMMIT:0:12} (encoder only)"
for unit in ag_enc ag_dec dp_enc matrix_enc EndianPortable ALACBitUtilities; do
  "$CC" $COMMON -I"$ALAC_SRC" -DTARGET_OS_MAC=0 -DTARGET_RT_LITTLE_ENDIAN=1 \
    -Wno-unused-parameter -Wno-sign-compare -Wno-deprecated-non-prototype \
    -c -o "$BUILD/alac_$unit.o" "$ALAC_SRC/$unit.c"
done
"$CXX" $COMMON -fno-exceptions -fno-rtti -I"$ALAC_SRC" -DTARGET_OS_MAC=0 -DTARGET_RT_LITTLE_ENDIAN=1 \
  -Wno-unused-parameter -Wno-sign-compare \
  -c -o "$BUILD/alac_encoder.o" "$ALAC_SRC/ALACEncoder.cpp"

note "Compiling the omatune glue"
"$CC" $COMMON -std=c11 -Wall -Wextra -c -o "$BUILD/resample.o" "$GLUE/resample.c"
"$CXX" $COMMON -std=c++17 -fno-exceptions -fno-rtti -Wall -Wextra \
  -I"$GLUE" -I"$FLAC_DIR/include" -I"$ALAC_SRC" \
  -c -o "$BUILD/transcode.o" "$GLUE/transcode.cpp"

note "Linking transcode.wasm"
"$CXX" $TARGET -O3 -o "$OUT_DIR/transcode.wasm" "$BUILD"/*.o \
  -mexec-model=reactor \
  -Wl,--export=om_transcode \
  -Wl,--export=om_alloc \
  -Wl,--export=om_free \
  -Wl,--no-entry \
  -Wl,--strip-all \
  -Wl,--gc-sections

"$SDK_DIR/bin/wasm-strip" "$OUT_DIR/transcode.wasm" 2>/dev/null || true

SIZE="$(stat -c %s "$OUT_DIR/transcode.wasm")"
note "Wrote $OUT_DIR/transcode.wasm ($SIZE bytes)"
note "Bump TRANSCODE_MODULE_VERSION in packages/transcode/src/engine.ts."
