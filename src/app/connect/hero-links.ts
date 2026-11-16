/**
 * The two buttons at the top of /connect. A visitor is offered "Join free"
 * first; a signed-in member never is, because tapping it sends them to the
 * sign-in page they already passed (PJ, 2026-11-11). Members lead with
 * "Find a group" instead.
 */
export type HeroLink = { href: string; label: string; primary: boolean };

export function connectHeroLinks(signedIn: boolean): HeroLink[] {
  if (signedIn) {
    return [
      { href: "/coalitions", label: "Find a group", primary: true },
      { href: "/coalitions/new", label: "Start a group", primary: false },
    ];
  }
  return [
    { href: "/signup", label: "Join free (1 minute)", primary: true },
    { href: "/coalitions", label: "Find a group", primary: false },
  ];
}
