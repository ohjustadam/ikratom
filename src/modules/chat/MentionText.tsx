import { splitMentions } from "@/lib/mentions";

/** A chat message body with its @mentions highlighted (yours brighter). */
export function MentionText({ body, me }: { body: string; me: string | null }) {
  return (
    <>
      {splitMentions(body).map((p, i) =>
        p.mention ? (
          <span
            key={i}
            className={p.mention === me ? "rounded bg-emerald-500/20 px-0.5 font-semibold text-emerald-200" : "font-semibold text-emerald-300"}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
