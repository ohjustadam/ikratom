/**
 * kokoro-tts-client.ts — in-browser neural TTS for the site-wide "Listen"
 * feature, using the SAME model + voices as the daily-brief audio
 * (Kokoro-82M, kokoro-js). Runs entirely client-side via WebGPU (fast) with a
 * WASM-CPU fallback — $0, no server, no box dependency, works on any text.
 *
 * The ~90MB q8 weights download once from the HuggingFace CDN on first use and
 * are cached by the browser forever after (transformers.js IndexedDB cache).
 * We lazy-import kokoro-js only when the user actually clicks Listen, so it
 * never weighs down a normal page load.
 *
 * Playback streams sentence-by-sentence: we generate the first chunk, start
 * playing it via WebAudio, and keep generating the rest while it plays — so the
 * user hears audio in ~a second or two, not after the whole article renders.
 *
 * AudioReader keeps browser speechSynthesis as an instant fallback for
 * unsupported browsers and while the model is still downloading.
 */

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Curated voice list (subset of Kokoro's 28). af_heart is the highest-graded
 *  voice in the model; am_michael is the daily-brief's male "anchor". */
export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart · warm female (recommended)" },
  { id: "am_michael", label: "Michael · warm male (brief anchor)" },
  { id: "af_bella", label: "Bella · female" },
  { id: "af_nicole", label: "Nicole · soft female" },
  { id: "am_adam", label: "Adam · male" },
  { id: "bf_emma", label: "Emma · British female" },
  { id: "bm_george", label: "George · British male" },
];
export const DEFAULT_KOKORO_VOICE = "af_heart";

export type KokoroState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

/** WASM is universal in modern browsers; WebGPU is a speed bonus when present. */
export function kokoroSupported(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined" && typeof AudioContext !== "undefined";
}

// Singleton model promise — load the ~90MB weights at most once per page session
// (the browser caches the files across sessions). Reset on failure so a later
// click can retry.
let _ttsPromise: Promise<unknown> | null = null;

async function getTTS(onProgress?: (fraction: number) => void): Promise<unknown> {
  if (_ttsPromise) return _ttsPromise;
  _ttsPromise = (async () => {
    const mod = await import("kokoro-js");
    const KokoroTTS = (mod as { KokoroTTS: { from_pretrained: (id: string, o: unknown) => Promise<unknown> } }).KokoroTTS;
    const progress_callback = (info: { status?: string; progress?: number }) => {
      if (onProgress && info?.status === "progress" && typeof info.progress === "number") {
        onProgress(Math.max(0, Math.min(1, info.progress / 100)));
      }
    };
    const load = (device: "webgpu" | "wasm") =>
      KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device, progress_callback });
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as { gpu?: unknown }).gpu;
    if (hasWebGPU) {
      try { return await load("webgpu"); } catch { /* GPU init can fail — fall back */ }
    }
    return load("wasm");
  })().catch((e) => { _ttsPromise = null; throw e; });
  return _ttsPromise;
}

type RawAudio = { audio: Float32Array; sampling_rate: number };
type StreamingTTS = { stream: (text: string, opts: { voice: string; speed: number }) => AsyncGenerator<{ audio: RawAudio }> };

/**
 * Streaming WebAudio player. One instance per AudioReader. Generates with
 * kokoro-js and schedules each sentence's PCM back-to-back on an AudioContext.
 */
export class KokoroPlayer {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nextStart = 0;
  private aborted = false;
  private genDone = false;
  private scheduled = 0;
  private ended = 0;
  onstate?: (s: KokoroState) => void;
  onprogress?: (fraction: number) => void;

  /** Load (if needed) then stream-generate + play. Resolves when generation
   *  finishes; playback continues until the last scheduled chunk ends. */
  async play(text: string, voice: string, speed: number): Promise<void> {
    this.aborted = false; this.genDone = false; this.scheduled = 0; this.ended = 0;
    this.onstate?.("loading");
    const tts = (await getTTS((f) => this.onprogress?.(f))) as StreamingTTS;
    if (this.aborted) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.nextStart = this.ctx.currentTime;
    this.onstate?.("playing");
    for await (const chunk of tts.stream(text, { voice, speed })) {
      if (this.aborted || !this.ctx) break;
      this.enqueue(chunk.audio.audio, chunk.audio.sampling_rate);
    }
    this.genDone = true;
    this.checkEnded();
  }

  private enqueue(f32: Float32Array, sampleRate: number) {
    if (!this.ctx || this.aborted) return;
    const buf = this.ctx.createBuffer(1, f32.length, sampleRate);
    buf.getChannelData(0).set(f32);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const startAt = Math.max(this.nextStart, this.ctx.currentTime);
    src.start(startAt);
    this.nextStart = startAt + buf.duration;
    this.scheduled++;
    src.onended = () => { this.ended++; this.checkEnded(); };
    this.sources.push(src);
  }

  private checkEnded() {
    if (this.genDone && !this.aborted && this.scheduled > 0 && this.ended >= this.scheduled) {
      this.onstate?.("ended");
      this.cleanup();
    }
  }

  pause() { this.ctx?.suspend?.(); this.onstate?.("paused"); }
  resume() { this.ctx?.resume?.(); this.onstate?.("playing"); }

  stop() {
    this.aborted = true;
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.cleanup();
    this.onstate?.("idle");
  }

  private cleanup() {
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ctx = null;
    this.sources = [];
  }
}
