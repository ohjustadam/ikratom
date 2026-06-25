import Link from "next/link";
import { siteConfig } from "@/config/site.config";
import { AuthForm } from "@/modules/auth/components/AuthForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-md px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Welcome to {siteConfig.name}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in or create an account to start taking action.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Free, always.{" "}
            <Link href="/membership" className="text-emerald-400 hover:underline">
              See what each account level includes →
            </Link>
          </p>
        </div>
        <AuthForm redirectTo={redirect} />
      </div>
    </div>
  );
}
