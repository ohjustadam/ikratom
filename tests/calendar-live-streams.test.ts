/**
 * calendar-live-streams.test.ts — upcoming YouTube lives from the channels
 * mirrored on /videos (mig 0260) land on /calendar as "live" events, for every
 * viewer (never geofenced), linking to the stream and to /videos.
 */
import { describe, it, expect } from "vitest";
import { buildEvents } from "@/app/calendar/build-events";
import type { CalendarSnapshot } from "@/app/calendar/types";

const empty: CalendarSnapshot = {
  meetings: [], alerts: [], billActions: [], sessions: [], elections: [], townhalls: [],
  billsEffective: [], billsSunset: [], localVotes: [], lives: [],
};

describe("calendar live streams", () => {
  it("adds an upcoming live with the channel name, stream link and /videos detail", () => {
    const snap = { ...empty, lives: [{ video_id: "0V1NYKncHG0", title: "Kratom hearing recap", scheduled_start_at: "2026-10-10T23:00:00Z", channel: { name: "Kratom Real Talk" } }] };
    const [e] = buildEvents(snap, "TX", Date.parse("2026-10-03T12:00:00Z"));
    expect(e.kind).toBe("live");
    expect(e.title).toBe("Kratom Real Talk: Kratom hearing recap");
    expect(e.livestream_url).toBe("https://www.youtube.com/watch?v=0V1NYKncHG0");
    expect(e.detail_href).toBe("/videos");
    expect(e.state).toBeNull();
  });

  it("shows lives to viewers with no state too, and tolerates a snapshot without the field", () => {
    const snap = { ...empty, lives: [{ video_id: "0V1NYKncHG0", title: "Q&A", scheduled_start_at: "2026-10-10T23:00:00Z", channel: null }] };
    expect(buildEvents(snap, null, Date.parse("2026-10-03T12:00:00Z")).map((e) => e.title)).toEqual(["Q&A"]);
    const { lives: _omit, ...older } = empty;
    expect(buildEvents(older as CalendarSnapshot, null, 0)).toEqual([]);
  });
});
