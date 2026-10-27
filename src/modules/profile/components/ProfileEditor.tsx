"use client";

import { useState, useTransition } from "react";
import { saveProfileSocial } from "../actions";
import { BIO_MAX, STORY_MAX, type Audience, type SectionAudienceKey } from "../audience";
import { AudienceSelect } from "./AudienceSelect";
import { InterestPicker, LinksEditor, type LinkRow } from "./EditorFields";
import { PrivacyTable } from "./PrivacyTable";

export type EditorInitial = {
  bio: string;
  story: string;
  interests: string[];
  links: LinkRow[];
  audiences: Record<SectionAudienceKey, Audience>;
};

/** /account/profile — every editable section, each with its own audience. */
export function ProfileEditor({ initial, profileUrl }: { initial: EditorInitial; profileUrl: string }) {
  const [bio, setBio] = useState(initial.bio);
  const [story, setStory] = useState(initial.story);
  const [interests, setInterests] = useState(initial.interests);
  const [links, setLinks] = useState<LinkRow[]>(initial.links);
  const [aud, setAud] = useState(initial.audiences);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const setOne = (k: SectionAudienceKey) => (v: Audience) => setAud((a) => ({ ...a, [k]: v }));

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveProfileSocial({ bio, story, interests, links, audiences: aud });
      setMsg("error" in r ? { ok: false, text: r.error } : { ok: true, text: "Saved." });
    });
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-6">
      <Block title="Bio" aud={<AudienceSelect label="Bio" value={aud.bio_audience} onChange={setOne("bio_audience")} />}>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BIO_MAX} rows={3} placeholder="A sentence or two about you and why you advocate."
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
        <Count n={bio.length} max={BIO_MAX} />
      </Block>
      <Block title="Advocacy story" aud={<AudienceSelect label="Advocacy story" value={aud.story_audience} onChange={setOne("story_audience")} />}
        note="Shown on your profile. This is separate from the private story you gave for letter tailoring, which is never shown.">
        <textarea value={story} onChange={(e) => setStory(e.target.value)} maxLength={STORY_MAX} rows={6} placeholder="What kratom means to you, and what's at stake."
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
        <Count n={story.length} max={STORY_MAX} />
      </Block>
      <Block title="Interests" aud={<AudienceSelect label="Interests" value={aud.interests_audience} onChange={setOne("interests_audience")} />}>
        <InterestPicker value={interests} onChange={setInterests} />
      </Block>
      <Block title="Links" aud={<AudienceSelect label="Links" value={aud.links_audience} onChange={setOne("links_audience")} />}>
        <LinksEditor value={links} onChange={setLinks} />
      </Block>
      <div id="privacy" className="scroll-mt-24">
        <PrivacyTable value={aud} onChange={(k, v) => setOne(k)(v)} />
      </div>
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
        <button type="submit" disabled={pending} className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Saving…" : "Save profile"}
        </button>
        <a href={profileUrl} className="text-sm text-zinc-400 hover:text-emerald-400">View my profile →</a>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

function Block({ title, aud, note, children }: { title: string; aud: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aud}
      </div>
      {note && <p className="mb-2 text-xs text-zinc-500">{note}</p>}
      {children}
    </section>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return <p className="mt-1 text-right text-xs text-zinc-600">{n}/{max}</p>;
}
