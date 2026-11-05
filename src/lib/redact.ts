/**
 * Redaction for anything that leaves the owner's eyes (0310): admin screens,
 * and GitHub issues, which land in a PUBLIC repo. Members' emails and IP
 * addresses are the owner's alone.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g;
const IPV6 = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi;

/** "jane.doe@gmail.com" → "j•••@gmail.com" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at < 1 ? "•••" : `${email[0]}•••${email.slice(at)}`;
}

/** "203.0.113.42" → "203.0.x.x"; IPv6 keeps its first two groups. Enough to see a
 *  flood come from one network, not enough to locate a person. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\./.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  const groups = ip.split(":");
  return groups.length > 2 ? `${groups[0]}:${groups[1]}::x` : "x";
}

/** Scrub emails and IPs out of free text (error messages, member descriptions). */
export function redactPii(text: string | null | undefined): string {
  return (text ?? "")
    .replace(EMAIL, "[email]")
    .replace(IPV4, (_, a, b) => `${a}.${b}.x.x`)
    .replace(IPV6, "[ip]");
}
