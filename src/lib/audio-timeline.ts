/**
 * audio-timeline.ts — the arithmetic behind a seekable TTS player.
 *
 * The Kokoro path generates speech one sentence at a time and schedules each
 * PCM chunk back-to-back on an AudioContext. That gives real audio, but the
 * player had no notion of a TIMELINE: no duration, no position, no way to seek.
 * You could start, pause and stop, and nothing else.
 *
 * Adding scrub/rewind/forward means answering three questions precisely:
 *   - where does each chunk sit on one continuous timeline?
 *   - given a seek to t, which chunks still need scheduling, when, and from
 *     how far into their own buffer?
 *   - what is "now" while the clock is running, paused, or past the end?
 *
 * That is arithmetic, and arithmetic is exactly what has been quietly wrong all
 * session — a cap that sent 20 of 198 and reported success, a mailto 386% over
 * the URL limit. An off-by-one here means audio that skips a sentence or
 * replays one, which sounds like a broken product and is invisible in review.
 * So it lives here, in plain functions, with tests — not inside a Web Audio
 * callback where nothing can reach it.
 *
 * Everything is in SECONDS on a logical timeline starting at 0. Nothing here
 * touches the Web Audio API, which is what makes it testable in node.
 */

export type TimelineChunk = {
  /** Index in generation order. */
  index: number;
  /** Where this chunk starts on the logical timeline. */
  start: number;
  /** Chunk length in seconds. */
  duration: number;
};

/** A chunk that must be (re)scheduled, and how. */
export type ScheduleInstruction = {
  index: number;
  /** Seconds from NOW at which to start it. 0 = immediately. */
  when: number;
  /** Seconds into the chunk's own buffer to begin from (mid-chunk seek). */
  offset: number;
};

/** Lay chunk durations end-to-end on one timeline. */
export function buildTimeline(durations: number[]): TimelineChunk[] {
  const out: TimelineChunk[] = [];
  let cursor = 0;
  durations.forEach((duration, index) => {
    // Guard against NaN/negative from a malformed decode: a bad duration would
    // corrupt every subsequent chunk's start, not just its own.
    const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
    out.push({ index, start: cursor, duration: d });
    cursor += d;
  });
  return out;
}

/** Total length of the timeline. */
export function totalDuration(chunks: TimelineChunk[]): number {
  if (chunks.length === 0) return 0;
  const last = chunks[chunks.length - 1];
  return last.start + last.duration;
}

/** Keep a requested position inside [0, total]. */
export function clampSeek(t: number, total: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(Math.max(0, t), Math.max(0, total));
}

/**
 * What to schedule to make playback continue from `fromTime`.
 *
 * Chunks entirely in the past are skipped. The chunk containing `fromTime`
 * starts immediately, part-way into its buffer. Later chunks are scheduled
 * relative to now, preserving the gaps between them exactly.
 */
export function scheduleFrom(
  chunks: TimelineChunk[],
  fromTime: number,
): ScheduleInstruction[] {
  const t = Math.max(0, fromTime);
  const out: ScheduleInstruction[] = [];
  for (const c of chunks) {
    if (c.duration <= 0) continue;
    const end = c.start + c.duration;
    // Strictly greater: a chunk ending exactly at the seek point is finished,
    // and rescheduling it would replay a sentence the listener just heard.
    if (end <= t) continue;
    if (c.start <= t) {
      out.push({ index: c.index, when: 0, offset: t - c.start });
    } else {
      out.push({ index: c.index, when: c.start - t, offset: 0 });
    }
  }
  return out;
}

/**
 * Position on the logical timeline.
 *
 * `origin` is the AudioContext time that corresponded to logical 0. Because
 * ctx.suspend() freezes ctx.currentTime, a paused player naturally reports a
 * frozen position with no extra bookkeeping — the clock we read is the same
 * clock that stopped.
 */
export function positionAt(
  ctxNow: number,
  origin: number,
  total: number,
): number {
  return clampSeek(ctxNow - origin, total);
}

/** mm:ss for a transport display. Negative/NaN render as 0:00, never "NaN:NaN". */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Semitones → the `detune` value (cents) for an AudioBufferSourceNode.
 *
 * HONEST LIMITATION: detune resamples, so it shifts pitch AND tempo together,
 * like changing tape speed. It is genuinely real-time and needs no dependency,
 * which is why it is the right first implementation here. Formant-preserving
 * pitch shift (voice unchanged in speed) needs a phase vocoder — a real build,
 * not a parameter. The UI must not imply otherwise.
 */
export function semitonesToCents(semitones: number): number {
  const s = Number.isFinite(semitones) ? semitones : 0;
  // ±12 semitones is an octave in each direction; past that speech stops being
  // intelligible, so the control is bounded rather than free.
  return Math.min(Math.max(-12, s), 12) * 100;
}
