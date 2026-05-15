import { describe, it, expect } from "vitest";
import {
  filenameExt,
  isExecutable,
  isArchive,
  isMedia,
  isImage,
  isPdf,
  looksLikeText,
  rejectReasonForUpload,
} from "../file-signatures";

// Helper: turn a hex string ("25 50 44 46 2d") into a Uint8Array.
// `padTo` pads with 0x20 (space) — a benign printable byte — so it
// doesn't bias `looksLikeText` by adding control bytes.
function bytes(hex: string, padTo = 16): Uint8Array {
  const arr = hex.trim().split(/\s+/).map((h) => parseInt(h, 16));
  while (arr.length < padTo) arr.push(0x20);
  return Uint8Array.from(arr);
}

describe("filenameExt", () => {
  it("returns last extension lowercased", () => {
    expect(filenameExt("paper.pdf")).toBe("pdf");
    expect(filenameExt("Paper.PDF")).toBe("pdf");
    expect(filenameExt("a.b.c.txt")).toBe("txt");
  });
  it("catches double-extension tricks (uses LAST segment)", () => {
    expect(filenameExt("malware.pdf.exe")).toBe("exe");
    expect(filenameExt("video.pdf.mp4")).toBe("mp4");
  });
  it("handles no extension", () => {
    expect(filenameExt("README")).toBe("");
    expect(filenameExt("")).toBe("");
  });
  it("strips trailing whitespace", () => {
    expect(filenameExt("paper.pdf  ")).toBe("pdf");
  });
});

describe("isExecutable", () => {
  it("detects Windows MZ executables", () => {
    expect(isExecutable(bytes("4d 5a 90 00"))).toBe(true);
  });
  it("detects ELF (Linux) binaries", () => {
    expect(isExecutable(bytes("7f 45 4c 46"))).toBe(true);
  });
  it("detects Mach-O (macOS) binaries", () => {
    expect(isExecutable(bytes("fe ed fa cf"))).toBe(true);
    expect(isExecutable(bytes("cf fa ed fe"))).toBe(true);
  });
  it("detects shebang shell scripts", () => {
    expect(isExecutable(bytes("23 21 2f 62 69 6e"))).toBe(true); // #!/bin
  });
  it("doesn't flag PDFs", () => {
    expect(isExecutable(bytes("25 50 44 46 2d"))).toBe(false);
  });
});

describe("isArchive", () => {
  it("detects PK ZIP (includes docx / xlsx / jar)", () => {
    expect(isArchive(bytes("50 4b 03 04"))).toBe(true);
  });
  it("detects 7-zip", () => {
    expect(isArchive(bytes("37 7a bc af 27 1c"))).toBe(true);
  });
  it("detects RAR", () => {
    expect(isArchive(bytes("52 61 72 21 1a 07"))).toBe(true);
  });
  it("detects gzip", () => {
    expect(isArchive(bytes("1f 8b 08"))).toBe(true);
  });
  it("detects bzip2", () => {
    expect(isArchive(bytes("42 5a 68"))).toBe(true);
  });
  it("detects XZ", () => {
    expect(isArchive(bytes("fd 37 7a 58 5a 00"))).toBe(true);
  });
});

describe("isMedia", () => {
  it("detects RIFF (wav/avi)", () => {
    expect(isMedia(bytes("52 49 46 46 24 00"))).toBe(true);
  });
  it("detects mp3 (ID3)", () => {
    expect(isMedia(bytes("49 44 33 03 00"))).toBe(true);
  });
  it("detects mp3 (frame sync)", () => {
    expect(isMedia(bytes("ff fb 90 00"))).toBe(true);
  });
  it("detects mp4 / mov (ftyp at offset 4)", () => {
    expect(isMedia(bytes("00 00 00 20 66 74 79 70"))).toBe(true);
  });
  it("detects Matroska / webm", () => {
    expect(isMedia(bytes("1a 45 df a3"))).toBe(true);
  });
  it("detects OGG", () => {
    expect(isMedia(bytes("4f 67 67 53"))).toBe(true);
  });
  it("detects FLAC", () => {
    expect(isMedia(bytes("66 4c 61 43"))).toBe(true);
  });
});

