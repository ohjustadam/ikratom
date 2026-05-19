import { getContent } from "@/lib/editable-content";

/**
 * Sitewide announcement bar. Pulls from editable_content key
 * 'global.announcement' so admins can toggle it on/off from
 * /admin/content/global.announcement on any device.
 *
 * Soft announcement — for routine news (new feature, upcoming
 * meeting, link to a brief). For real emergencies, use the
 * /admin/emergency banner instead (different visual + audit trail).
 *
 * Empty value = hidden. Set the row to empty content (or delete
 * the row) to hide.
 */
export async function GlobalAnnouncement() {
  // Fallback is intentionally empty so the bar is hidden by default
  // when no admin has set anything.
  const text = await getContent("global.announcement", "");
  if (!text || !text.trim()) return null;

  return (
    <div className="border-b border-emerald-700/30 bg-emerald-950/30 px-4 py-2 text-center text-[11px] text-emerald-200">
      {text}
    </div>
  );
}
