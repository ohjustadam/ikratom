import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = { title: "Welcome to iKratom" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/onboarding");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, street, city, state, zip, is_shop_owner, shop_name, is_medical_professional, onboarded_at")
    .eq("id", user.id)
    .single();

  // If already onboarded, send them to dashboard
  if (profile?.onboarded_at) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <OnboardingWizard
        initialProfile={{
          full_name: profile?.full_name ?? "",
          street: profile?.street ?? "",
          city: profile?.city ?? "",
          state: profile?.state ?? "",
          zip: profile?.zip ?? "",
          is_shop_owner: profile?.is_shop_owner ?? false,
          shop_name: profile?.shop_name ?? "",
          is_medical_professional: profile?.is_medical_professional ?? false,
        }}
      />
    </div>
  );
}
