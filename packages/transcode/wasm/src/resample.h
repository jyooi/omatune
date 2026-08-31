/* Windowed-sinc resampler with TPDF dither.
 *
 * The resampler runs at one fixed quality. It has no tunable knobs, because
 * the Transcode Cache keys on the module version and nothing else.
 * Every result is deterministic: the filter table, the phase stepping, and
 * the dither noise all come from fixed constants.
 */

#ifndef OMATUNE_RESAMPLE_H
#define OMATUNE_RESAMPLE_H

#include <stdint.h>

#define OM_MAX_CHANNELS 8

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OmResampler OmResampler;

/* Creates a resampler for in_rate to out_rate over channels.
 * Returns NULL when a rate is zero or channels is out of range.
 * Pass in_rate == out_rate for a passthrough that still applies dither. */
OmResampler *om_resample_new(uint32_t in_rate, uint32_t out_rate, uint32_t channels);

void om_resample_free(OmResampler *self);

/* Upper bound on output frames for in_frames of input, for buffer sizing. */
uint32_t om_resample_max_out(const OmResampler *self, uint32_t in_frames);

/* Pushes in_frames of planar input and writes interleaved output frames.
 *
 * input is channels pointers to double samples already scaled into output
 * least-significant-bit units, so the caller owns bit-depth scaling.
 * out receives interleaved int32 samples clamped to the output depth.
 * Set flush on the final call to drain the filter tail.
 * Returns the number of output frames written. */
uint32_t om_resample_push(OmResampler *self, const double *const *input, uint32_t in_frames,
                          int32_t *out, uint32_t out_capacity, int flush);

/* Turns dither on. The caller enables it when the output is not an exact
 * copy of the input samples, so a lossless path stays bit-perfect. */
void om_resample_set_dither(OmResampler *self, int enabled, int32_t clip_min, int32_t clip_max);

#ifdef __cplusplus
}
#endif

#endif
