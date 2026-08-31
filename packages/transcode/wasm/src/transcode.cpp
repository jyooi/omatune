/* omatune Transcode engine.
 *
 * One WebAssembly module carries the whole chain: a libFLAC decoder, the
 * windowed-sinc resampler with dither, and Apple's ALAC encoder.
 * The host drives it with three imports and reads back ALAC packets, so the
 * module never touches a file, a clock, or the network.
 *
 * The module is deterministic. The same source bytes and the same ceiling
 * always produce the same packets, which is what the Transcode Cache and the
 * transcoded hash in the Ledger depend on.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "FLAC/stream_decoder.h"

#include "ALACAudioTypes.h"
#include "ALACBitUtilities.h"
#include "ALACEncoder.h"

#include "resample.h"

#define OM_EXPORT __attribute__((visibility("default")))
#define OM_IMPORT(name) __attribute__((import_module("omatune"), import_name(name)))

extern "C" {

/* Pulls up to want source bytes into dst. A short read means end of stream. */
OM_IMPORT("read") uint32_t om_host_read(uint8_t *dst, uint32_t want);

/* Reports the stream shape once, before the first packet. */
OM_IMPORT("info")
void om_host_info(uint32_t in_rate, uint32_t in_channels, uint32_t in_bits, uint32_t out_rate,
                  uint32_t out_bits, uint32_t frames_per_packet, uint32_t source_frames_lo,
                  uint32_t source_frames_hi, const uint8_t *cookie, uint32_t cookie_len);

/* Delivers one finished ALAC packet. */
OM_IMPORT("packet") void om_host_packet(const uint8_t *data, uint32_t len, uint32_t frames);

OM_EXPORT int32_t om_transcode(uint32_t ceiling_rate, uint32_t ceiling_bits);

/* Scratch allocation for the host. The decoder allocates its own read buffer,
 * so these exist only so the host can stage bytes when it needs to. */
OM_EXPORT void *om_alloc(uint32_t size);
OM_EXPORT void om_free(void *ptr);
}

void *om_alloc(uint32_t size) { return malloc(size); }

void om_free(void *ptr) { free(ptr); }

/* Status codes the host maps onto messages. */
enum {
  OM_OK = 0,
  OM_ERR_DECODER = -1,
  OM_ERR_STREAM = -2,
  OM_ERR_CHANNELS = -3,
  OM_ERR_MEMORY = -4,
  OM_ERR_ENCODER = -5,
  OM_ERR_RATE = -6,
};

namespace {

struct Job {
  ALACEncoder *encoder = nullptr;
  OmResampler *resampler = nullptr;

  uint32_t in_rate = 0;
  uint32_t in_channels = 0;
  uint32_t in_bits = 0;
  uint32_t out_rate = 0;
  uint32_t out_bits = 0;
  uint32_t bytes_per_sample = 0;
  uint32_t frames_per_packet = kALACDefaultFramesPerPacket;

  /* The ceiling arrives per call, so the constant stays in core. */
  uint32_t ceiling_rate = 0;
  uint32_t ceiling_bits = 0;

  double scale = 1.0;
  int32_t clip_min = 0;
  int32_t clip_max = 0;

  /* Planar decode staging, one buffer per channel. */
  double *plane[OM_MAX_CHANNELS] = {nullptr};
  uint32_t plane_cap = 0;

  /* Interleaved resampler output, then packed into pcm for the encoder. */
  int32_t *interleaved = nullptr;
  uint32_t interleaved_cap = 0;

  uint8_t *pcm = nullptr;       /* one full packet of packed samples */
  uint32_t pcm_frames = 0;      /* frames currently held in pcm */
  uint8_t *packet = nullptr;    /* encoder output */
  uint32_t packet_cap = 0;

  AudioFormatDescription in_format = {};
  AudioFormatDescription out_format = {};

