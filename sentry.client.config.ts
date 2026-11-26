// Sentry — browser-side error capture.
// DSN comes from NEXT_PUBLIC_SENTRY_DSN; if missing, init is a no-op.
// Tracing + replay are off by default to keep the free-tier 5k events/month
// covered for actual errors. Bump tracesSampleRate when we want perf data.

import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/sentry-scrub";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Don't capture noisy expected errors
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
    ],
    // Cookies, IP headers, bodies and query strings never leave (src/lib/sentry-scrub.ts).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
