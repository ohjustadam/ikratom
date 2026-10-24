import { describe, expect, it } from "vitest";
import {
  RECORD_NONCE_RE,
  cleanRecordNonce,
  makeRecordNonce,
  recordAddress,
  withRecordBcc,
} from "@/lib/send-record";
import { decodeWords, htmlToText, parseMessage } from "../scripts/lib/mime-text.mjs";
import { readFileSync } from "node:fs";

describe("send-record nonce", () => {
  it("is 16 chars of lowercase base32 and matches the 0276 CHECK", () => {
    const sql = readFileSync("supabase/migrations/0276_send_record.sql", "utf8");
    expect(sql).toContain("'^[a-z2-7]{16}$'");
    for (let i = 0; i < 200; i++) expect(makeRecordNonce()).toMatch(RECORD_NONCE_RE);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, makeRecordNonce));
    expect(seen.size).toBe(500);
  });

  it("matches the Worker's address pattern", () => {
    const worker = readFileSync("scripts/cloudflare/send-record-worker.js", "utf8");
    const re = new RegExp(/ADDRESS_RE = \/(.+)\/;/.exec(worker)![1]);
    const n = makeRecordNonce();
    expect(re.exec(recordAddress(n))?.[1]).toBe(n);
    expect(re.test("hello@ikratom.org")).toBe(false);
    expect(re.test(`r-${n}@ikratom.org.evil.com`)).toBe(false);
  });

  it("appends to a BCC list only when there is a nonce", () => {
    expect(withRecordBcc("", null)).toBe("");
    expect(withRecordBcc("a@x.gov", null)).toBe("a@x.gov");
    expect(withRecordBcc("", "abcdefghijklmnop")).toBe("r-abcdefghijklmnop@ikratom.org");
    expect(withRecordBcc("a@x.gov,b@x.gov", "abcdefghijklmnop")).toBe(
      "a@x.gov,b@x.gov,r-abcdefghijklmnop@ikratom.org",
    );
  });

  it("server guard rejects anything that isn't a nonce", () => {
    expect(cleanRecordNonce("abcdefghijklmnop")).toBe("abcdefghijklmnop");
    for (const bad of ["", "ABCDEFGHIJKLMNOP", "abcdefghijklmno", "abcdefghijklmnop1", "abcdefgh1jklmnop", null, 5, {}])
      expect(cleanRecordNonce(bad)).toBeNull();
  });
});

const CRLF = (s: string) => s.replace(/\n/g, "\r\n");

describe("mime-text", () => {
  it("reads Gmail's multipart/alternative quoted-printable text part", () => {
    const raw = CRLF(
      [
        "From: Pat <pat@gmail.com>",
        "To: rep.smith@okhouse.gov",
        "Subject: =?UTF-8?Q?Fund_the_KCPA=2C_not_a_ban?=",
        'Content-Type: multipart/alternative; boundary="000000000000abc"',
        "",
        "--000000000000abc",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Dear Representative Smith,=0A=0AI live in Midwest City =E2=80=94 please fund t=",
        "he KCPA.",
        "",
        "--000000000000abc",
        'Content-Type: text/html; charset="UTF-8"',
        "",
        "<div>ignored</div>",
        "--000000000000abc--",
        "",
      ].join("\n"),
    );
    const { text, headers } = parseMessage(raw);
    expect(text).toBe("Dear Representative Smith,\n\nI live in Midwest City — please fund the KCPA.");
    expect(decodeWords(headers.get("subject"))).toBe("Fund the KCPA, not a ban");
  });

  it("decodes base64 parts in their charset and skips attachments", () => {
    const body = Buffer.from("Café owners support the KCPA.", "latin1").toString("base64");
    const raw = CRLF(
      [
        'Content-Type: multipart/mixed; boundary="b1"',
        "",
        "--b1",
        'Content-Type: text/plain; charset="iso-8859-1"',
        "Content-Transfer-Encoding: base64",
        "",
        body,
        "--b1",
        'Content-Type: text/plain; name="notes.txt"',
        'Content-Disposition: attachment; filename="notes.txt"',
        "",
        "SECRET ATTACHMENT",
        "--b1--",
      ].join("\n"),
    );
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    // The Worker passes a binary string (one char per byte).
    const { text } = parseMessage(String.fromCharCode(...bytes));
    expect(text).toBe("Café owners support the KCPA.");
    expect(text).not.toContain("SECRET");
  });

  it("finds text inside nested multipart (mixed > alternative)", () => {
    const raw = CRLF(
      [
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Nested letter.",
        "--inner--",
        "--outer--",
      ].join("\n"),
    );
    expect(parseMessage(raw).text).toBe("Nested letter.");
  });

  it("falls back to the HTML part with tags stripped", () => {
    const raw = CRLF(
      [
        'Content-Type: text/html; charset="utf-8"',
        "",
        "<html><head><style>p{}</style></head><body><p>Dear Senator,</p><p>Please &amp; thank you&#33;</p></body></html>",
      ].join("\n"),
    );
    expect(parseMessage(raw).text).toBe("Dear Senator,\nPlease & thank you!");
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });

  it("a plain single-part message with LF line endings", () => {
    expect(parseMessage("Subject: hi\n\nJust text.\n").text).toBe("Just text.");
  });

  it("decodes adjacent base64 encoded-words without the gap", () => {
    const a = Buffer.from("Kratom ").toString("base64");
    const b = Buffer.from("matters").toString("base64");
    expect(decodeWords(`=?utf-8?B?${a}?= =?utf-8?B?${b}?=`)).toBe("Kratom matters");
    expect(decodeWords("plain subject")).toBe("plain subject");
  });
});
