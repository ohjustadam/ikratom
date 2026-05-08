"use client";

import { useState } from "react";

/**
 * "Local action playbook" — uniform actionable UI rendered above the
 * journey block on /bills/[id] when scope=municipal/county and
 * local_meta has been populated.
 *
 * Renders parsed local-event metadata as one-click actions:
 *   - meeting_at         → Add to calendar (.ics download, no library)
 *   - public_comment_email → mailto: with pre-filled subject + body
 *   - public_comment_form_url → opens form in new tab
 *   - dial_in_phone      → tel: link
 *   - remote_url         → Zoom / Teams join button
 *   - livestream_urls    → array of "Watch live" buttons
 *   - officials_to_contact → list with mailto: per official
 *
 * Sections render only when their data is present, so partial intel
 * (advocate tip with just a meeting date and no Zoom URL) still
 * produces a useful card without blank rows.
 */

export type LocalMeta = {
  meeting_at?: string;
  meeting_location?: string;
  livestream_urls?: Array<{ label: string; url: string }>;
  remote_url?: string;
  dial_in_phone?: string;
  dial_in_phone_alt?: string;
  dial_in_meeting_id?: string;
  public_comment_email?: string;
  public_comment_form_url?: string;
  public_comment_deadline?: string;
  public_comment_format_notes?: string;
  agenda_item_number?: string;
  officials_to_contact?: Array<{ title?: string; name: string; email?: string; phone?: string }>;
  official_status?: string;
  summary_one_line?: string;
};

