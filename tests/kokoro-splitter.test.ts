/**
 * kokoro-splitter.test.ts — "Listen" must read the LAST sentence.
 *
 * kokoro-js 1.2.1 stream(string) pushes text into a TextSplitterStream and never
 * closes it. The splitter holds the final sentence until close(), so the last
 * sentence of every article was never spoken and the generator never finished
 * (the reader never reached "ended"). The player now passes a closed splitter.
 * (The CI brief renderer's twin check lives in tests/kokoro-server-render.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TextSplitterStream } from "kokoro-js";

async function sentences(s: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of s) out.push(t);
  return out;
}

describe("kokoro sentence splitter", () => {
  it("yields every sentence, including the last, once closed", async () => {
    const s = new TextSplitterStream();
    s.push("The hearing is Monday. Bring a friend. This is the final sentence.");
    s.close();
    const got = await sentences(s as unknown as AsyncIterable<string>);
    expect(got).toHaveLength(3);
    expect(got.at(-1)).toBe("This is the final sentence.");
  });

  it("the browser player hands stream() a closed splitter, never a bare string", () => {
    const client = readFileSync("src/lib/kokoro-tts-client.ts", "utf8");
    expect(client).toMatch(/tts\.stream\(closedInput\(text\)/);
    expect(client).toMatch(/s\.close\(\)/);
  });
});
