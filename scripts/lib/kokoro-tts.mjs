// scripts/lib/kokoro-tts.mjs
// Local neural TTS via Kokoro-82M (kokoro-js, Apache-2.0, pure Node/WASM, no GPU)
// + @breezystack/lamejs MP3 encoding. Renders an array of {text, voice} segments
// into ONE mono MP3 buffer — powers the two-voice (anchor / co-anchor) daily
// brief and any future site-wide "Listen" audio.
//
// Replaces the msedge-tts dependency on an undocumented Microsoft endpoint with
// owned Apache-2.0 weights: real male + female voices, deterministic, free, and
// runnable in GitHub Actions (downloads the ONNX weights on first use; see DTYPE).

import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import lamejs from "@breezystack/lamejs";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const Mp3Encoder = (lamejs.Mp3Encoder ? lamejs : (lamejs.default ?? lamejs)).Mp3Encoder;

// Named roles → Kokoro voice ids (28 voices available). am_michael = warm male
// anchor; af_heart = clear female co-anchor. Callers can also pass a raw id.
export const VOICES = { male: "am_michael", female: "af_heart" };

// fp32 = the reference weights (~330MB). q8 (~90MB) is a quantised copy with
// audible hiss/metallic edges; the browser keeps q8 on WASM for download size,
// but a CI render downloads once per run and can afford studio quality.
// KOKORO_DTYPE=q8 for a fast local smoke test.
const DTYPE = process.env.KOKORO_DTYPE || "fp32";

let _ttsPromise = null;
function getTTS() {
  if (!_ttsPromise) _ttsPromise = KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: "cpu" });
  return _ttsPromise;
}

/** Scale so the loudest sample sits at -1 dBFS: consistent volume day to day, no clipping. */
function peakNormalize(f32, target = 0.89) {
  let peak = 0;
  for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > peak) peak = a; }
  if (peak < 1e-4) return f32;
  const g = target / peak;
  for (let i = 0; i < f32.length; i++) f32[i] *= g;
  return f32;
}

function floatToInt16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
}

/**
 * Render [{ text, voice: 'male' | 'female' | <kokoro-id> }] → one mono MP3 Buffer.
 * Inserts a short pause between segments for natural pacing.
 *
 * Each segment is STREAMED sentence by sentence. kokoro-js generate() tokenises
 * with truncation:true at ~510 phoneme tokens (roughly 80-100 words), so a long
 * segment used to stop mid-sentence with no error. stream() splits first, but
 * stream(string) never closes its splitter, which holds the LAST sentence until
 * close() (kokoro-js 1.2.1) — so we pass a splitter we have already closed.
 */
export async function renderSegmentsToMp3(segments, { bitrate = 96, gapSeconds = 0.25 } = {}) {
  const tts = await getTTS();
  const chunks = [];
  let sampleRate = 24000;
  for (const seg of segments) {
    const text = String(seg?.text ?? "").trim();
    if (!text) continue;
    const voice = VOICES[seg.voice] ?? seg.voice ?? VOICES.male;
    const input = new TextSplitterStream();
    input.push(text);
    input.close();
    for await (const { audio } of tts.stream(input, { voice })) {
      sampleRate = audio.sampling_rate;
      chunks.push(audio.audio);
    }
    if (gapSeconds > 0) chunks.push(new Float32Array(Math.round(sampleRate * gapSeconds)));
  }
  if (chunks.length === 0) return Buffer.alloc(0);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const f32 = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { f32.set(c, off); off += c.length; }
  const pcm = floatToInt16(peakNormalize(f32));

  const enc = new Mp3Encoder(1, sampleRate, bitrate);
  const out = [];
  let buf;
  for (let i = 0; i < pcm.length; i += 1152) {
    buf = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (buf.length) out.push(Buffer.from(buf));
  }
  buf = enc.flush();
  if (buf.length) out.push(Buffer.from(buf));
  return Buffer.concat(out);
}
