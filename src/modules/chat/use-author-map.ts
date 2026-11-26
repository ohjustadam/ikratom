"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publicHandle, publicRole, type PublicRole } from "@/lib/public-handle";

export type AuthorInfo = { name: string; username: string | null; isAdmin: boolean; role: PublicRole | null };

type PublicRow = {
  id: string;
  username: string | null;
  state: string | null;
  is_admin: boolean | null;
  is_advocate_leader?: boolean | null;
};

/**
 * Author ids → public handles through the SECURITY DEFINER get_public_profiles
 * RPC, the only RLS-safe way to read other members' public fields. Names are
 * only ever rendered through publicHandle() (@username). Each id is asked for
 * once per page view.
 */
export function useAuthorMap() {
  const [authorMap, setAuthorMap] = useState<Record<string, AuthorInfo>>({});
  const known = useRef<Set<string>>(new Set());

  const resolveAuthors = useCallback(async (ids: (string | null | undefined)[]) => {
    const want = [...new Set(ids.filter((id): id is string => !!id && !known.current.has(id)))];
    if (!want.length) return;
    want.forEach((id) => known.current.add(id));
    const { data } = await createClient().rpc("get_public_profiles", { p_ids: want });
    if (!data) {
      want.forEach((id) => known.current.delete(id));
      return;
    }
    setAuthorMap((cur) => {
      const next = { ...cur };
      for (const row of data as PublicRow[]) {
        next[row.id] = { name: publicHandle(row), username: row.username, isAdmin: !!row.is_admin, role: publicRole(row) };
      }
      return next;
    });
  }, []);

  return { authorMap, resolveAuthors };
}
