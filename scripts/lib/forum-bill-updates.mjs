// What the bill bot writes in a state forum, kept apart from the database so the
// rules can be tested. A state gets ONE running thread; a bill is a comment in it.

const stance = (bill) => (bill.kratom_relevance === "anti" ? "🚫 Restrictive" : "✅ Supportive");
const statusText = (bill) => String(bill.status ?? "introduced").replace(/_/g, " ");
const billName = (bill) => `${bill.state ?? "FED"} ${bill.bill_number}`;

// A comment is worth posting when one of these changes.
export function billUpdateKey(bill) {
  return `${bill.status ?? ""}|${String(bill.last_action_at ?? "").slice(0, 10)}`;
}

// Federal bills go in the US forum, which is the national board.
export function forumKey(bill) {
  return bill.scope === "federal" ? "US" : bill.state;
}

// `comment` gets a post. `silent` was announced in its old per-bill thread, so
// it only needs its key stamped: re-announcing it would be the flood again.
export function planBillPosts(bills) {
  const comment = [];
  const silent = [];
  for (const b of bills) {
    if (b.forum_update_key === billUpdateKey(b)) continue;
    if (!b.forum_update_key && b.forum_thread_id) silent.push(b);
    else comment.push(b);
  }
  return { comment, silent };
}

export function billUpdateComment(bill, appUrl) {
  const lead = bill.forum_update_key ? "📣 Update" : "🆕 New bill";
  const lines = [`**${lead}: ${billName(bill)}** (${stance(bill)})`, String(bill.title ?? "").slice(0, 160), ""];
  lines.push(`**Status:** ${statusText(bill)}`);
  if (bill.last_action) {
    const when = bill.last_action_at ? ` (${String(bill.last_action_at).slice(0, 10)})` : "";
    lines.push(`**Last action:** ${String(bill.last_action).slice(0, 200)}${when}`);
  }
  lines.push("", `[Open the bill](${appUrl}/bills/${bill.id})`);
  return lines.join("\n");
}

export function digestThreadTitle(name) {
  return `${name} bill updates`;
}

export function digestThreadBody(name) {
  return `🤖 This is iKratom's one running thread for ${name}. Every new bill and status change lands here as a comment, so the rest of this forum stays for people. Add what you know below, or start your own thread.`;
}

// The first comment in a new thread: what's live right now, as one post.
export function billWatchList(name, bills, appUrl) {
  const shown = bills.slice(0, 10).map((b) => `- [${billName(b)}](${appUrl}/bills/${b.id}) (${stance(b)}, ${statusText(b)})`);
  const more = bills.length > shown.length ? [`- …and ${bills.length - shown.length} more`] : [];
  return [`**Bills we're watching in ${name} right now:**`, ...shown, ...more].join("\n");
}
