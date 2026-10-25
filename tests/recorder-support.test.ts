import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clipFileProblem, extForContentType, isInAppBrowser, mediaErrorMessage, pickRecorderMime, uploadContentType } from "../src/modules/campaigns/recorder-support";

/**
 * "Record audio / Record video do nothing" (Paul, 2026-10-24). The root cause
 * was the Permissions-Policy header; these pin it and the browser differences
 * the recorder now handles.
 */

const chrome = (t: string) => t.startsWith("audio/webm") || t.startsWith("video/webm");
const safari = (t: string) => t === "audio/mp4" || t === "video/mp4";

describe("the page allows our own recorder", () => {
  it("Permissions-Policy grants camera and microphone to 'self' and nothing else", () => {
    const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    const value = /key: "Permissions-Policy", value: "([^"]+)"/.exec(cfg)?.[1] ?? "";
    expect(value).toContain("camera=(self)");
    expect(value).toContain("microphone=(self)");
    expect(value).not.toMatch(/camera=\(\)|microphone=\(\)|\*/);
    expect(value).toContain("geolocation=()");
  });

  it("the upload never fetch()es its blob: URL, which our CSP connect-src refuses", () => {
    const rec = readFileSync(new URL("../src/modules/campaigns/components/AttachmentRecorder.tsx", import.meta.url), "utf8");
    expect(rec).not.toMatch(/fetch\(previewUrl/);
  });
});

describe("recording format", () => {
  it("Chrome records WebM, iOS Safari records MP4", () => {
    expect(pickRecorderMime("audio", chrome)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime("video", chrome)).toBe("video/webm;codecs=vp8,opus");
    expect(pickRecorderMime("audio", safari)).toBe("audio/mp4");
    expect(pickRecorderMime("video", safari)).toBe("video/mp4");
    expect(pickRecorderMime("audio", () => false)).toBeUndefined();
    expect(pickRecorderMime("audio", () => { throw new Error("old browser"); })).toBeUndefined();
  });

  it("uploads a plain media type the bucket (audio/*, video/*) accepts", () => {
    expect(uploadContentType("audio/webm;codecs=opus", "audio")).toBe("audio/webm");
    expect(uploadContentType("", "audio")).toBe("audio/mp4");
    expect(uploadContentType(undefined, "video")).toBe("video/mp4");
    expect(uploadContentType("text/html", "audio")).toBe("audio/mp4"); // never a non-media type
  });

  it("names the file after what was recorded", () => {
    expect(extForContentType("audio/webm")).toBe("webm");
    expect(extForContentType("audio/mp4")).toBe("m4a");
    expect(extForContentType("video/mp4")).toBe("mp4");
    expect(extForContentType("video/quicktime")).toBe("mov");
  });
});

describe("a refused permission says what to do", () => {
  it("names the device and the fix", () => {
    const denied = mediaErrorMessage({ name: "NotAllowedError" }, "audio");
    expect(denied).toMatch(/blocked the microphone/);
    expect(denied).toMatch(/Settings › Safari/);
    expect(mediaErrorMessage({ name: "NotAllowedError" }, "video")).toMatch(/camera and microphone/);
    expect(mediaErrorMessage({ name: "NotFoundError" }, "audio")).toBe("No microphone was found on this device.");
    expect(mediaErrorMessage({ name: "NotReadableError" }, "video")).toMatch(/in use by another app/);
    expect(mediaErrorMessage({ name: "Unsupported" }, "audio")).toMatch(/can't record/);
    expect(mediaErrorMessage(new Error("boom"), "audio")).toBe("Couldn't start recording: boom");
  });
});

describe("where the page can't record (owner, 2026-10-24: all devices)", () => {
  it("spots in-app browsers and leaves real browsers alone", () => {
    expect(isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 350.0")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Version/4.0 Chrome/129.0 Mobile Safari/537.36")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe(false);
    expect(isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isInAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe(false);
    expect(isInAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0")).toBe(false);
  });

  it("an uploaded clip keeps the 30 s / 25 MB limits", () => {
    const MB = 1024 * 1024;
    expect(clipFileProblem({ type: "video/quicktime", size: 8 * MB }, 22, 30, 25 * MB)).toBeNull();
    expect(clipFileProblem({ type: "audio/x-m4a", size: MB }, null, 30, 25 * MB)).toBeNull(); // length unknown: allowed
    expect(clipFileProblem({ type: "video/mp4", size: 64 * MB }, 30, 30, 25 * MB)).toMatch(/64 MB; the limit is 25 MB/);
    expect(clipFileProblem({ type: "audio/mpeg", size: MB }, 95, 30, 25 * MB)).toMatch(/up to 30 seconds; this one is 95/);
    expect(clipFileProblem({ type: "image/png", size: MB }, null, 30, 25 * MB)).toMatch(/isn't an audio or video/);
  });

  it("the recorder offers the phone's camera app and a file picker", () => {
    const rec = readFileSync(new URL("../src/modules/campaigns/components/AttachmentRecorder.tsx", import.meta.url), "utf8");
    expect(rec).toMatch(/<input type="file" accept="audio\/\*,video\/\*" capture=/);
    expect(rec).toMatch(/Open in browser/);
    expect(rec).toMatch(/isTypeSupported/);
  });
});
