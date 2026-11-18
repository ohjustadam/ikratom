import type { PublicRole } from "@/lib/public-handle";

/**
 * The small Leader / Admin tag beside an @username. One component for every
 * surface (forum, Lounge, groups, walls, profiles, member lists), fed by
 * publicRole() in src/lib/public-handle.ts. No "use client": it renders the
 * same from server and client components. What each role means is on /roles.
 */
const STYLE: Record<PublicRole, { label: string; title: string; cls: string }> = {
  admin: {
    label: "Admin",
    title: "Admin: helps run iKratom and moderates",
    cls: "border-emerald-600/60 bg-emerald-950/50 text-emerald-300",
  },
  leader: {
    label: "Leader",
    title: "Advocate Leader: writes campaigns and helps moderate",
    cls: "border-sky-600/60 bg-sky-950/50 text-sky-300",
  },
};

export function RoleTag({ role, className = "" }: { role: PublicRole | null | undefined; className?: string }) {
  if (!role) return null;
  const s = STYLE[role];
  return (
    <span
      title={s.title}
      className={`ml-1 inline-flex shrink-0 items-center rounded border px-1 py-px align-middle text-[9px] font-bold uppercase leading-none tracking-wider ${s.cls} ${className}`}
    >
      {s.label}
    </span>
  );
}
