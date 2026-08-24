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
import {
  buildTimeline,
  totalDuration,
  clampSeek,
  scheduleFrom,
  positionAt,
  semitonesToCents,
  type TimelineChunk,
} from "./audio-timeline";

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
      KokoroTTS.from_pretrained(MODEL_ID, {
        // dtype MUST vary by device. int8/q8 matmul on the transformers.js +
        // onnxruntime-web WebGPU backend returns numerically-wrong tensors —
        // garbled "mumbo jumbo" speech — and does NOT throw, so the try/catch
        // WASM fallback below never fires and the user just hears gibberish.
        // fp32 is the known-good WebGPU dtype; q8 stays correct on WASM/CPU.
        dtype: device === "webgpu" ? "fp32" : "q8",
        device,
        progress_callback,
      });
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
  /**
   * Decoded audio is now RETAINED rather than discarded after scheduling.
   * Seeking means re-scheduling chunks that already played, which is only
   * possible if their buffers still exist. This is the whole reason a scrub
   * bar was impossible before.
   */
  private buffers: AudioBuffer[] = [];
  private timeline: TimelineChunk[] = [];
  /** AudioContext time corresponding to logical position 0. */
  private origin = 0;
  private aborted = false;
  private genDone = false;
  private detuneCents = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  onstate?: (s: KokoroState) => void;
  onprogress?: (fraction: number) => void;
  /** Fires as the transport moves so a UI can draw position without polling us. */
  ontick?: (position: number, duration: number) => void;

  /** Total generated audio so far, in seconds. Grows while streaming. */
  get duration(): number {
    return totalDuration(this.timeline);
  }

  /** Current position in seconds. Frozen while suspended, because
   *  ctx.currentTime itself stops — no separate bookkeeping to drift. */
  get position(): number {
    if (!this.ctx) return 0;
    return positionAt(this.ctx.currentTime, this.origin, this.duration);
  }

  /** Load (if needed) then stream-generate + play. Resolves when generation
   *  finishes; playback continues until the last scheduled chunk ends. */
  async play(text: string, voice: string, speed: number): Promise<void> {
    this.aborted = false; this.genDone = false;
    this.buffers = []; this.timeline = [];
    this.onstate?.("loading");
    const tts = (await getTTS((f) => this.onprogress?.(f))) as StreamingTTS;
    if (this.aborted) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.origin = this.ctx.currentTime;
    this.onstate?.("playing");
    for await (const chunk of tts.stream(text, { voice, speed })) {
      if (this.aborted || !this.ctx) break;
      this.enqueue(chunk.audio.audio, chunk.audio.sampling_rate);
    }
    this.genDone = true;
    this.armEndTimer();
  }

  private enqueue(f32: Float32Array, sampleRate: number) {
    if (!this.ctx || this.aborted) return;
    const buf = this.ctx.createBuffer(1, f32.length, sampleRate);
    buf.getChannelData(0).set(f32);
    this.buffers.push(buf);
    this.timeline = buildTimeline(this.buffers.map((b) => b.duration));

    // Schedule at its own place on the timeline, measured from the origin —
    // NOT from a running "nextStart" cursor. After a seek the cursor would be
    // meaningless, whereas the timeline position is always true.
    const chunk = this.timeline[this.buffers.length - 1];
    this.startSource(this.buffers.length - 1, this.origin + chunk.start, 0);
    this.armEndTimer();
  }

  /** Create + start one source. `at` is absolute AudioContext time. */
  private startSource(index: number, at: number, offset: number) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[index];
    // detune shifts pitch by resampling, so tempo moves with it (tape-speed
    // behaviour). Real-time and dependency-free; see semitonesToCents.
    try { src.detune.value = this.detuneCents; } catch { /* Safari < 14.1 */ }
    src.connect(this.ctx.destination);
    src.start(Math.max(at, this.ctx.currentTime), offset);
    this.sources.push(src);
  }

  private stopSources() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources = [];
  }

  /**
   * "Ended" is decided by the CLOCK, not by counting onended callbacks.
   * Counting broke as soon as seeking existed: a seek stops sources, firing
   * onended for audio that was never heard, so the player would announce it
   * had finished mid-sentence.
   */
  private armEndTimer() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (!this.genDone || !this.ctx || this.aborted) return;
    const remaining = Math.max(0, this.duration - this.position);
    this.endTimer = setTimeout(() => {
      if (this.aborted || !this.ctx) return;
      this.onstate?.("ended");
      this.cleanup();
    }, remaining * 1000 + 120);
  }

  /** Jump to a position in seconds. Safe before generation finishes. */
  seek(seconds: number) {
    if (!this.ctx) return;
    const target = clampSeek(seconds, this.duration);
    this.stopSources();
    // Re-anchor the origin so `position` reads the new place immediately,
    // even while suspended.
    this.origin = this.ctx.currentTime - target;
    for (const ins of scheduleFrom(this.timeline, target)) {
      this.startSource(ins.index, this.ctx.currentTime + ins.when, ins.offset);
    }
    this.ontick?.(this.position, this.duration);
    this.armEndTimer();
  }

  /** Relative jump — the rewind / fast-forward buttons. */
  nudge(deltaSeconds: number) {
    this.seek(this.position + deltaSeconds);
  }

  /** Pitch in semitones (-12..+12). Applies live and to everything scheduled after. */
  setPitch(semitones: number) {
    this.detuneCents = semitonesToCents(semitones);
    for (const s of this.sources) {
      try { s.detune.value = this.detuneCents; } catch { /* unsupported */ }
    }
  }

  pause() { this.ctx?.suspend?.(); if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; } this.onstate?.("paused"); }
  resume() { this.ctx?.resume?.(); this.armEndTimer(); this.onstate?.("playing"); }

  stop() {
    this.aborted = true;
    this.stopSources();
    this.cleanup();
    this.onstate?.("idle");
  }

  private cleanup() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ctx = null;
    this.sources = [];
    this.buffers = [];
    this.timeline = [];
  }
}
