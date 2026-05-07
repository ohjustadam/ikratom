# Vendor accounts — design

**Status (2026-05-07):** Owner picked **Option A**. Implementation in PR #12.

---

## The problem

Some users represent kratom businesses (shops, brands, distributors). They want to take political action **as the business**, not as themselves. Examples:

- A shop owner emailing their state senator on company letterhead
- A national distributor coordinating multi-state action under their corporate name
- A medical professional speaking professionally vs personally

Legal note: in US political action, both *persons* and *businesses* are recognized senders. An email "from Sunshine Smoke Shop, Tulsa OK, opposing SB 123" is a legitimate distinct constituent voice from "from Adam Hull, Tulsa OK, opposing SB 123." We need to support both, **clearly attributed**, never blurred.

We also want to:
- Avoid "account jumping" (a user signs in on one account to represent themselves, signs out and into another to represent their business)
- Have a **verification step** before a user can claim business representation (so randos can't email senators "from Walmart")
- Recognize vendors as a distinct, valued user category
- Keep nonpartisan + free-tier discipline

---

## Three options modeled

### Option A — Single account, dual signature (chosen)

One account per human. Profile has an additional **business identity** with its own approved name + (optional) address. When sending a campaign action, user picks a "from" radio: "as Adam Hull" or "as Sunshine Smoke Shop." The mailto: template substitutes signature, salutation, and any business-specific opener accordingly.

**Schema (sketch):**
```sql
alter table profiles
  add column vendor_status text check (vendor_status in ('none','pending','approved','rejected')) default 'none',
  add column vendor_business_name text,
  add column vendor_business_role text,           -- "Owner", "Manager", "Director of Advocacy"
  add column vendor_business_city text,
  add column vendor_business_state text,
  add column vendor_application_at timestamptz,
  add column vendor_approved_at timestamptz,
  add column vendor_approved_by uuid references profiles(id),
  add column vendor_rejection_reason text;
```

**Pros:**
- One account, no jumping. Simplest data model.
- User pivots between hats per-action. UX matches Gmail's `from:` selector.
- Verification gates the business hat without gating the personal one — user can advocate as themselves immediately, business hat unlocks after approval.
- Audit trail: every action logs which hat was active.

**Cons:**
- Slightly more form complexity per send (the radio choice).
- One-business-per-user limit. If someone reps two distinct businesses (rare), they'd need two accounts. Acceptable v1.

**Effort:** ~3 hours.

### Option B — Linked accounts

Personal account is primary. User creates a sibling "business account" linked to it via FK. Logged-in session shows a pivot menu ("Acting as: Jane | Sunshine Shop"). Two distinct identities sharing one credential.

**Pros:**
- Cleanest separation. Each identity has its own profile, history, settings.
- Multi-business support trivial.

**Cons:**
- 2× the schema (linked profiles, dual sessions, dual notification prefs, dual MFA).
- "What identity am I currently?" UX hazard — easy to send the wrong attribution.
- Significantly more code: identity switcher, RLS pivots, audit cross-references.

**Effort:** ~8 hours. Real schema work.

### Option C — No vendor accounts

Vendors stay just the existing `is_shop_owner` profile flag for self-declaration. Only admins create partner records. No vendor-as-actor model.

**Pros:** simplest. No new code.

**Cons:** can't send "as the business" — every email is from the human. Misses the legitimate use case.

**Effort:** $0.

---

## Recommendation: A

Picked because:
- Solves the legal/UX clarity problem (every email is unambiguously attributed to person OR business — never blurred)
- One account = no account-jumping (the stated owner concern)
- One-business-per-user is a fine v1 limit; we have zero evidence anyone needs two
- Implementation is bounded (~3 hrs) — small enough to ship + iterate

## Verification flow (for Option A)

1. User clicks "Apply to be a verified vendor" on `/account` settings
2. Form: business name, business role (Owner / Manager / Advocacy Director), business city, business state, contact email, optional website
3. Submit → `vendor_status = 'pending'`, `vendor_application_at = now()`
4. Admin sees a queue at `/admin/vendor-applications` — list of pending applications with all details + "Approve" / "Reject (with reason)" buttons
5. On approve → `vendor_status = 'approved'`, business hat becomes selectable on campaign sends
6. On reject → `vendor_status = 'rejected'` with reason; user sees reason; can re-apply 30 days later
7. Audit log entries: `vendor.apply`, `vendor.approve`, `vendor.reject`

**Verification standard for v1:** light. Admin manually checks the business name is real (Google it, look it up on the state's business registry). For escalation we'd add docs upload + automated checks, but humans-first for v1.

## Campaign send UX (Option A)

Current send flow opens a `mailto:` link with body pre-filled. New flow:

```
[ ] As Adam Hull (you)
[•] As Sunshine Smoke Shop, Tulsa OK
    Owner — verified vendor ✓

To: senator@example.gov
Body: ...

Sincerely,
Sunshine Smoke Shop
Owner: Adam Hull
Tulsa, OK
```

The radio is hidden if `vendor_status != 'approved'` — only verified vendors see it. The body template has two variants (personal / business signature). Body content (the actual ask) is identical; only signature changes.

## Benefits to recognizing vendors at all

- **Trust signal**: a verified vendor badge on `/profile/[id]` and adjacent to forum posts. Other advocates know they're talking to a real business person.
- **Reach**: businesses can amplify campaigns to their customers via the partner kit + push (already shipped).
- **Future giveaway hosting** (owner mentioned): only verified vendors can sponsor giveaways. Trust gate.
- **Action attribution**: when a verified vendor takes action, we can publicly show "X businesses opposing this bill" on bill detail pages — extra political weight.

## Tradeoffs we accept with Option A

- Users can lie about their business representation. Verification is best-effort, not airtight.
- A verified vendor sending personally still has the badge on their profile — that's intentional (trust signal even when not on business hat).
- If a vendor becomes a former-vendor (sold the shop), they have to reapply. We don't auto-revoke. Admin can manually downgrade via `/admin/users`.

---

## Out of scope for v1

- Multi-business per user (defer until evidence)
- Document upload for verification (defer; manual is fine for v1 traffic)
- Vendor-only forum sections (overcomplicated)
- Vendor-only campaigns (overcomplicated; vendors join regular campaigns)
- Automated business registry lookup (defer; admin Googles for v1)

---

## Implementation checklist (PR #12 will track)

- [ ] Migration: add vendor_* columns to profiles
- [ ] Server actions: `applyForVendorStatus`, `approveVendorApplication`, `rejectVendorApplication`
- [ ] User-side UI: vendor application form on `/account/security` (or new `/account/vendor` page)
- [ ] Admin queue: `/admin/vendor-applications`
- [ ] Campaign send: radio between personal / business identity, conditionally rendered
- [ ] Forum + profile: vendor badge display
- [ ] Audit-log all vendor mutations
