import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Set new password" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // The /auth/callback already exchanged the code for a session — if there's
  // no session here, the link expired or was tampered with.
  if (!user) redirect("/forgot?expired=1");

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-md px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Set a new password</h1>
          <p className="mt-2 text-sm text-zinc-400">
            For <span className="font-mono text-zinc-200">{user.email}</span>
          </p>
        </div>
        <ResetForm />
      </div>
    </div>
  );
}
