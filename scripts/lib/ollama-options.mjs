/**
 * Shared Ollama request options — CPU throttle (PR-H).
 *
 * Default Ollama inference saturates every core on the owner box, which
 * makes the machine unusable while nightly jobs run. Capping num_thread
 * to half the cores keeps the box responsive: slightly slower per call,
 * never pegged at 100%.
 *
 * Override with OLLAMA_NUM_THREAD (integer >= 1) for a one-off run that
 * should use more or fewer threads.
 */
import os from "node:os";

const envThreads = Number.parseInt(process.env.OLLAMA_NUM_THREAD ?? "", 10);

export const OLLAMA_NUM_THREAD =
  Number.isFinite(envThreads) && envThreads >= 1
    ? envThreads
    : Math.max(1, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2));
