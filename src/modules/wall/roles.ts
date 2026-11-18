import { publicRole, type PublicRole } from "@/lib/public-handle";

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> };

/**
 * Add each author's Leader / Admin tag to wall posts or comments, read from
 * get_public_profiles (never a direct profiles select). Authors whose handle
 * the wall RPC hid from this viewer get no tag either.
 */
export async function withAuthorRoles<T extends { author_id: string; author_username: string | null; author_role?: PublicRole | null }>(
  supabase: RpcClient,
  rows: T[],
): Promise<T[]> {
  const ids = [...new Set(rows.filter((r) => r.author_username).map((r) => r.author_id))];
  if (ids.length === 0) return rows;
  const { data } = await supabase.rpc("get_public_profiles", { p_ids: ids });
  const roles = new Map<string, PublicRole | null>();
  for (const p of (data ?? []) as { id: string; is_admin?: boolean | null; is_advocate_leader?: boolean | null }[]) {
    roles.set(p.id, publicRole(p));
  }
  return rows.map((r) => (r.author_username ? { ...r, author_role: roles.get(r.author_id) ?? null } : r));
}
