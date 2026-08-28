"use client";

import { useState } from "react";
import { GroupComposeModal } from "./GroupComposeModal";
import type { ComposeGroup } from "./types";

import Link from "next/link";
const GROUP_ICON: Record<ComposeGroup["key"], string> = {
  representatives: "🏛",
  senators: "🏛",
  executives: "🖊",
  my_delegation: "🏛",
};

/**
 * Bill-level "email your officials" action. Renders one button per resolved
 * group (all Representatives / all Senators / the executive trio for a state
 * bill; the user's delegation for a federal bill). Each opens the group
 * composer. This is the direct-action counterpart to campaigns — the advocate
 * picks who to email about a bill without a campaign existing.
 */
export function EmailGroupButton({
  groups,
  billId,
  stance,
  needsProfile,
  scope,
}: {
  groups: ComposeGroup[];
  billId: string;
  stance?: "oppose" | "support" | "improve" | "neutral" | null;
  needsProfile: boolean;
  scope: "state" | "federal";
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (needsProfile) {
    return (
      <p className="text-sm text-zinc-400">
        This is a federal bill.{" "}
        <a href="/account" className="text-emerald-400 hover:underline">Add your address</a>{" "}
        and we&apos;ll match your U.S. Representative + Senators so you can email your delegation in one click.
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        We don&apos;t have contactable {scope === "federal" ? "delegation" : "officials"} on file for this bill yet.{" "}
        <Link href="/legislators" className="text-emerald-400 hover:underline">Browse officials →</Link>
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const count = g.emailable.length + g.formOnly.length;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setOpenKey(g.key)}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
            >
              {GROUP_ICON[g.key]} {g.label}
              <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">{count}</span>
            </button>
          );
        })}
      </div>
      {groups.map((g) =>
        openKey === g.key ? (
          <GroupComposeModal
            key={g.key}
            open
            onClose={() => setOpenKey(null)}
            group={g}
            billId={billId}
            stance={stance}
            source={`bill_group_${g.key}`}
          />
        ) : null,
      )}
    </>
  );
}
