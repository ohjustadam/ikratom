"use client";

import { useState } from "react";
import { GroupComposeModal } from "./GroupComposeModal";
import { isContactFormUrl } from "./send-links";
import type { ComposeGroup, ComposeOfficial } from "./types";

/**
 * "Email the council" for a local hearing: the full group composer (templates
 * with fill-ins, pick-who-gets-it, AI draft, Gmail/Outlook/BCC delivery) aimed
 * at a town council or county board, with the meeting's details pre-filled.
 * Sends go from the advocate's OWN mail client — never a platform blast.
 */
export function EmailCouncilButton({
  officials, bodyName, locality, meetingDate, meetingUrl, meetingId,
}: {
  officials: ComposeOfficial[];
  bodyName: string;
  locality: string;
  meetingDate: string;
  meetingUrl: string;
  meetingId: string;
}) {
  const [open, setOpen] = useState(false);
  const group: ComposeGroup = {
    key: "council",
    label: `${bodyName} · ${locality}`,
    greeting: `Members of the ${bodyName}`,
    emailable: officials.filter((o) => o.email && !isContactFormUrl(o.email)),
    formOnly: officials.filter((o) => !o.email || isContactFormUrl(o.email)),
  };
  if (group.emailable.length + group.formOnly.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
        ✉️ {group.emailable.length ? "Email" : "Contact"} the {bodyName.toLowerCase().includes("board") ? "board" : "council"} ({group.emailable.length || group.formOnly.length})
      </button>
      {open && (
        <GroupComposeModal
          open
          onClose={() => setOpen(false)}
          group={group}
          kind="local"
          stance="oppose"
          ask={`Regulate natural-leaf kratom instead of banning it at the ${meetingDate} ${bodyName} meeting.`}
          source={`meeting_council_${meetingId}`}
          templateContext={{ body_name: bodyName, locality, meeting_date: meetingDate, meeting_url: meetingUrl }}
        />
      )}
    </>
  );
}
