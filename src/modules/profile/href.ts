/** The canonical, shareable profile URL: by handle when there is one. Pure, so client components can use it. */
export function profileHref(p: { id: string; username: string | null }): string {
  return p.username ? `/profile/@${p.username}` : `/profile/${p.id}`;
}
