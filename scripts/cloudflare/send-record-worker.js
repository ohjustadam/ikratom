// Cloudflare Email Worker: the send record (B9, migration 0276).
//
// Receives the hidden copy (BCC) a member's own mail program sends to
// r-<nonce>@ikratom.org and hands it to public.ingest_send_record(), which
// keeps it only if the nonce matches a campaign click. It is bound to the
// zone's catch-all rule, so it also sees every other unrouted address. Those are
// dropped silently, exactly what the catch-all did before ("drop").
//
// Deployed by scripts/deploy-send-record-worker.mjs. Bindings:
//   SUPABASE_URL, SUPABASE_ANON_KEY (plain text), INGEST_KEY (secret).

import { bytesToBinary, decodeWords, parseMessage } from "./mime-text.mjs";

const MAX_BYTES = 1_000_000;
const ADDRESS_RE = /^r-([a-z2-7]{16})@ikratom\.org$/;

const worker = {
  async email(message, env) {
    const match = ADDRESS_RE.exec(String(message.to || "").trim().toLowerCase());
    if (!match) return; // not a send-record address: dropped, as before
    if (message.rawSize > MAX_BYTES) {
      console.log("send-record: skipped oversized copy", message.rawSize);
      return;
    }

    const raw = bytesToBinary(await new Response(message.raw).arrayBuffer());
    const { text } = parseMessage(raw);
    const payload = {
      p_key: env.INGEST_KEY,
      p_nonce: match[1],
      // The header From is the member; message.from is the envelope sender,
      // which for many providers is a bounce address.
      p_from: decodeWords(message.headers.get("from") || "") || String(message.from || ""),
      p_to: decodeWords(message.headers.get("to") || ""),
      p_subject: decodeWords(message.headers.get("subject") || ""),
      p_body: text,
      p_message_id: message.headers.get("message-id") || null,
    };

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_send_record`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const out = await res.text();
    console.log("send-record:", res.status, out.slice(0, 200));
  },
};

export default worker;
