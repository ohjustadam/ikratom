"use client";

/**
 * Small client island that triggers window.print() on click. Lets the
 * rest of /bills/[id]/dossier stay a server component while still
 * giving users a one-click "save as PDF" path.
 */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-emerald-700/40 px-3 py-1 font-semibold text-emerald-100 hover:bg-emerald-700/60"
    >
      🖨 Print / save as PDF
    </button>
  );
}
