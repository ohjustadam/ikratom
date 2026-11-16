"use client";

import { useState, useTransition } from "react";
import { ComposeModal } from "@/modules/compose/ComposeModal";
import { getPressContact, type PressContactResult } from "./actions";

const REFUSED = {
  limit: "You've reached today's limit of 10 replies. Try again tomorrow.",
  missing: "That address is no longer on file.",
};

/** The address stays on the server until a signed-in member asks for it. */
export function PressReplyButton({
  contactId,
  label = "✉ Reply to the writer",
  source,
}: {
  contactId: string;
  label?: string;
  source: string;
}) {
  const [result, setResult] = useState<PressContactResult | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const ask = () =>
    start(async () => {
      const r = await getPressContact(contactId);
      setResult(r);
      if (r.ok) setOpen(true);
    });

  return (
    <>
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-60"
      >
        {pending ? "One moment…" : label}
      </button>
      {result && !result.ok && (
        <p className="mt-2 text-xs text-zinc-400">
          {result.reason === "signed_out" ? (
            <>
              <a href="/login" className="text-emerald-400 hover:underline">Sign in</a> to reply.
            </>
          ) : (
            REFUSED[result.reason]
          )}
        </p>
      )}
      {result?.ok && open && (
        <ComposeModal
          open={open}
          onClose={() => setOpen(false)}
          official={{ name: result.name, email: result.email }}
          context={{ kind: "stakeholder" }}
          source={source}
          template={{ subject: result.subject, body: result.body }}
        />
      )}
    </>
  );
}
