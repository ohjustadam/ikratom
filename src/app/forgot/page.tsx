import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-md px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Enter your email. We&apos;ll send you a link to set a new password.
          </p>
        </div>
        <ForgotForm />
        <p className="mt-6 text-center text-xs text-zinc-500">
          <a href="/login" className="hover:text-emerald-400">← Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
