#!/usr/bin/env node
/**
 * AI provider smoke test.
 *
 * Pings each available provider with a tiny prompt + a tiny structured
 * prompt, prints latency + output. Use this to verify env keys + Ollama
 * server before relying on the router in production code.
 *
 *   npm run ai:smoke
 *
 * Add OLLAMA_HOST / GEMINI_API_KEY / GROQ_API_KEY in .env.local to enable
 * each. Missing keys → that provider is skipped (not an error).
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OLLAMA_NUM_THREAD } from "./lib/ollama-options.mjs";

// We can't import the .ts router from node directly without a build step,
// so this script duplicates the minimal client logic. (Each provider's
// HTTP shape is small; cost of duplication is acceptable for a smoke test.)

const TIMEOUT = 30000;

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "llama3.1:8b";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_DEFAULT_MODEL ?? "gemini-2.5-flash";
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_DEFAULT_MODEL ?? "llama-3.3-70b-versatile";

const PROMPT = "In one sentence, what is kratom? Be neutral.";
const STRUCTURED_PROMPT = "Classify this message as 'spam' or 'ham': 'CLICK HERE TO WIN A FREE IPHONE NOW!!!'";
const STRUCTURED_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", enum: ["spam", "ham"] },
    confidence: { type: "number" },
  },
  required: ["label"],
};

function pad(s, n) { return (s + " ".repeat(n)).slice(0, n); }

async function withTimeout(p, ms, who) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${who} timeout after ${ms}ms`)), ms)),
  ]);
}

async function testOllama() {
  console.log("\n── ollama ──");
  try {
    const ok = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!ok.ok) {
      console.log("  ✗ /api/tags returned " + ok.status);
      return;
    }
  } catch (e) {
    console.log("  ✗ not reachable at " + OLLAMA_HOST + " (" + e.message + ")");
    return;
  }
  // plain
  const t1 = Date.now();
  const r1 = await withTimeout(
    fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: PROMPT, stream: false, options: { num_thread: OLLAMA_NUM_THREAD } }),
    }).then((r) => r.json()),
    TIMEOUT, "ollama plain"
  );
  console.log(`  ✓ plain     ${Date.now() - t1}ms  ${r1.response?.slice(0, 90).replace(/\s+/g, " ")}…`);
  // structured
  const t2 = Date.now();
  const r2 = await withTimeout(
    fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: STRUCTURED_PROMPT,
        system: `Respond ONLY with JSON matching this schema: ${JSON.stringify(STRUCTURED_SCHEMA)}.`,
        stream: false,
        format: "json",
        options: { num_thread: OLLAMA_NUM_THREAD },
      }),
    }).then((r) => r.json()),
    TIMEOUT, "ollama structured"
  );
  console.log(`  ✓ structured ${Date.now() - t2}ms  ${r2.response}`);
}

async function testGemini() {
  console.log("\n── gemini ──");
  if (!GEMINI_KEY) { console.log("  – skipped (GEMINI_API_KEY not set)"); return; }
  const t1 = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const r1 = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT }] }] }),
    }).then((r) => r.json()),
    TIMEOUT, "gemini plain"
  );
  const text1 = r1.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no output)";
  console.log(`  ✓ plain     ${Date.now() - t1}ms  ${text1.slice(0, 90).replace(/\s+/g, " ")}…`);
  // structured
  const t2 = Date.now();
  const r2 = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: STRUCTURED_PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: STRUCTURED_SCHEMA },
      }),
    }).then((r) => r.json()),
    TIMEOUT, "gemini structured"
  );
  const text2 = r2.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no output)";
  console.log(`  ✓ structured ${Date.now() - t2}ms  ${text2}`);
}

async function testGroq() {
  console.log("\n── groq ──");
  if (!GROQ_KEY) { console.log("  – skipped (GROQ_API_KEY not set)"); return; }
  const t1 = Date.now();
  const r1 = await withTimeout(
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: PROMPT }] }),
    }).then((r) => r.json()),
    TIMEOUT, "groq plain"
  );
  const text1 = r1.choices?.[0]?.message?.content ?? "(no output)";
  console.log(`  ✓ plain     ${Date.now() - t1}ms  ${text1.slice(0, 90).replace(/\s+/g, " ")}…`);
  // structured
  const t2 = Date.now();
  const r2 = await withTimeout(
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: `Respond ONLY with JSON matching: ${JSON.stringify(STRUCTURED_SCHEMA)}.` },
          { role: "user", content: STRUCTURED_PROMPT },
        ],
        response_format: { type: "json_object" },
      }),
    }).then((r) => r.json()),
    TIMEOUT, "groq structured"
  );
  const text2 = r2.choices?.[0]?.message?.content ?? "(no output)";
  console.log(`  ✓ structured ${Date.now() - t2}ms  ${text2}`);
}

console.log("AI provider smoke test\n");
console.log(pad("provider", 10), "  status / output");
console.log("─".repeat(70));
await testOllama();
await testGemini();
await testGroq();
console.log("\n(Done. If a provider failed, check env keys / server reachability.)");
