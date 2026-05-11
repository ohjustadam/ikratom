"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfileCharacter } from "@/modules/auth/actions-character";
import { VideoUploader } from "@/modules/auth/components/VideoUploader";

const ADVOCATE_TYPES: { id: string; label: string; hint: string }[] = [
  { id: "consumer", label: "Consumer", hint: "Daily user — most advocates fall here" },
  { id: "shop_owner", label: "Shop owner", hint: "You sell kratom and want it kept legal" },
  { id: "medical_pro", label: "Medical professional", hint: "Doctor, nurse, harm-reduction worker" },
  { id: "family", label: "Family member", hint: "Loved one of someone kratom helps" },
  { id: "veteran", label: "Veteran", hint: "VA users have outsized voice on the Hill" },
  { id: "researcher", label: "Researcher", hint: "Academic / industry research" },
  { id: "leader", label: "Advocacy leader", hint: "Org work, hearings, organized outreach" },
  { id: "other", label: "Other", hint: "Doesn't fit above" },
];

export function CharacterForm({
  initial,
  uploadEnabled,
}: {
  initial: {
    kratom_story: string;
    kratom_years: number | null;
    advocate_type: string;
    lose_if_banned: string;
    video_url: string;
    video_provider: string | null;
    profile_visibility: string;
  };
  uploadEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [story, setStory] = useState(initial.kratom_story);
  const [stake, setStake] = useState(initial.lose_if_banned);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateProfileCharacter(fd);
      if ("error" in r && r.error) {
        setError(r.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      {/* Advocate type */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">What kind of advocate are you?</label>
        <p className="mt-1 text-xs text-zinc-500">
          Drives the default tone of your campaign emails. Veterans + medical pros get extra
          narrative weight on legislator letters.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {ADVOCATE_TYPES.map((t) => (
            <label
              key={t.id}
              className="cursor-pointer rounded-md border border-zinc-800 p-3 text-sm transition has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-950/20 hover:border-zinc-700"
            >
              <input
                type="radio"
                name="advocate_type"
                value={t.id}
                defaultChecked={initial.advocate_type === t.id}
                className="sr-only"
              />
              <div className="font-semibold text-zinc-200">{t.label}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{t.hint}</div>
            </label>
          ))}
        </div>
      </div>

      {/* Years using */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">How long have you been using kratom?</label>
        <p className="mt-1 text-xs text-zinc-500">
          Years. Used in legislator emails (&ldquo;An 11-year kratom user from Toledo&rdquo;).
        </p>
        <input
          type="number"
          name="kratom_years"
          min={0}
          max={80}
          defaultValue={initial.kratom_years ?? ""}
          placeholder="—"
          className="mt-2 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Kratom story */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">Your kratom story <span className="text-emerald-400">(private)</span></label>
        <p className="mt-1 text-xs text-zinc-500">
          Why kratom? How did you find it? What changed? Write it like you&apos;d tell a friend.
          AI tailoring uses this as your authentic-voice source — your campaign emails will read
          like you wrote them, not like a template.
        </p>
        <textarea
          name="kratom_story"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          maxLength={10_000}
          rows={8}
          placeholder="Take your time. Specifics land harder than generalities."
          className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-zinc-500">{story.length}/10,000</p>
      </div>

      {/* Lose if banned */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">What would you lose if it&apos;s banned? <span className="text-emerald-400">(private)</span></label>
        <p className="mt-1 text-xs text-zinc-500">
          One sentence. Devastatingly effective when surfaced in legislator emails.
        </p>
        <textarea
          name="lose_if_banned"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder='e.g. "I would go back to opioids within a month — and I&apos;d be one more statistic Big Pharma uses to sell more pills."'
          className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-zinc-500">{stake.length}/500</p>
      </div>

      {/* Video advocacy clip */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">Video advocacy clip <span className="text-zinc-500">(optional)</span></label>
        <p className="mt-1 text-xs text-zinc-500">
          A personal advocacy clip surfaced on your public profile and (later) included inline
          with your story when reaching out to media or hearings.
          {uploadEnabled
            ? " Upload an MP4/MOV/WebM (≤ 100 MB) or paste a YouTube / Vimeo URL."
            : " Paste a YouTube (Unlisted is fine) or Vimeo URL."}
        </p>
        <VideoUploader
          initialUrl={initial.video_url}
          initialProvider={initial.video_provider}
          uploadEnabled={uploadEnabled}
        />
      </div>

      {/* Visibility */}
      <div>
        <label className="block text-sm font-medium text-zinc-200">Profile visibility</label>
        <p className="mt-1 text-xs text-zinc-500">
          Who can see your public profile (username + first name + state + advocate type)?
          Sensitive fields above are <strong>always private</strong> regardless of this setting.
        </p>
        <select
          name="profile_visibility"
          defaultValue={initial.profile_visibility}
          className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
        >
          <option value="public">Public — visible to anyone</option>
          <option value="recruiters_only">Recruiters only — only your leader sees you</option>
          <option value="private">Private — invisible to other users</option>
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>
      )}
      {saved && !error && (
        <p className="rounded-md border border-emerald-700/50 bg-emerald-950/20 p-3 text-sm text-emerald-300">
          ✓ Saved. Your future campaign emails will use this.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save character"}
      </button>
    </form>
  );
}
