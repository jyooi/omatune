#include "resample.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

/* Half the filter length at a ratio of one, in input samples.
 * Downsampling widens the kernel by the inverse of the ratio. */
#define OM_HALF_TAPS 40

/* Kaiser window beta. 11.0 puts the stopband near -110 dB, which sits
 * below the noise floor of the 16-bit output. */
#define OM_KAISER_BETA 11.0

/* Prototype filter oversampling. The phase index takes the top bits of the
 * 32-bit fraction and the rest drives linear interpolation between taps. */
#define OM_PHASE_BITS 9
#define OM_PHASES (1 << OM_PHASE_BITS)

/* Fraction of the output Nyquist the passband keeps. The remainder is the
 * transition band, which the Kaiser window needs to reach the stopband. */
#define OM_CUTOFF_SCALE 0.92

#define OM_PI 3.14159265358979323846

struct OmResampler {
  uint32_t channels;
  uint32_t in_rate;
  uint32_t out_rate;
  int passthrough;

  /* Prototype filter sampled every 1/OM_PHASES input samples.
   * table[i] holds h(i / OM_PHASES - half_width). */
  double *table;
  uint32_t table_len;
  uint32_t half_width; /* kernel half width in whole input samples */
  uint32_t taps;       /* half_width * 2 */

  /* 32.32 fixed point position of the next output sample, in buffer frames. */
  uint64_t pos;
  uint64_t step;

  double *buf[OM_MAX_CHANNELS];
  uint32_t buf_len;
  uint32_t buf_cap;

  int dither;
  int32_t clip_min;
  int32_t clip_max;
  uint32_t rng;
};

static double om_bessel_i0(double x) {
  /* Series expansion. It converges quickly over the range a Kaiser window uses. */
  double sum = 1.0;
  double term = 1.0;
  for (int k = 1; k < 64; k++) {
    double ratio = x / (2.0 * (double)k);
    term *= ratio * ratio;
    sum += term;
    if (term < sum * 1e-18) {
      break;
    }
  }
  return sum;
}

static double om_sinc(double x) {
  if (x == 0.0) {
    return 1.0;
  }
  double p = OM_PI * x;
  return sin(p) / p;
}

static uint32_t om_next_random(OmResampler *self) {
  uint32_t x = self->rng;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  self->rng = x;
  return x;
}

/* One uniform sample in [-0.5, 0.5). */
static double om_uniform(OmResampler *self) {
  return ((double)om_next_random(self) / 4294967296.0) - 0.5;
}

static int32_t om_quantise(OmResampler *self, double value) {
  if (self->dither) {
    /* Triangular probability density from two independent uniform draws.
     * TPDF removes both the quantisation distortion and the noise modulation
     * that a flat rectangular dither leaves behind. */
    value += om_uniform(self) + om_uniform(self);
  }
  double rounded = floor(value + 0.5);
  if (rounded < (double)self->clip_min) {
    return self->clip_min;
  }
  if (rounded > (double)self->clip_max) {
    return self->clip_max;
  }
  return (int32_t)rounded;
}

static int om_build_table(OmResampler *self) {
  double ratio = (double)self->out_rate / (double)self->in_rate;
  double kernel_scale = ratio < 1.0 ? ratio : 1.0;
  /* Widening the kernel when downsampling keeps the transition band the same
   * fraction of the lowered Nyquist. */
  double half = (double)OM_HALF_TAPS / kernel_scale;
  self->half_width = (uint32_t)ceil(half);
  self->taps = self->half_width * 2;
  double cutoff = 0.5 * kernel_scale * OM_CUTOFF_SCALE;

  self->table_len = self->taps * OM_PHASES + 1;
  self->table = (double *)malloc((size_t)self->table_len * sizeof(double));
  if (!self->table) {
    return 0;
  }

  double denom = om_bessel_i0(OM_KAISER_BETA);
  double edge = (double)self->half_width;
  for (uint32_t i = 0; i < self->table_len; i++) {
    double t = (double)i / (double)OM_PHASES - edge;
    double in_window = t / edge;
    double arg = 1.0 - in_window * in_window;
    double window = arg <= 0.0 ? 0.0 : om_bessel_i0(OM_KAISER_BETA * sqrt(arg)) / denom;
    self->table[i] = 2.0 * cutoff * om_sinc(2.0 * cutoff * t) * window;
  }
  return 1;
}

static int om_grow(OmResampler *self, uint32_t needed) {
  if (needed <= self->buf_cap) {
    return 1;
  }
  uint32_t cap = self->buf_cap == 0 ? 8192 : self->buf_cap;
  while (cap < needed) {
    cap *= 2;
  }
  for (uint32_t ch = 0; ch < self->channels; ch++) {
    double *next = (double *)realloc(self->buf[ch], (size_t)cap * sizeof(double));
    if (!next) {
      return 0;
    }
    self->buf[ch] = next;
  }
  self->buf_cap = cap;
  return 1;
}

