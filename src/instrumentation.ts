import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook. WITHOUT this file Next never initializes
 * server-side Sentry (sentry.server.config.ts / sentry.edge.config.ts existed
 * but were never loaded), so server-render + server-action errors were never
 * captured — which is why the `invalid-use-server-value` 500 (digest @E352)
 * that broke every server-action page re-render hid for weeks. register()
 * loads the right config per runtime; onRequestError forwards Next's server
 * request errors (RSC render, server actions, route handlers) to Sentry.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
