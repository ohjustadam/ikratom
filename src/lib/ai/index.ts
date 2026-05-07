/**
 * Public surface of the AI toolkit.
 *
 * Callers import from "@/lib/ai" — never reach into providers/ directly.
 * That keeps the routing decision in one place and lets us swap providers
 * without touching consumers.
 */

export { complete, completeStructured, whichAvailable } from "./router";
export type {
  TaskKind,
  ProviderName,
  RouteConstraints,
  CompletionOptions,
  CompletionResult,
  StructuredResult,
  StructuredSchema,
  PromptInput,
} from "./types";
export { NoProviderError } from "./types";