OmResampler *om_resample_new(uint32_t in_rate, uint32_t out_rate, uint32_t channels) {
  if (in_rate == 0 || out_rate == 0 || channels == 0 || channels > OM_MAX_CHANNELS) {
    return NULL;
  }
  OmResampler *self = (OmResampler *)calloc(1, sizeof(OmResampler));
  if (!self) {
    return NULL;
  }
  self->channels = channels;
  self->in_rate = in_rate;
  self->out_rate = out_rate;
  self->passthrough = in_rate == out_rate;
  self->clip_min = -32768;
  self->clip_max = 32767;
  /* A fixed seed keeps every Transcode of the same source byte-identical,
   * which the Transcode Cache and the Ledger hash both rely on. */
  self->rng = 0x9e3779b9u;

  if (self->passthrough) {
    return self;
  }

  if (!om_build_table(self)) {
    om_resample_free(self);
    return NULL;
  }
  self->step = ((uint64_t)in_rate << 32) / (uint64_t)out_rate;
  self->pos = (uint64_t)self->half_width << 32;

  if (!om_grow(self, self->half_width * 4 + 8192)) {
    om_resample_free(self);
    return NULL;
  }
  /* The leading zeros let the first output sample sit at input time zero,
   * so the filter adds no latency the caller has to trim. */
  for (uint32_t ch = 0; ch < channels; ch++) {
    memset(self->buf[ch], 0, (size_t)self->half_width * sizeof(double));
  }
  self->buf_len = self->half_width;
  return self;
}

void om_resample_free(OmResampler *self) {
  if (!self) {
    return;
  }
  for (uint32_t ch = 0; ch < OM_MAX_CHANNELS; ch++) {
    free(self->buf[ch]);
  }
  free(self->table);
  free(self);
}

void om_resample_set_dither(OmResampler *self, int enabled, int32_t clip_min, int32_t clip_max) {
  self->dither = enabled;
  self->clip_min = clip_min;
  self->clip_max = clip_max;
}

uint32_t om_resample_max_out(const OmResampler *self, uint32_t in_frames) {
  if (self->passthrough) {
    return in_frames;
  }
  double scaled = (double)in_frames * (double)self->out_rate / (double)self->in_rate;
  return (uint32_t)scaled + self->half_width * 2 + 4;
}

/* Emits every output sample whose kernel fits inside the buffered input.
 *
 * Output sample n sits at buffer position p. Its value is the sum over input
 * index m of x[m] * h(p - m), for m from floor(p) - half_width + 1 to
 * floor(p) + half_width. The table holds h sampled at 1/OM_PHASES steps,
 * so tap k reads table index (taps - 1 - k) * OM_PHASES + fraction. */
static uint32_t om_drain(OmResampler *self, int32_t *out, uint32_t out_capacity) {
  uint32_t taps = self->taps;
  uint32_t channels = self->channels;
  uint32_t written = 0;

  while (written < out_capacity) {
    uint64_t index = self->pos >> 32;
    if (index + self->half_width >= self->buf_len) {
      break;
    }
    if (index + 1 < self->half_width) {
      break;
    }
    uint32_t start = (uint32_t)index - self->half_width + 1;
    uint32_t frac = (uint32_t)(self->pos & 0xffffffffu);
    uint32_t sub = frac >> (32 - OM_PHASE_BITS);
    uint32_t rest = frac & ((1u << (32 - OM_PHASE_BITS)) - 1u);
    double weight = (double)rest / (double)(1u << (32 - OM_PHASE_BITS));

    for (uint32_t ch = 0; ch < channels; ch++) {
      const double *src = self->buf[ch] + start;
      const double *tap = self->table + (taps - 1) * OM_PHASES + sub;
      double sum = 0.0;
      for (uint32_t k = 0; k < taps; k++) {
        double h = tap[0] + (tap[1] - tap[0]) * weight;
        sum += src[k] * h;
        tap -= OM_PHASES;
      }
      out[written * channels + ch] = om_quantise(self, sum);
    }
    written++;
    self->pos += self->step;
  }

  /* Keep half_width frames of history before the next output position. */
  uint64_t index = self->pos >> 32;
  if (index > self->half_width) {
    uint32_t drop = (uint32_t)index - self->half_width;
    if (drop > self->buf_len) {
      drop = self->buf_len;
    }
    if (drop > 0) {
      for (uint32_t ch = 0; ch < channels; ch++) {
        memmove(self->buf[ch], self->buf[ch] + drop,
                (size_t)(self->buf_len - drop) * sizeof(double));
      }
      self->buf_len -= drop;
      self->pos -= (uint64_t)drop << 32;
    }
  }
  return written;
}

uint32_t om_resample_push(OmResampler *self, const double *const *input, uint32_t in_frames,
                          int32_t *out, uint32_t out_capacity, int flush) {
  uint32_t channels = self->channels;

  if (self->passthrough) {
    uint32_t frames = in_frames < out_capacity ? in_frames : out_capacity;
    for (uint32_t i = 0; i < frames; i++) {
      for (uint32_t ch = 0; ch < channels; ch++) {
        out[i * channels + ch] = om_quantise(self, input[ch][i]);
      }
    }
    return frames;
  }

  /* The flush pass appends the zeros the kernel needs to reach the last sample. */
  uint32_t tail = flush ? self->half_width + 1 : 0;
  if (!om_grow(self, self->buf_len + in_frames + tail)) {
    return 0;
  }
  for (uint32_t ch = 0; ch < channels; ch++) {
    if (in_frames > 0) {
      memcpy(self->buf[ch] + self->buf_len, input[ch], (size_t)in_frames * sizeof(double));
    }
    if (tail > 0) {
      memset(self->buf[ch] + self->buf_len + in_frames, 0, (size_t)tail * sizeof(double));
    }
  }
  self->buf_len += in_frames + tail;
  return om_drain(self, out, out_capacity);
}
