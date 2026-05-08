import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyEmailPresets } from "@/modules/email-presets/actions";
import { EmailPresetsPanel } from "./EmailPresetsPanel";

export const metadata = { title: "Email tone presets" };

export default async function EmailPresetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/email-presets");

  const presets = await listMyEmailPresets();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Email tone presets</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Save up to 5 tone templates. When you send a campaign action you&apos;ll
          be able to pick from these instead of retyping. Use{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300">{"{{full_name}}"}</code>,{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300">{"{{legislator_name}}"}</code>,{" "}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300">{"{{state}}"}</code> as placeholders.
        </p>
      </header>

      <EmailPresetsPanel initial={presets} />
    </div>
  );
}
