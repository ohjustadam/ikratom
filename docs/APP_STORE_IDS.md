# App Store identifiers — canonical reference

There is **no real "mismatch" to fix** between `org.ikratom.twa` and
`org.ikratom.app`. Android and iOS use **separate, independent application-id
namespaces** — they do not need to match each other, and historically they
don't. This doc is the source of truth so nobody "reconciles" them into one
and accidentally breaks Android Digital Asset Link verification.

## Canonical IDs

| Platform | Identifier | Canonical value | Where it lives |
|---|---|---|---|
| **Android** (TWA / Google Play) | `applicationId` | **`org.ikratom.twa`** | `public/.well-known/assetlinks.json` → must match the Bubblewrap build's Package ID **exactly** |
| **Apple** (iOS / App Store) | Bundle ID | **`org.ikratom.app`** | PWABuilder iOS package config / App Store Connect |
| **Microsoft** (MSIX) | Package identity | (assigned by Partner Center) | PWABuilder MSIX |

## The one rule that actually matters

**Android Digital Asset Links verification fails unless these three are byte-identical:**

1. `public/.well-known/assetlinks.json` → `package_name` (`org.ikratom.twa`)
2. The Bubblewrap **Package ID** entered during `bubblewrap init`
3. The `applicationId` in the generated Android project

So when running the Bubblewrap build, enter Package ID **`org.ikratom.twa`**.
Do **not** change `assetlinks.json` to `org.ikratom.app` to "match iOS" — that
would break the TWA (the URL bar would reappear because the digital asset link
no longer verifies).

## iOS is unrelated

The iOS Bundle ID (`org.ikratom.app`) is a different namespace owned by Apple.
It can be anything reverse-DNS and unique to the developer account; matching the
Android id is neither required nor expected. Keep it `org.ikratom.app`.

## SHA-256 fingerprint (still TODO)

`assetlinks.json` currently has a placeholder `sha256_cert_fingerprints` value
(`REPLACE_WITH_SHA256_FROM_BUBBLEWRAP`). Bubblewrap prints the signing key's
SHA-256 during/after `bubblewrap build`; paste it in, commit, and verify at
`https://www.ikratom.org/.well-known/assetlinks.json`. Back up the signing key —
losing it means you can never update the Play listing under the same id.
