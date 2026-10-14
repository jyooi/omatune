/* libFLAC build configuration for the wasm32 target.
 *
 * Upstream generates this file with autoconf or CMake from config.cmake.h.in.
 * The wasm target is fixed, so the values are fixed too.
 * Only the decoder is built, so the encoder and Ogg settings stay off.
 */

#ifndef OMATUNE_FLAC_CONFIG_H
#define OMATUNE_FLAC_CONFIG_H

#define CPU_IS_BIG_ENDIAN 0
#define WORDS_BIGENDIAN CPU_IS_BIG_ENDIAN
#define ENABLE_64_BIT_WORDS 0

#define FLAC__HAS_OGG 0
#define FLAC__HAS_X86INTRIN 0
#define FLAC__HAS_NEONINTRIN 0
#define FLAC__HAS_A64NEONINTRIN 0

#define HAVE_BSWAP16 1
#define HAVE_BSWAP32 1
#define HAVE_INTTYPES_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_LROUND 1
#define HAVE_TYPEOF 1

#define NDEBUG 1
#define PACKAGE_VERSION "1.4.3"
#define SIZEOF_OFF_T 8
#define SIZEOF_VOIDP 4

#endif
