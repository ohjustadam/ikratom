import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  totalDuration,
  clampSeek,
  scheduleFrom,
  positionAt,
  formatTime,
  semitonesToCents,
} from "@/lib/audio-timeline";

/** Four sentences, as the streaming TTS would hand them over. */
const SENTENCES = [2, 3, 1.5, 4];

describe("buildTimeline", () => {
  it("lays chunks end-to-end with no gap or overlap", () => {
    expect(buildTimeline(SENTENCES)).toEqual([
      { index: 0, start: 0, duration: 2 },
      { index: 1, start: 2, duration: 3 },
      { index: 2, start: 5, duration: 1.5 },
      { index: 3, start: 6.5, duration: 4 },
    ]);
  });

  it("neutralises a malformed duration instead of corrupting the rest", () => {
    // A bad decode must cost one chunk, not shift every chunk after it.
    const t = buildTimeline([2, NaN, 3]);
    expect(t[1].duration).toBe(0);
    expect(t[2].start).toBe(2);
    expect(totalDuration(t)).toBe(5);
  });

  it("handles an empty stream", () => {
    expect(buildTimeline([])).toEqual([]);
    expect(totalDuration([])).toBe(0);
  });
});

describe("clampSeek", () => {
  it("keeps a position inside the track", () => {
    expect(clampSeek(-5, 10)).toBe(0);
    expect(clampSeek(99, 10)).toBe(10);
    expect(clampSeek(4.2, 10)).toBe(4.2);
  });

  it("never returns NaN — a NaN would poison every later calculation", () => {
    expect(clampSeek(NaN, 10)).toBe(0);
  });
});

describe("scheduleFrom", () => {
  const timeline = buildTimeline(SENTENCES);

  it("schedules everything from the start", () => {
    expect(scheduleFrom(timeline, 0)).toEqual([
      { index: 0, when: 0, offset: 0 },
      { index: 1, when: 2, offset: 0 },
      { index: 2, when: 5, offset: 0 },
      { index: 3, when: 6.5, offset: 0 },
    ]);
  });

  it("starts mid-chunk when seeking into one", () => {
    // t=3.5 is 1.5s into sentence 2 (which spans 2..5).
    const s = scheduleFrom(timeline, 3.5);
    expect(s[0]).toEqual({ index: 1, when: 0, offset: 1.5 });
    // Later chunks keep their spacing relative to NOW.
    expect(s[1]).toEqual({ index: 2, when: 1.5, offset: 0 });
    expect(s[2]).toEqual({ index: 3, when: 3, offset: 0 });
  });

  it("drops chunks already finished", () => {
    const s = scheduleFrom(timeline, 6);
    expect(s.map((x) => x.index)).toEqual([2, 3]);
  });

  it("does NOT replay a chunk ending exactly at the seek point", () => {
    // t=5 is the boundary: sentence 2 (2..5) is done, sentence 3 begins.
    // An inclusive comparison here would repeat a sentence the listener just
    // heard — audible, and the kind of thing review never catches.
    const s = scheduleFrom(timeline, 5);
    expect(s.map((x) => x.index)).toEqual([2, 3]);
    expect(s[0]).toEqual({ index: 2, when: 0, offset: 0 });
  });

  it("returns nothing past the end", () => {
    expect(scheduleFrom(timeline, 999)).toEqual([]);
  });

  it("skips zero-length chunks rather than scheduling silence", () => {
    const t = buildTimeline([2, 0, 3]);
    expect(scheduleFrom(t, 0).map((x) => x.index)).toEqual([0, 2]);
  });

  it("loses no audio across a seek — the gapless property", () => {
    // Everything from t onward must still be accounted for exactly once.
    const t = 3.5;
    const s = scheduleFrom(timeline, t);
    const remaining = s.reduce((acc, ins) => {
      const c = timeline[ins.index];
      return acc + (c.duration - ins.offset);
    }, 0);
    expect(remaining).toBeCloseTo(totalDuration(timeline) - t, 10);
  });
});

describe("positionAt", () => {
  it("reports elapsed time against the context clock", () => {
    expect(positionAt(12, 10, 30)).toBe(2);
  });

  it("clamps at the end rather than running past it", () => {
    expect(positionAt(100, 10, 30)).toBe(30);
  });

  it("never reports a negative position", () => {
    // Can happen briefly if origin is set a tick ahead of the clock.
    expect(positionAt(9.99, 10, 30)).toBe(0);
  });
});

describe("formatTime", () => {
  it("formats mm:ss with a padded seconds field", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(600)).toBe("10:00");
  });

  it("shows 0:00 for junk instead of NaN:NaN", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-4)).toBe("0:00");
  });
});

describe("semitonesToCents", () => {
  it("converts semitones to cents", () => {
    expect(semitonesToCents(0)).toBe(0);
    expect(semitonesToCents(1)).toBe(100);
    expect(semitonesToCents(-3)).toBe(-300);
  });

  it("bounds to one octave each way — past that speech is unintelligible", () => {
    expect(semitonesToCents(50)).toBe(1200);
    expect(semitonesToCents(-50)).toBe(-1200);
  });

  it("treats junk as no shift", () => {
    expect(semitonesToCents(NaN)).toBe(0);
  });
});
