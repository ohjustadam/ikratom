import { groupPostLengthNote } from "@/modules/coalitions/limits";

/** "8,412 / 10,000 characters" under a group post box once it gets long. */
export function PostLengthNote({ length }: { length: number }) {
  const note = groupPostLengthNote(length);
  if (!note) return null;
  return (
    <p aria-live="polite" className={`text-xs ${note.over ? "text-red-300" : "text-zinc-500"}`}>
      {note.text}
    </p>
  );
}