  uint64_t source_frames = 0;
  /* Exact output frame count derived from the source. The filter tail can run
   * a sample or two past it, and those samples are dropped so the file holds
   * exactly the audio the source did. Zero means the source declared none. */
  uint64_t expected_frames = 0;
  uint64_t emitted_frames = 0;
  int32_t status = OM_OK;
  int started = 0;
};

Job g_job;

/* ALAC accepts these depths only. A source below 16 bits is promoted, which
 * stays lossless because the promotion is a left shift. */
uint32_t alac_depth(uint32_t bits) {
  if (bits <= 16) {
    return 16;
  }
  if (bits <= 20) {
    return 20;
  }
  if (bits <= 24) {
    return 24;
  }
  return 32;
}

void job_reset(Job &job) {
  delete job.encoder;
  om_resample_free(job.resampler);
  for (uint32_t ch = 0; ch < OM_MAX_CHANNELS; ch++) {
    free(job.plane[ch]);
  }
  free(job.interleaved);
  free(job.pcm);
  free(job.packet);
  job = Job();
}

int ensure_planes(Job &job, uint32_t frames) {
  if (frames <= job.plane_cap) {
    return 1;
  }
  uint32_t cap = job.plane_cap == 0 ? 4096 : job.plane_cap;
  while (cap < frames) {
    cap *= 2;
  }
  for (uint32_t ch = 0; ch < job.in_channels; ch++) {
    double *next = (double *)realloc(job.plane[ch], (size_t)cap * sizeof(double));
    if (!next) {
      return 0;
    }
    job.plane[ch] = next;
  }
  job.plane_cap = cap;
  return 1;
}

int ensure_interleaved(Job &job, uint32_t frames) {
  uint32_t samples = frames * job.in_channels;
  if (samples <= job.interleaved_cap) {
    return 1;
  }
  uint32_t cap = job.interleaved_cap == 0 ? 8192 : job.interleaved_cap;
  while (cap < samples) {
    cap *= 2;
  }
  int32_t *next = (int32_t *)realloc(job.interleaved, (size_t)cap * sizeof(int32_t));
  if (!next) {
    return 0;
  }
  job.interleaved = next;
  job.interleaved_cap = cap;
  return 1;
}

/* Writes one sample as packed little-endian signed bytes, the layout the
 * ALAC encoder expects for kALACFormatFlagIsPacked input. */
void store_sample(uint8_t *dst, int32_t value, uint32_t bytes) {
  for (uint32_t i = 0; i < bytes; i++) {
    dst[i] = (uint8_t)((uint32_t)value >> (8 * i));
  }
}

/* Encodes and emits one packet, then clears the staging buffer. */
int32_t flush_packet(Job &job) {
  if (job.pcm_frames == 0) {
    return OM_OK;
  }
  int32_t bytes = (int32_t)(job.pcm_frames * job.in_format.mBytesPerPacket);
  int32_t status = job.encoder->Encode(job.in_format, job.out_format, job.pcm, job.packet, &bytes);
  if (status != ALAC_noErr) {
    return OM_ERR_ENCODER;
  }
  om_host_packet(job.packet, (uint32_t)bytes, job.pcm_frames);
  job.pcm_frames = 0;
  return OM_OK;
}

/* Moves interleaved output into packet-sized groups for the encoder. */
int32_t push_frames(Job &job, const int32_t *frames, uint32_t count) {
  uint32_t channels = job.in_channels;
  if (job.expected_frames > 0) {
    uint64_t room = job.expected_frames > job.emitted_frames
                        ? job.expected_frames - job.emitted_frames
                        : 0;
    if ((uint64_t)count > room) {
      count = (uint32_t)room;
    }
  }
  job.emitted_frames += count;
  uint32_t offset = 0;
  while (offset < count) {
    uint32_t room = job.frames_per_packet - job.pcm_frames;
    uint32_t take = count - offset;
    if (take > room) {
      take = room;
    }
    uint8_t *dst = job.pcm + (size_t)job.pcm_frames * job.in_format.mBytesPerPacket;
    const int32_t *src = frames + (size_t)offset * channels;
    for (uint32_t i = 0; i < take * channels; i++) {
      store_sample(dst + (size_t)i * job.bytes_per_sample, src[i], job.bytes_per_sample);
    }
    job.pcm_frames += take;
    offset += take;
    if (job.pcm_frames == job.frames_per_packet) {
      int32_t status = flush_packet(job);
      if (status != OM_OK) {
        return status;
      }
    }
  }
  return OM_OK;
}

FLAC__StreamDecoderReadStatus read_cb(const FLAC__StreamDecoder *, FLAC__byte buffer[],
                                      size_t *bytes, void *) {
  if (*bytes == 0) {
    return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
  }
  uint32_t got = om_host_read(buffer, (uint32_t)*bytes);
  *bytes = got;
  if (got == 0) {
    return FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
  }
  return FLAC__STREAM_DECODER_READ_STATUS_CONTINUE;
}

void metadata_cb(const FLAC__StreamDecoder *, const FLAC__StreamMetadata *metadata, void *client) {
  Job &job = *(Job *)client;
  if (metadata->type != FLAC__METADATA_TYPE_STREAMINFO || job.started) {
    return;
  }
  const FLAC__StreamMetadata_StreamInfo &info = metadata->data.stream_info;
  job.started = 1;
  job.in_rate = info.sample_rate;
  job.in_channels = info.channels;
  job.in_bits = info.bits_per_sample;

  if (job.in_channels == 0 || job.in_channels > OM_MAX_CHANNELS) {
    job.status = OM_ERR_CHANNELS;
    return;
  }
  if (job.in_rate == 0) {
    job.status = OM_ERR_RATE;
    return;
  }

  job.out_rate = job.in_rate < job.ceiling_rate ? job.in_rate : job.ceiling_rate;
  job.out_bits = alac_depth(job.in_bits < job.ceiling_bits ? job.in_bits : job.ceiling_bits);
  job.bytes_per_sample = (job.out_bits + 7) / 8;

  /* Samples move into output least-significant-bit units before the filter,
   * so the resampler and the dither both work in the final scale. */
  if (job.in_bits >= job.out_bits) {
    job.scale = 1.0 / (double)((uint32_t)1 << (job.in_bits - job.out_bits));
  } else {
    job.scale = (double)((uint32_t)1 << (job.out_bits - job.in_bits));
  }
  job.clip_max = (int32_t)(((uint32_t)1 << (job.out_bits - 1)) - 1);
  job.clip_min = -job.clip_max - 1;

  job.resampler = om_resample_new(job.in_rate, job.out_rate, job.in_channels);
  if (!job.resampler) {
    job.status = OM_ERR_MEMORY;
    return;
  }
  /* A stream that keeps its rate and its depth stays bit-perfect, so it takes
   * no dither. Any resampling or any depth reduction needs it. */
  int lossless = job.in_rate == job.out_rate && job.in_bits <= job.out_bits;
  om_resample_set_dither(job.resampler, lossless ? 0 : 1, job.clip_min, job.clip_max);

  job.encoder = new ALACEncoder();
  if (!job.encoder) {
    job.status = OM_ERR_MEMORY;
    return;
  }
  job.encoder->SetFrameSize(job.frames_per_packet);

  job.out_format.mSampleRate = (double)job.out_rate;
  job.out_format.mFormatID = kALACFormatAppleLossless;
  job.out_format.mFormatFlags = job.out_bits == 16   ? 1
                                : job.out_bits == 20 ? 2
                                : job.out_bits == 24 ? 3
                                                     : 4;
  job.out_format.mBytesPerPacket = 0;
  job.out_format.mFramesPerPacket = job.frames_per_packet;
  job.out_format.mBytesPerFrame = 0;
  job.out_format.mChannelsPerFrame = job.in_channels;
  job.out_format.mBitsPerChannel = 0;
  job.out_format.mReserved = 0;

  if (job.encoder->InitializeEncoder(job.out_format) != ALAC_noErr) {
    job.status = OM_ERR_ENCODER;
    return;
  }

  uint32_t frame_bytes = job.in_channels * job.bytes_per_sample;
  job.in_format.mSampleRate = (double)job.out_rate;
  job.in_format.mFormatID = kALACFormatLinearPCM;
  job.in_format.mFormatFlags = kALACFormatFlagIsSignedInteger | kALACFormatFlagIsPacked;
  job.in_format.mBytesPerPacket = frame_bytes;
  job.in_format.mFramesPerPacket = 1;
  job.in_format.mBytesPerFrame = frame_bytes;
  job.in_format.mChannelsPerFrame = job.in_channels;
  job.in_format.mBitsPerChannel = job.out_bits;
  job.in_format.mReserved = 0;

  job.pcm = (uint8_t *)malloc((size_t)job.frames_per_packet * frame_bytes);
  /* The encoder can emit an escape packet slightly larger than its input, so
   * the output buffer uses the encoder's own worst-case bound. */
  job.packet_cap = job.frames_per_packet * job.in_channels * ((10 + 32) / 8) + 1;
  job.packet = (uint8_t *)malloc(job.packet_cap);
  if (!job.pcm || !job.packet) {
    job.status = OM_ERR_MEMORY;
    return;
  }

  job.source_frames = info.total_samples;
  if (job.source_frames > 0) {
    /* Round up so a rate change that lands between samples keeps the last one. */
    uint64_t scaled = job.source_frames * (uint64_t)job.out_rate;
    job.expected_frames = (scaled + job.in_rate - 1) / (uint64_t)job.in_rate;
  }
}

FLAC__StreamDecoderWriteStatus write_cb(const FLAC__StreamDecoder *, const FLAC__Frame *frame,
                                        const FLAC__int32 *const buffer[], void *client) {
  Job &job = *(Job *)client;
  if (job.status != OM_OK || !job.started) {
    return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
  }
  uint32_t frames = frame->header.blocksize;
  if (frames == 0) {
    return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
  }
  if (!ensure_planes(job, frames)) {
    job.status = OM_ERR_MEMORY;
    return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
  }
  for (uint32_t ch = 0; ch < job.in_channels; ch++) {
    double *dst = job.plane[ch];
    const FLAC__int32 *src = buffer[ch];
    for (uint32_t i = 0; i < frames; i++) {
      dst[i] = (double)src[i] * job.scale;
    }
  }
  uint32_t capacity = om_resample_max_out(job.resampler, frames);
  if (!ensure_interleaved(job, capacity)) {
    job.status = OM_ERR_MEMORY;
    return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
  }
  uint32_t produced = om_resample_push(job.resampler, (const double *const *)job.plane, frames,
                                       job.interleaved, capacity, 0);
  int32_t status = push_frames(job, job.interleaved, produced);
  if (status != OM_OK) {
    job.status = status;
    return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
  }
  return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
}

/* Hands the host the stream shape and the finished magic cookie. The encoder
 * only knows maxFrameBytes and avgBitRate once every packet is out. */
int32_t report_info(Job &job) {
  uint32_t cookie_len = job.encoder->GetMagicCookieSize(job.in_channels);
  uint8_t cookie[64];
  if (cookie_len > sizeof(cookie)) {
    return OM_ERR_ENCODER;
  }
  uint32_t written = cookie_len;
  job.encoder->GetMagicCookie(cookie, &written);
  if (written == 0) {
    return OM_ERR_ENCODER;
  }
  om_host_info(job.in_rate, job.in_channels, job.in_bits, job.out_rate, job.out_bits,
               job.frames_per_packet, (uint32_t)(job.source_frames & 0xffffffffu),
               (uint32_t)(job.source_frames >> 32), cookie, written);
  return OM_OK;
}

void error_cb(const FLAC__StreamDecoder *, FLAC__StreamDecoderErrorStatus, void *client) {
  Job &job = *(Job *)client;
  if (job.status == OM_OK) {
    job.status = OM_ERR_STREAM;
  }
}

} // namespace

