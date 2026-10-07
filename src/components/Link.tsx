"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, FocusEvent, MouseEvent, TouchEvent } from "react";

type Props = ComponentProps<typeof NextLink>;

/**
 * The site's Link: prefetches on INTENT (hover, touch, keyboard focus) instead
 * of whenever a link scrolls into view.
 *
 * WHY (2026-10-07). Next prefetches every visible link by default. Home has
 * ~99 links and /legislators ~209, so one scroll fired dozens of background
 * requests: the owner tripped Cloudflare's 25-per-10s flood rule while simply
 * browsing, and every prefetch of a dynamic page woke the paid server function
 * (Netlify compute is ~70% of the site's credit burn) and read the database.
 * Intent prefetch keeps clicks fast — a hover or touch starts the fetch ~100-300
 * ms before the click lands — without paying for links nobody clicks.
 *
 * Every component imports this instead of "next/link" (tests/link-prefetch.test.ts
 * enforces it). An explicit `prefetch` prop still wins.
 */
export default function Link({ href, prefetch, onMouseEnter, onTouchStart, onFocus, ...rest }: Props) {
  const router = useRouter();
  if (prefetch !== undefined && prefetch !== null) {
    return <NextLink href={href} prefetch={prefetch} onMouseEnter={onMouseEnter} onTouchStart={onTouchStart} onFocus={onFocus} {...rest} />;
  }
  const warm = () => {
    if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) router.prefetch(href);
  };
  return (
    <NextLink
      href={href}
      prefetch={false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => { warm(); onMouseEnter?.(e); }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => { warm(); onTouchStart?.(e); }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => { warm(); onFocus?.(e); }}
      {...rest}
    />
  );
}
