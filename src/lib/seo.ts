/**
 * Search-engine identity for iKratom. Findings and the owner's checklist live in
 * docs/SEO_BRAND.md.
 *
 * WHY (2026-11-17): Google indexes ikratom.org and ranks it first for a verbatim
 * search, but rewrites the query "ikratom" to "kratom". The home page carried no
 * structured data, so nothing told Google that "iKratom" is a site with its own
 * name rather than a typo. WebSite + Organization markup on the home page is the
 * documented way to state that name, its alternate spellings and the logo.
 */
import type { Metadata } from "next";
import { siteConfig } from "@/config/site.config";

/**
 * Pages that exist for one signed-in person, or that are thin by nature
 * (sign-in, account, inbox, internal search results). Kept out of search
 * results so the index holds the pages that carry the brand.
 */
export const NOINDEX: Metadata["robots"] = { index: false, follow: true };

const SITE = siteConfig.url;

/** WebSite + Organization JSON-LD for the home page only (Google reads site names there). */
export function siteJsonLd() {
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    name: siteConfig.name,
    alternateName: [...siteConfig.alternateNames],
    url: `${SITE}/`,
    description: siteConfig.description,
    inLanguage: "en-US",
    publisher: { "@id": `${SITE}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: siteConfig.name,
    alternateName: [...siteConfig.alternateNames],
    url: `${SITE}/`,
    logo: { "@type": "ImageObject", url: `${SITE}${siteConfig.logoPath}`, width: 512, height: 512 },
    description: siteConfig.description,
    slogan: siteConfig.tagline,
    email: siteConfig.links.support,
    sameAs: [...siteConfig.sameAs],
  };
  return [website, organization] as const;
}
