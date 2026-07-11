import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Cert = { cert_code: string; username: string | null; course_title: string; score_pct: number; passed_at: string };

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Certificate ${code} — iKratom Academy` };
}

export default async function CertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const sb = await createClient();
  const { data } = await sb.rpc("academy_get_certificate", { p_code: code });
  const cert = (data ?? null) as Cert | null;
  if (!cert) notFound();

  const who = cert.username ? `@${cert.username}` : "An iKratom advocate";
  const when = new Date(cert.passed_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8 text-zinc-100">
      <div className="rounded-2xl border-2 border-emerald-700/50 bg-gradient-to-br from-emerald-950/30 to-zinc-950/50 p-8 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">🎓 iKratom Academy</p>
        <p className="mt-6 text-sm text-zinc-400">This certifies that</p>
        <p className="mt-1 text-3xl font-bold text-emerald-200">{who}</p>
        <p className="mt-4 text-sm text-zinc-400">completed and passed</p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">{cert.course_title}</p>
        <p className="mt-4 inline-flex items-center gap-3 rounded-full border border-emerald-700/40 bg-emerald-950/30 px-4 py-1.5 text-sm text-emerald-200">
          <span>Score {cert.score_pct}%</span><span className="text-zinc-600">·</span><span>{when}</span>
        </p>
        <p className="mt-6 font-mono text-[11px] text-zinc-500">Certificate {cert.cert_code}</p>
      </div>
      <div className="mt-6 text-center text-sm">
        <Link href="/academy" className="text-emerald-400 hover:underline">Take the course yourself →</Link>
      </div>
    </div>
  );
}
