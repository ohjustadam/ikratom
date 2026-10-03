/**
 * email-render.mjs — HTML + plain-text bodies for every email iKratom sends.
 *
 * Rules every template follows:
 *  - Inline styles and tables only: Gmail/Outlook strip <style> and flexbox.
 *  - Every link goes to an iKratom page, never straight to a news site. The
 *    site's reader shows the article without the publisher's ads, which is a
 *    feature we lead with.
 *  - Dates are Eastern time (memory: civic-dates-anchor-eastern). A meeting
 *    stored at local midnight has no known time and says "time TBA".
 *  - A one-click unsubscribe link and a "manage settings" link in every email.
 *  - Identity is never rendered beyond @username (public-anonymity rule).
 */
const C = { ink: "#14171c", mute: "#5d6673", line: "#e3e6eb", bg: "#f4f6f8", brand: "#1a7f4b", warn: "#b26b00" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const abs = (appUrl, link) => (!link ? appUrl : /^https?:\/\//.test(link) ? link : `${appUrl}${link.startsWith("/") ? "" : "/"}${link}`);

export function fmtMeetingTime(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const hm = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return hm === "12:00 AM" ? `${day} · time TBA` : `${day} · ${hm} ET`;
}

const button = (href, label, primary = true) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:9px 14px;border-radius:7px;font:600 13px/1 Arial,sans-serif;text-decoration:none;` +
  (primary ? `background:${C.brand};color:#ffffff;` : `background:#ffffff;color:${C.brand};border:1px solid ${C.brand};`) + `">${esc(label)}</a>`;

function shell({ preheader, title, bodyHtml, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:12px;">
<tr><td style="padding:22px 24px 6px;font:700 20px/1.2 Arial,sans-serif;color:${C.brand};">iKratom</td></tr>
<tr><td style="padding:0 24px 18px;font:15px/1.55 Arial,sans-serif;color:${C.ink};">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid ${C.line};font:12px/1.55 Arial,sans-serif;color:${C.mute};">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function footerHtml({ appUrl, unsubscribeUrl, reason }) {
  return `${esc(reason)}<br>iKratom is a nonpartisan, independent advocacy toolbelt.<br>` +
    `<a href="${esc(`${appUrl}/account`)}" style="color:${C.mute};">Manage notification settings</a>` +
    (unsubscribeUrl ? ` · <a href="${esc(unsubscribeUrl)}" style="color:${C.mute};">Unsubscribe from email</a>` : "");
}
const footerText = ({ appUrl, unsubscribeUrl, reason }) =>
  `\n--\n${reason}\nManage settings: ${appUrl}/account${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}\n`;

/** A meeting rendered as a card with every action a reader can take. */
export function meetingCard(m, appUrl) {
  const where = [m.body_name, m.locality ?? m.state].filter(Boolean).join(" · ");
  const page = `${appUrl}/meetings/${m.id}`;
  const buttons = [button(page, "Details + who decides")];
  if (m.zoom_url) buttons.push(button(m.zoom_url, "Join on Zoom", false));
  if (m.livestream_url) buttons.push(button(m.livestream_url, "Watch live", false));
  if (m.public_comment_signup_url) buttons.push(button(m.public_comment_signup_url, "Sign up to speak", false));
  if (m.agenda_url) buttons.push(button(m.agenda_url, "Agenda", false));
  const deadline = m.public_comment_deadline ? `<div style="color:${C.warn};font-size:13px;">Public comment deadline: ${esc(fmtMeetingTime(m.public_comment_deadline))}</div>` : "";
  const html = `<div style="border:1px solid ${C.line};border-left:4px solid ${C.brand};border-radius:9px;padding:12px 14px;margin:10px 0;">
<div style="font-weight:700;">${esc(where)}</div><div style="color:${C.mute};font-size:13px;">${esc(fmtMeetingTime(m.meeting_at))}${m.format && m.format !== "unknown" ? ` · ${esc(m.format)}` : ""}</div>${deadline}
<div style="margin-top:8px;">${buttons.join("")}</div></div>`;
  const text = `* ${where}\n  ${fmtMeetingTime(m.meeting_at)}\n  Details + who decides: ${page}` +
    (m.zoom_url ? `\n  Zoom: ${m.zoom_url}` : "") + (m.public_comment_signup_url ? `\n  Sign up to speak: ${m.public_comment_signup_url}` : "");
  return { html, text };
}

/**
 * Daily digest. sections: [{ title, items: [{ title, body, link }], meetings?: [row] }]
 * Empty sections are dropped; items beyond `cap` collapse into a "+N more" link.
 */
export function renderDigest({ username, sections, appUrl, unsubscribeUrl, briefLink, cap = 8 }) {
  const live = sections.filter((s) => (s.items?.length ?? 0) + (s.meetings?.length ?? 0) > 0);
  const count = live.reduce((n, s) => n + (s.items?.length ?? 0) + (s.meetings?.length ?? 0), 0);
  const parts = [`<p style="margin:0 0 12px;">Hi @${esc(username || "advocate")} — here is what moved on kratom policy since your last update.</p>`];
  const txt = [`Hi @${username || "advocate"} — here is what moved on kratom policy since your last update.\n`];
  if (briefLink) {
    parts.push(`<p style="margin:0 0 14px;">${button(abs(appUrl, briefLink), "Today's 2-minute brief (read or listen)")}</p>`);
    txt.push(`Today's brief: ${abs(appUrl, briefLink)}\n`);
  }
  for (const s of live) {
    parts.push(`<h2 style="font:700 15px/1.3 Arial,sans-serif;margin:20px 0 6px;color:${C.ink};">${esc(s.title)}</h2>`);
    txt.push(`\n== ${s.title} ==`);
    for (const m of s.meetings ?? []) { const c = meetingCard(m, appUrl); parts.push(c.html); txt.push(c.text); }
    const items = s.items ?? [];
    for (const it of items.slice(0, cap)) {
      const href = abs(appUrl, it.link);
      parts.push(`<div style="margin:9px 0;"><a href="${esc(href)}" style="color:${C.brand};font-weight:600;text-decoration:none;">${esc(it.title)}</a>` +
        (it.body ? `<div style="color:${C.mute};font-size:13px;">${esc(String(it.body).slice(0, 180))}</div>` : "") + `</div>`);
      txt.push(`- ${it.title}\n  ${href}`);
    }
    if (items.length > cap) {
      parts.push(`<div style="font-size:13px;"><a href="${esc(`${appUrl}/notifications`)}" style="color:${C.brand};">+${items.length - cap} more on iKratom</a></div>`);
      txt.push(`  +${items.length - cap} more: ${appUrl}/notifications`);
    }
  }
  parts.push(`<p style="margin:18px 0 0;font-size:13px;color:${C.mute};">Every article opens in iKratom's reader: the full story, no publisher ads, and the actions you can take sit right next to it.</p>`);
  const reason = "You get this daily summary because email updates are on for your iKratom account.";
  const subject = live.some((s) => s.meetings?.length)
    ? `Hearing alert + ${count - live.reduce((n, s) => n + (s.meetings?.length ?? 0), 0)} kratom updates`
    : `${count} kratom policy update${count === 1 ? "" : "s"} for you`;
  return {
    subject, count,
    html: shell({ preheader: `${count} updates, meetings first.`, title: subject, bodyHtml: parts.join(""), footer: footerHtml({ appUrl, unsubscribeUrl, reason }) }),
    text: txt.join("\n") + footerText({ appUrl, unsubscribeUrl, reason }),
  };
}

/** Immediate alert for one or more newly verified meetings. */
export function renderMeetingAlert({ username, meetings, appUrl, unsubscribeUrl }) {
  const cards = meetings.map((m) => meetingCard(m, appUrl));
  const first = meetings[0];
  const subject = meetings.length === 1
    ? `Kratom hearing: ${first.locality ?? first.state} ${first.body_name ?? "meeting"}, ${fmtMeetingTime(first.meeting_at).split(" · ")[0]}`
    : `${meetings.length} kratom hearings are coming up`;
  const intro = `Officials are about to decide on kratom. Public meetings are where a few voices change outcomes: watch, sign up to speak, or email the people who vote.`;
  const reason = "You get hearing alerts because email updates are on for your iKratom account. Meetings are sent to every member, whatever their state.";
  return {
    subject,
    html: shell({ preheader: intro, title: subject, bodyHtml: `<p style="margin:0 0 6px;">Hi @${esc(username || "advocate")},</p><p style="margin:0 0 6px;">${esc(intro)}</p>${cards.map((c) => c.html).join("")}`, footer: footerHtml({ appUrl, unsubscribeUrl, reason }) }),
    text: `Hi @${username || "advocate"},\n\n${intro}\n\n${cards.map((c) => c.text).join("\n\n")}` + footerText({ appUrl, unsubscribeUrl, reason }),
  };
}

/**
 * Announcement / feature email. blocks: [{ heading, body, link?, linkLabel? }]
 * The same content lives on the site at `pageLink`, which the in-app
 * notification also opens, so email and site never disagree.
 */
export function renderAnnouncement({ username, subject, preheader, intro, blocks, pageLink, appUrl, unsubscribeUrl }) {
  const html = [`<p style="margin:0 0 12px;">Hi @${esc(username || "advocate")},</p><p style="margin:0 0 14px;">${esc(intro)}</p>`];
  const text = [`Hi @${username || "advocate"},\n\n${intro}\n`];
  for (const b of blocks) {
    html.push(`<h2 style="font:700 16px/1.3 Arial,sans-serif;margin:20px 0 4px;color:${C.ink};">${esc(b.heading)}</h2><p style="margin:0 0 6px;">${esc(b.body)}</p>` +
      (b.link ? `<p style="margin:0 0 6px;">${button(abs(appUrl, b.link), b.linkLabel || "Open on iKratom", false)}</p>` : ""));
    text.push(`\n${b.heading}\n${b.body}${b.link ? `\n${abs(appUrl, b.link)}` : ""}`);
  }
  html.push(`<p style="margin:22px 0 0;">${button(abs(appUrl, pageLink), "See the full update on iKratom")}</p>`);
  text.push(`\nFull update: ${abs(appUrl, pageLink)}`);
  const reason = "You get this because you have an iKratom account. Product updates are rare; settings below.";
  return {
    subject,
    html: shell({ preheader, title: subject, bodyHtml: html.join(""), footer: footerHtml({ appUrl, unsubscribeUrl, reason }) }),
    text: text.join("\n") + footerText({ appUrl, unsubscribeUrl, reason }),
  };
}
