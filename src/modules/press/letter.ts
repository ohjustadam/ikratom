// The starting point for a reply to a reporter or researcher. The member writes
// the middle: a form letter is what these people delete, and some of these
// stories are about a family's loss.

export type PressKind = "reporter" | "researcher";

const SUBJECTS: Record<PressKind, string[]> = {
  reporter: ["Your kratom story", "About your story", "A note on your story", "Your recent story"],
  researcher: ["Your kratom paper", "About your paper", "A note on your paper", "Your recent paper"],
};

export function pressLetter(input: { kind: PressKind; name: string | null; title: string }) {
  const piece = input.kind === "reporter" ? "story" : "paper";
  const verb = input.kind === "reporter" ? "read your story" : "read your paper";
  const pool = SUBJECTS[input.kind];
  return {
    subject: pool[Math.floor(Math.random() * pool.length)],
    body: [
      input.name ? `Dear ${input.name},` : "Hello,",
      "",
      `I ${verb}, "${input.title}".`,
      "",
      `I follow kratom closely, and I wanted to share something that may be useful to you. {{my_story}}`,
      "",
      `Thank you for your work on this ${piece}, and for reading.`,
      "",
      "{{my_name}}",
    ].join("\n"),
  };
}