describe("isImage", () => {
  it("detects PNG", () => {
    expect(isImage(bytes("89 50 4e 47 0d 0a 1a 0a"))).toBe(true);
  });
  it("detects JPEG", () => {
    expect(isImage(bytes("ff d8 ff e0 00"))).toBe(true);
  });
  it("detects GIF", () => {
    expect(isImage(bytes("47 49 46 38 39 61"))).toBe(true);
  });
  it("detects BMP", () => {
    expect(isImage(bytes("42 4d 36 00"))).toBe(true);
  });
});

describe("isPdf", () => {
  it("detects valid %PDF- signature", () => {
    expect(isPdf(bytes("25 50 44 46 2d 31 2e 34"))).toBe(true); // %PDF-1.4
  });
  it("rejects a renamed binary claiming to be PDF", () => {
    expect(isPdf(bytes("4d 5a 90 00"))).toBe(false); // MZ exe
  });
});

describe("looksLikeText", () => {
  it("accepts ASCII text", () => {
    const t = new TextEncoder().encode("# Research paper notes\n\nLorem ipsum.");
    expect(looksLikeText(t.slice(0, 16))).toBe(true);
  });
  it("rejects too many control bytes", () => {
    expect(looksLikeText(bytes("00 01 02 03 04 05 06 07"))).toBe(false);
  });
  it("allows newlines, tabs, CR", () => {
    expect(looksLikeText(bytes("48 09 65 0a 6c 0d 6c 6f"))).toBe(true); // H\t e\n l\r lo
  });
});

describe("rejectReasonForUpload — integration", () => {
  it("accepts a real PDF", () => {
    expect(rejectReasonForUpload(bytes("25 50 44 46 2d 31 2e 34 0a 25"), "pdf")).toBeNull();
  });
  it("accepts a real text file", () => {
    const t = new TextEncoder().encode("Hello kratom research");
    expect(rejectReasonForUpload(t.slice(0, 16), "txt")).toBeNull();
  });
  it("rejects a renamed .exe as .pdf", () => {
    const r = rejectReasonForUpload(bytes("4d 5a 90 00 03 00 00 00"), "pdf");
    expect(r).toMatch(/Executables/i);
  });
  it("rejects a renamed mp4 as .pdf", () => {
    const r = rejectReasonForUpload(bytes("00 00 00 20 66 74 79 70 69 73 6f 6d"), "pdf");
    expect(r).toMatch(/Audio.*video|video|audio/i);
  });
  it("rejects a zip claiming to be a PDF", () => {
    const r = rejectReasonForUpload(bytes("50 4b 03 04 14 00 00 00"), "pdf");
    expect(r).toMatch(/Archives/i);
  });
  it("rejects PNG claiming to be a PDF", () => {
    const r = rejectReasonForUpload(bytes("89 50 4e 47 0d 0a 1a 0a 00 00 00 0d"), "pdf");
    expect(r).toMatch(/Image/i);
  });
  it("rejects a text file with executable signature", () => {
    const r = rejectReasonForUpload(bytes("4d 5a 90 00 03 00 00 00"), "txt");
    expect(r).toMatch(/Executables/i);
  });
  it("rejects an unknown extension", () => {
    const t = new TextEncoder().encode("not really a movie file");
    const r = rejectReasonForUpload(t.slice(0, 16), "mp4");
    expect(r).toMatch(/Unsupported extension/);
  });
  it("rejects PDF that doesn't start with %PDF-", () => {
    const r = rejectReasonForUpload(bytes("48 65 6c 6c 6f 20 77 6f 72 6c 64 20 21"), "pdf");
    expect(r).toMatch(/PDF signature/);
  });
  it("rejects files that are too small (<8 bytes of header)", () => {
    const r = rejectReasonForUpload(bytes("25 50 44", 4), "pdf");
    expect(r).toMatch(/too small/i);
  });
});
