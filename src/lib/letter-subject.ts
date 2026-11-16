// An office that gets 100 letters under one subject reads them as one form blast
// (PJ, 2026-11-04). So each member gets a short subject of their own, the same
// one every time for a given campaign, and stays free to rewrite it.
//
// None of these takes a side or says where the sender lives. The letter does that.

const MAX_KEPT = 40;

// A real number like "SB 860". Local rows hold ids like "San-Buenaventura-Ord-2026".
const BILL_NUMBER = /^[A-Z]{1,4}\.?\s?\d{1,5}[A-Z]?$/i;

const GENERAL = [
  "About kratom",
  "A note on kratom",
  "My thoughts on kratom",
  "Thoughts on kratom",
  "Kratom policy",
  "Kratom laws",
  "Regarding kratom",
];

const forBill = (bill: string) => [
  bill,
  `About ${bill}`,
  `A note on ${bill}`,
  `My thoughts on ${bill}`,
  `Thoughts on ${bill}`,
  `Regarding ${bill}`,
  `Kratom and ${bill}`,
  `${bill} and kratom`,
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** `seed` is the member and the campaign. A campaign's own subject joins the rotation when it's short. */
export function memberSubject(input: {
  template: string;
  billNumber?: string | null;
  seed: string;
}): string {
  const bill = input.billNumber?.trim();
  const pool = bill && BILL_NUMBER.test(bill) ? forBill(bill) : GENERAL;
  const own = input.template.trim();
  const options = own && own.length <= MAX_KEPT ? [...pool, own] : pool;
  return options[hash(input.seed) % options.length];
}