/** Generate a minimal RFC 5545 .ics file inline — no library needed. */
function buildIcs(input: {
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  description?: string;
  url?: string;
}) {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // YYYYMMDDTHHMMSSZ in UTC
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  };
  const dtStart = fmt(input.startsAt);
  if (!dtStart) return null;
  const dtEnd = input.endsAt ? fmt(input.endsAt) : fmt(new Date(new Date(input.startsAt).getTime() + 90 * 60_000).toISOString());
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const uid = `ikratom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ikratom.org`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//iKratom//Policy Briefing//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escape(input.title)}`,
    input.location ? `LOCATION:${escape(input.location)}` : null,
    input.description ? `DESCRIPTION:${escape(input.description)}` : null,
    input.url ? `URL:${input.url}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BillLocalActionCard({
  meta,
  billTitle,
  billState,
  billLocality,
  agendaItemNumber,
}: {
  meta: LocalMeta;
  billTitle: string;
  billState: string;
  billLocality: string | null;
  agendaItemNumber?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const meetingDate = meta.meeting_at ? new Date(meta.meeting_at) : null;
  const meetingValid = meetingDate && !isNaN(meetingDate.getTime());
  const commentDeadline = meta.public_comment_deadline ? new Date(meta.public_comment_deadline) : null;
  const commentDeadlineValid = commentDeadline && !isNaN(commentDeadline.getTime());

  const mailtoSubject = `Public comment — ${meta.agenda_item_number ?? agendaItemNumber ?? "kratom-related agenda item"}`;
  const mailtoBody =
    `To the City Clerk / Council members,\n\n` +
    `I'm writing to submit public comment on the kratom-related agenda item${agendaItemNumber ? ` (${agendaItemNumber})` : ""} ` +
    `${billLocality ? `in ${billLocality}` : ""}.\n\n` +
    `[Replace this paragraph with your specific comment. Keep it respectful and on-topic. ` +
    `If you support a distinction between natural-leaf kratom and 7-OH-enriched / synthetic ` +
    `derivatives, say so explicitly — this is the most important advocacy point.]\n\n` +
    `Thank you for your time and consideration.\n\n` +
    `Sincerely,\n[Your name]\n[Your address (if a resident)]`;

  const mailtoHref = meta.public_comment_email
    ? `mailto:${meta.public_comment_email}?subject=${encodeURIComponent(mailtoSubject)}&body=${encodeURIComponent(mailtoBody)}`
    : null;

  function onAddToCalendar() {
    if (!meta.meeting_at) return;
    const description = [
      meta.summary_one_line,
      meta.agenda_item_number ? `Agenda item: ${meta.agenda_item_number}` : null,
      meta.remote_url ? `Remote attendance: ${meta.remote_url}` : null,
      meta.dial_in_phone ? `Dial in: ${meta.dial_in_phone}${meta.dial_in_meeting_id ? ` (Meeting ID ${meta.dial_in_meeting_id})` : ""}` : null,
      meta.public_comment_email ? `Written comment: ${meta.public_comment_email}` : null,
      meta.public_comment_deadline ? `Comment deadline: ${new Date(meta.public_comment_deadline).toLocaleString()}` : null,
    ].filter(Boolean).join("\n");
    const ics = buildIcs({
      title: `${billState}: ${billTitle.slice(0, 100)}`,
      startsAt: meta.meeting_at,
      location: meta.meeting_location,
      description,
      url: meta.remote_url,
    });
    if (ics) downloadIcs(`ikratom-${billState.toLowerCase()}-${meta.meeting_at.slice(0, 10)}.ics`, ics);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(label); setTimeout(() => setCopied(null), 1800); },
      () => {},
    );
  }

  // If the meta has nothing renderable, return null and let the regular
  // bill detail UI handle the page.
  const hasAnything =
    meta.meeting_at ||
    meta.public_comment_email ||
    meta.public_comment_form_url ||
    meta.remote_url ||
    meta.dial_in_phone ||
    meta.livestream_urls?.length ||
    meta.officials_to_contact?.length;
  if (!hasAnything) return null;

  return (
    <section className="mb-6 rounded-lg border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/40 p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
          ⚡ Local action playbook
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          everything you need to participate · one click each
        </span>
      </div>

      {meta.summary_one_line && (
        <p className="mb-4 text-sm text-zinc-300">{meta.summary_one_line}</p>
      )}

      {/* MEETING — date, location, calendar */}
      {meetingValid && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            🗓 Meeting
          </div>
          <div className="text-base font-semibold text-zinc-100">
            {meetingDate!.toLocaleString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          </div>
          {meta.meeting_location && (
            <div className="mt-1 text-sm text-zinc-400">📍 {meta.meeting_location}</div>
          )}
          {meta.agenda_item_number && (
            <div className="mt-1 text-xs text-zinc-500">Agenda item: <span className="font-mono text-zinc-300">{meta.agenda_item_number}</span></div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onAddToCalendar}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              📅 Add to calendar
            </button>
          </div>
        </div>
      )}

      {/* HOW TO ATTEND / SUBMIT COMMENT */}
      {(meta.remote_url || meta.dial_in_phone || meta.livestream_urls?.length || meta.public_comment_email || meta.public_comment_form_url) && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            🎤 Participate
          </div>

          {meta.public_comment_email && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-zinc-500">Submit written comment by email</div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={mailtoHref ?? "#"}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                >
                  ✉ Open in mail client (templated)
                </a>
                <button
                  type="button"
                  onClick={() => copyToClipboard(meta.public_comment_email!, "email")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                  title={meta.public_comment_email}
                >
                  {copied === "email" ? "✓ copied" : "📋 copy address"}
                </button>
              </div>
              {commentDeadlineValid && (
                <div className="mt-1.5 text-[11px] text-amber-400">
                  ⏰ Deadline: {commentDeadline!.toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
                  })}
                </div>
              )}
              {meta.public_comment_format_notes && (
                <div className="mt-1.5 text-[11px] text-zinc-500">{meta.public_comment_format_notes}</div>
              )}
            </div>
          )}

          {meta.public_comment_form_url && (
            <div className="mb-3">
              <a
                href={meta.public_comment_form_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
              >
                🌐 Public comment form ↗
              </a>
            </div>
          )}

          {meta.remote_url && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-zinc-500">Remote attendance</div>
              <a
                href={meta.remote_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                💻 Join meeting (Zoom / video) ↗
              </a>
            </div>
          )}

          {meta.dial_in_phone && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-zinc-500">Phone in</div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`tel:${meta.dial_in_phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                >
                  ☎ {meta.dial_in_phone}
                </a>
                {meta.dial_in_phone_alt && (
                  <a
                    href={`tel:${meta.dial_in_phone_alt.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                  >
                    ☎ {meta.dial_in_phone_alt}
                  </a>
                )}
                {meta.dial_in_meeting_id && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(meta.dial_in_meeting_id!, "meetingid")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                  >
                    {copied === "meetingid" ? "✓ copied" : `📋 ID ${meta.dial_in_meeting_id}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {(meta.livestream_urls ?? []).length > 0 && (
            <div className="mb-1">
              <div className="mb-1 text-xs text-zinc-500">Watch live</div>
              <div className="flex flex-wrap gap-2">
                {(meta.livestream_urls ?? []).map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
                  >
                    🎥 {s.label} ↗
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* OFFICIALS TO CONTACT */}
      {(meta.officials_to_contact ?? []).length > 0 && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            🏛 Officials to contact
          </div>
          <ul className="space-y-2">
            {(meta.officials_to_contact ?? []).map((o, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">
                  <span className="font-semibold text-zinc-100">{o.name}</span>
                  {o.title && <span className="ml-1 text-zinc-500">({o.title})</span>}
                </span>
                {o.email && (
                  <a
                    href={`mailto:${o.email}?subject=${encodeURIComponent(mailtoSubject)}&body=${encodeURIComponent(mailtoBody)}`}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-950/60"
                  >
                    ✉ email
                  </a>
                )}
                {o.phone && (
                  <a
                    href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                  >
                    ☎ {o.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* NOTIFY ME — placeholder, real subscription wiring is the next PR */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          title="Bill subscriptions land in the next PR — meeting reminders, status-change alerts, push notifications"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-500 cursor-not-allowed"
        >
          🔔 Notify me about updates (coming next)
        </button>
      </div>
    </section>
  );
}
