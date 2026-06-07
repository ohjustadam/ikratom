// scripts/lib/kokoro-tts.mjs
// Local neural TTS via Kokoro-82M (kokoro-js, Apache-2.0, pure Node/WASM, no GPU)
// + @breezystack/lamejs MP3 encoding. Renders an array of {text, voice} segments
// into ONE mono MP3 buffer — powers the two-voice (anchor / co-anchor) daily
// brief and any future site-wide "Listen" audio.
//
// Replaces the msedge-tts dependency on an undocumented Microsoft endpoint with
// owned Apache-2.0 weights: real male + female voices, deterministic, free, and
// runnable in GitHub Actions (downloads the ~80MB q8 ONNX weights on first use).

import { KokoroTTS } from "kokoro-js";
import lamejs from "@breezystack/lamejs";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const Mp3Encoder = (lamejs.Mp3Encoder ? lamejs : (lamejs.default ?? lamejs)).Mp3Encoder;

// Named roles → Kokoro voice ids (28 voices available). am_michael = warm male
// anchor; af_heart = clear female co-anchor. Callers can also pass a raw id.
export const VOICES = { male: "am_michael", female: "af_heart" };

let _ttsPromise = null;
function getTTS() {
  if (!_ttsPromise) _ttsPromise = KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
  return _ttsPromise;
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
 */
export async function renderSegmentsToMp3(segments, { bitrate = 64, gapSeconds = 0.25 } = {}) {
  const tts = await getTTS();
  const chunks = [];
  let sampleRate = 24000;
  for (const seg of segments) {
    const text = String(seg?.text ?? "").trim();
    if (!text) continue;
    const voice = VOICES[seg.voice] ?? seg.voice ?? VOICES.male;
    const audio = await tts.generate(text, { voice });
    sampleRate = audio.sampling_rate;
    chunks.push(floatToInt16(audio.audio));
    if (gapSeconds > 0) chunks.push(new Int16Array(Math.round(sampleRate * gapSeconds)));
  }
  if (chunks.length === 0) return Buffer.alloc(0);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Int16Array(total);
  let off = 0;
  for (const c of chunks) { pcm.set(c, off); off += c.length; }

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
