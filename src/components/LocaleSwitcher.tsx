"use client";

import { useTransition } from "react";
import { setLocale } from "@/modules/auth/actions-locale";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/messages";

export function LocaleSwitcher({ current }: { current: Locale }) {
  const [, startTransition] = useTransition();

  function pick(lang: Locale) {
    startTransition(async () => {
      await setLocale(lang);
      window.location.reload();
    });
  }

  return (
    <select
      value={current}
      onChange={(e) => pick(e.target.value as Locale)}
      className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
      aria-label="Choose language"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>{LOCALE_LABEL[l]}</option>
      ))}
    </select>
  );
}
