"use client";

import { NotificationFlyout } from "./NotificationFlyout";

/**
 * Server component — fetches the unread count once at render, then
 * hands it off to the client-side flyout which manages open/close +
 * lazy-loads the list on bell click.
 *
 * Replaces the previous behavior where clicking the bell navigated
 * away to /notifications. Per owner spec (Facebook-style overlay):
 * users should never lose their work tab to read a notification.
 */
export function HeaderBell({ count = 0 }: { count?: number }) {
  return <NotificationFlyout initialUnreadCount={count} />;
}
