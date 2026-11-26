import { parseChatFormat } from "@/lib/chat-format";
import { MentionText } from "./MentionText";

/**
 * A Lounge message with **bold**, *italic* and @mentions. Built from React
 * elements only, never raw HTML, so a message can't inject
 * markup however it is written.
 */
export function FormattedText({ body, me }: { body: string; me: string | null }) {
  return (
    <>
      {parseChatFormat(body).map((seg, i) => {
        const inner = <MentionText body={seg.text} me={me} />;
        if (seg.bold && seg.italic) return <strong key={i}><em>{inner}</em></strong>;
        if (seg.bold) return <strong key={i}>{inner}</strong>;
        if (seg.italic) return <em key={i}>{inner}</em>;
        return <span key={i}>{inner}</span>;
      })}
    </>
  );
}
