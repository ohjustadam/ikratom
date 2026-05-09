// Sentry — edge runtime (Vercel Edge / proxy.ts) error capture.
// Lighter init than node; same DSN.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
