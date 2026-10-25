import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminContext } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { signedMemberPhotoUrl } from "@/lib/media-store";
import { publicHandle } from "@/lib/public-handle";
import { PhotoReportActions } from "./PhotoReportActions";

export const metadata = { title: "Reported photos" };
export const dynamic = "force-dynamic";

/**
 * /admin/moderation/photos — member photos that were reported. Three distinct
 * reporters hide a photo automatically (0286) until a moderator restores or
 * removes it here. Images are signed directly with the service role, so a
 * moderator sees hidden photos without widening any member-facing rule.
 */
export default async function ReportedPhotosPage() {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) redirect("/dashboard");

  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("member_photos")
    .select("id, owner_id, kind, r2_key, content_type, caption, audience, status, report_count, created_at")
    .or("report_count.gt.0,status.eq.hidden")
    .order("report_count", { ascending: false })
    .limit(60);
  const photos = (data ?? []) as {
    id: string; owner_id: string; kind: string; r2_key: string; content_type: string; caption: string | null;
    audience: string; status: string; report_count: number; created_at: string;
  }[];

  const ids = photos.map((p) => p.id);
  const owners = [...new Set(photos.map((p) => p.owner_id))];
  const [{ data: reports }, { data: profiles }] = await Promise.all([
    ids.length ? svc.from("member_photo_reports").select("photo_id, reason, note").in("photo_id", ids) : Promise.resolve({ data: [] }),
    owners.length ? svc.from("profiles").select("id, username, state").in("id", owners) : Promise.resolve({ data: [] }),
  ]);
  const byPhoto = new Map<string, { reason: string; note: string | null }[]>();
  for (const r of (reports ?? []) as { photo_id: string; reason: string; note: string | null }[]) {
    byPhoto.set(r.photo_id, [...(byPhoto.get(r.photo_id) ?? []), r]);
  }
  const who = new Map(((profiles ?? []) as { id: string; username: string | null; state: string | null }[]).map((p) => [p.id, p]));
  const urls = await Promise.all(photos.map((p) => signedMemberPhotoUrl(p.r2_key, p.content_type).catch(() => null)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/moderation" className="text-xs text-zinc-500 hover:text-emerald-400">← Moderation</Link>
      <h1 className="mt-2 text-3xl font-bold">Reported photos</h1>
      <p className="mt-2 text-sm text-zinc-400">Three reports from different members hide a photo until you decide. Restore clears the reports; Remove deletes the photo.</p>
      {photos.length === 0 && <p className="mt-6 rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4 text-sm text-emerald-300">✓ No reported photos.</p>}
      <ul className="mt-6 space-y-4">
        {photos.map((p, i) => (
          <li key={p.id} className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:flex-row">
            {urls[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed private R2 URL
              <img src={urls[i]!} alt="" className="h-40 w-40 shrink-0 rounded-md object-cover" />
            ) : <div className="h-40 w-40 shrink-0 rounded-md bg-zinc-900" />}
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p>
                <a href={`/profile/${p.owner_id}`} className="font-semibold text-emerald-400 hover:underline">{publicHandle(who.get(p.owner_id))}</a>
                <span className="ml-2 text-xs text-zinc-500">{p.kind} · {p.audience} · {p.status} · {p.report_count} report{p.report_count === 1 ? "" : "s"}</span>
              </p>
              {p.caption && <p className="text-zinc-300">“{p.caption}”</p>}
              <ul className="space-y-0.5 text-xs text-zinc-400">
                {(byPhoto.get(p.id) ?? []).map((r, j) => <li key={j}>• {r.reason.replace("_", " ")}{r.note ? `: ${r.note}` : ""}</li>)}
              </ul>
              <PhotoReportActions photoId={p.id} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
