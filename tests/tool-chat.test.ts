/**
 * tool-chat.test.ts — regression cover for the two envelope traps in
 * scripts/lib/tool-chat.mjs.
 *
 * These are worth pinning because BOTH failure modes are invisible on the
 * happy path. The stringify-on-the-way-back bug (case 2 below) was found by a
 * live smoke test, not by reading the code: turn one succeeded on every
 * provider, and Ollama only returned
 *     400 {"error":"Value looks like object, but can't find closing '}' symbol"}
 * on the turn AFTER a tool call — so an agent that happened to answer without
 * calling a tool looked perfectly healthy.
 */
import { describe, it, expect } from "vitest";
import { normaliseMessage, encodeForOpenAI, TOOL_PROVIDER_ORDER, availableToolProviders } from "../scripts/lib/tool-chat.mjs";

const openaiShape = {
  choices: [{
    message: {
      content: "",
      tool_calls: [{ id: "call_abc", type: "function", function: { name: "search_bills", arguments: '{"state":"OK"}' } }],
    },
  }],
};

const ollamaShape = {
  message: {
    content: "",
    tool_calls: [{ function: { name: "search_bills", arguments: { state: "OK" } } }],
  },
};

describe("normaliseMessage — reading both envelopes", () => {
  it("decodes OpenAI's JSON-string arguments into an object", () => {
    const { toolCalls } = normaliseMessage(openaiShape)!;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].args).toEqual({ state: "OK" });
    expect(toolCalls[0].id).toBe("call_abc");
  });

  it("passes Ollama's already-decoded object arguments through unchanged", () => {
    const { toolCalls } = normaliseMessage(ollamaShape, { native: true })!;
    expect(toolCalls[0].args).toEqual({ state: "OK" });
  });

  it("produces IDENTICAL tool arguments from both providers", () => {
    expect(normaliseMessage(openaiShape)!.toolCalls[0].args)
      .toEqual(normaliseMessage(ollamaShape, { native: true })!.toolCalls[0].args);
  });

  it("synthesises an id when the provider omits one", () => {
    // Ollama frequently omits ids; OpenAI-compatible providers then reject the
    // tool result because it matches no call on the assistant turn.
    const { toolCalls } = normaliseMessage(ollamaShape, { native: true })!;
    expect(toolCalls[0].id).toBeTruthy();
  });

  it("never hands a tool a non-object for arguments", () => {
    const malformed = { choices: [{ message: { tool_calls: [{ function: { name: "t", arguments: "{not json" } }] } }] };
    expect(normaliseMessage(malformed)!.toolCalls[0].args).toEqual({});

    const arrayArgs = { choices: [{ message: { tool_calls: [{ function: { name: "t", arguments: "[1,2]" } }] } }] };
    expect(normaliseMessage(arrayArgs)!.toolCalls[0].args).toEqual({});
  });

  it("drops nameless tool calls rather than dispatching an empty name", () => {
    const nameless = { choices: [{ message: { tool_calls: [{ function: { arguments: "{}" } }] } }] };
    expect(normaliseMessage(nameless)!.toolCalls).toHaveLength(0);
  });

  it("returns null when the response carries no message at all", () => {
    expect(normaliseMessage({})).toBeNull();
    expect(normaliseMessage({ choices: [] })).toBeNull();
  });
});

describe("encodeForOpenAI — writing the assistant turn back", () => {
  // The canonical conversation keeps arguments as OBJECTS (Ollama's shape).
  const convo = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "search_bills", arguments: { state: "OK" } } }],
    },
    { role: "tool", tool_call_id: "call_1", name: "search_bills", content: "{}" },
  ];

  it("stringifies object arguments for OpenAI-compatible providers", () => {
    const out = encodeForOpenAI(convo) as typeof convo;
    expect(typeof out[1].tool_calls![0].function.arguments).toBe("string");
    expect(JSON.parse(out[1].tool_calls![0].function.arguments as unknown as string)).toEqual({ state: "OK" });
  });

  it("leaves the canonical conversation untouched, so Ollama still gets objects", () => {
    encodeForOpenAI(convo);
    // Ollama 400s on a stringified arguments field — verified live 2026-09-07.
    expect(typeof convo[1].tool_calls![0].function.arguments).toBe("object");
  });

  it("is idempotent — encoding an already-encoded turn does not double-wrap", () => {
    const once = encodeForOpenAI(convo);
    const twice = encodeForOpenAI(once);
    expect(twice[1].tool_calls[0].function.arguments).toBe(once[1].tool_calls[0].function.arguments);
    expect(JSON.parse(twice[1].tool_calls[0].function.arguments)).toEqual({ state: "OK" });
  });

  it("passes through messages that carry no tool calls", () => {
    const plain = [{ role: "user", content: "hi" }];
    expect(encodeForOpenAI(plain)).toEqual(plain);
  });
});

describe("provider inventory", () => {
  it("puts Ollama first — free and local before anyone's quota", () => {
    expect(TOOL_PROVIDER_ORDER[0]).toBe("ollama");
  });

  it("excludes Gemini and Cloudflare, whose function-calling uses another envelope", () => {
    expect(TOOL_PROVIDER_ORDER).not.toContain("gemini");
    expect(TOOL_PROVIDER_ORDER).not.toContain("cloudflare");
  });

  it("never reports Ollama as a configured CLOUD provider", () => {
    expect(availableToolProviders()).not.toContain("ollama");
  });

  it("treats a provider as available only when its key is set", () => {
    const had = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "";
    try {
      expect(availableToolProviders()).not.toContain("groq");
      process.env.GROQ_API_KEY = "test-key";
      expect(availableToolProviders()).toContain("groq");
    } finally {
      if (had === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = had;
    }
  });
});