int32_t om_transcode(uint32_t ceiling_rate, uint32_t ceiling_bits) {
  job_reset(g_job);
  g_job.ceiling_rate = ceiling_rate;
  g_job.ceiling_bits = ceiling_bits;

  FLAC__StreamDecoder *decoder = FLAC__stream_decoder_new();
  if (!decoder) {
    return OM_ERR_MEMORY;
  }
  FLAC__stream_decoder_set_md5_checking(decoder, false);

  FLAC__StreamDecoderInitStatus init =
      FLAC__stream_decoder_init_stream(decoder, read_cb, nullptr, nullptr, nullptr, nullptr,
                                       write_cb, metadata_cb, error_cb, &g_job);
  if (init != FLAC__STREAM_DECODER_INIT_STATUS_OK) {
    FLAC__stream_decoder_delete(decoder);
    return OM_ERR_DECODER;
  }

  int32_t result = OM_OK;
  if (!FLAC__stream_decoder_process_until_end_of_stream(decoder) && g_job.status == OM_OK) {
    result = OM_ERR_STREAM;
  }
  if (g_job.status != OM_OK) {
    result = g_job.status;
  }
  if (result == OM_OK && !g_job.started) {
    result = OM_ERR_STREAM;
  }

  if (result == OM_OK) {
    /* Drain the filter tail, then emit the final short packet. */
    uint32_t capacity = om_resample_max_out(g_job.resampler, 0) + g_job.frames_per_packet;
    if (ensure_interleaved(g_job, capacity)) {
      uint32_t produced = om_resample_push(g_job.resampler, (const double *const *)g_job.plane, 0,
                                           g_job.interleaved, capacity, 1);
      result = push_frames(g_job, g_job.interleaved, produced);
    } else {
      result = OM_ERR_MEMORY;
    }
  }
  if (result == OM_OK) {
    result = flush_packet(g_job);
  }
  if (result == OM_OK) {
    result = report_info(g_job);
  }

  FLAC__stream_decoder_delete(decoder);
  job_reset(g_job);
  return result;
}
