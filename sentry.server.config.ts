// Sentry — server-side (Node runtime) error capture.
// Catches API route + server action + RSC errors.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    // Server-side: be more permissive with what we capture; less PII risk
    // than browser since we control the env. Still strip auth headers.
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        delete headers.authorization;
        delete headers.cookie;
      }
      return event;
    },
  });
}
