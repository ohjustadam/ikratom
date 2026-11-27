/**
 * Every foreign key to a user needs an index.
 *
 * Deleting an account makes Postgres look up that user's rows in every table
 * that points at them. Without an index each lookup reads the whole table, and
 * on 2026-11-26 the delete passed Supabase Auth's 10 s limit (migration 0338).
 * The next table that links to a user would start the same slide unnoticed.
 *
 * A partial index counts only when its condition is "<column> IS NOT NULL",
 * because any other condition can't serve the lookup for every user.
 */
export const USER_LINKS_SQL = `
  select t.relname || '.' || a.attname as link,
         exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indisvalid
             and (i.indpred is null
                  or lower(pg_get_expr(i.indpred, i.indrelid)) = lower('(' || quote_ident(a.attname) || ' IS NOT NULL)'))
         ) as indexed
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and n.nspname = 'public'
    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  order by 1`;

/** An empty reading is a failed read: the site always has links to users. */
export function judgeUserLinks(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const missing = list.filter((r) => r.indexed !== true).map((r) => r.link);
  const readNothing = list.length === 0;
  return {
    total: list.length,
    missing,
    readNothing,
    ok: !readNothing && missing.length === 0,
    summary: readNothing
      ? "could not read the user links"
      : `${missing.length} of ${list.length} user links without an index`,
  };
}
