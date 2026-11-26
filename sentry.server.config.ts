// Sentry — server-side (Node runtime) error capture.
// Catches API route + server action + RSC errors.

import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/sentry-scrub";

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    // Cookies, IP headers, bodies and query strings never leave (src/lib/sentry-scrub.ts).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
