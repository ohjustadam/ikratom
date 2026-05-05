"use client";

/**
 * Global error boundary — catches errors in the root layout itself.
 * This file MUST define <html> and <body> tags since it replaces the layout
 * when triggered.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#fafafa", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: "640px", margin: "8rem auto", padding: "0 1rem", textAlign: "center" }}>
          <p style={{ color: "#f87171", fontFamily: "monospace", fontSize: "0.875rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Critical error
          </p>
          <h1 style={{ marginTop: "1rem", fontSize: "2.5rem", fontWeight: "bold" }}>
            Something is very wrong.
          </h1>
          <p style={{ marginTop: "1rem", color: "#a1a1aa" }}>
            The platform itself crashed. Reload to try again.
          </p>
          {error?.digest && (
            <p style={{ marginTop: "0.75rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#52525b" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              background: "#10b981",
              color: "#0a0a0a",
              fontWeight: "bold",
              border: "none",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
