import { getEmergencyConfig } from "@/modules/admin/emergency-actions";

/**
 * Site-wide emergency banner — server component, runs on every page render.
 * Renders nothing when emergency_mode is off.
 */
export async function EmergencyBanner() {
  const config = await getEmergencyConfig();
  if (!config.emergencyMode || !config.title) return null;

  const severity = config.severity;
  const cls =
    severity === "critical"
      ? "border-red-500 bg-red-950/40 text-red-100"
      : severity === "urgent"
        ? "border-amber-500 bg-amber-950/40 text-amber-100"
        : "border-blue-500 bg-blue-950/40 text-blue-100";
  const labelCls =
    severity === "critical"
      ? "text-red-300"
      : severity === "urgent"
        ? "text-amber-300"
        : "text-blue-300";

  return (
    <div
      role="alert"
      className={`border-b-2 ${cls}`}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${labelCls}`}>
            {severity === "critical" ? "🚨 Critical" : severity === "urgent" ? "⚠ Urgent" : "ℹ Heads up"}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-tight sm:text-base">
            {config.title}
          </p>
          {config.body && (
            <p className="mt-0.5 text-xs sm:text-sm">{config.body}</p>
          )}
        </div>
        {config.ctaLabel && config.ctaHref && (
          <a
            href={config.ctaHref}
            className="shrink-0 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-900"
          >
            {config.ctaLabel} →
          </a>
        )}
      </div>
    </div>
  );
}
