# Claude Code — UI Phase 4C: sub-record drill (L4) + source access (L5) + zoom polish

## Why (roadmap Phase 4C — the last zoom slice; DOMAIN_PAGES_REDESIGN_PART3_ZOOM_NAV §E/§F)
4A (back-stack + breadcrumb) and 4B (entity/owner detail parity) are live. The zoom model's
high-value parts are done. 4C closes the model's bottom levels — but it's the **lowest-ROI slice**,
so it's scoped to the genuinely-useful parts and explicitly DEFERS the speculative ones:
- **What's missing & worth doing:** the property-detail tab rows (Deal History sales, Rent Roll
  leases, Ownership deeds, documents) are **static** — you can't open the actual underlying
  **source document** (the deed/lease/listing PDF or the SF record), even though the data already
  carries `source_url` / `listing_url` / `intake_artifact_path` / deed source. Operators genuinely
  want "show me the actual deed/lease." That's the real L5 win.
- **What's already done (reuse, don't rebuild):** sub-records that are L2 objects already drill via
  4A/4B — a contact/person row → `openEntityDetail` (pushes), a related property → `openUnifiedDetail`
  (pushes). Don't re-implement those.
- **What's deferred (low ROI):** a full standalone detail "page" for every sub-record type, and a
  "next-action on every sub-record" — the property + owner already carry the completeness-rail +
  Next-Step (4B); per-lease/per-sale next-actions are marginal. Skip unless trivial.

Client-side (`detail.js` + `ops.js`/`gov.js` where the same tabs render); reuse the 4A stack +
slide-over; **no api/*.js, no migration**; reversible.

## Unit 1 — source-document access (L5) — the real win, lowest build
Add a uniform **"View source ↗"** affordance on sub-record rows that carry a source, opening the
actual document / record:
- **Listings** (`source_url` / `listing_url` / `url` / `intake_artifact_path` — the resolution
  already exists at `detail.js:2173-2222`): open the listing/OM source.
- **Sales** (Deal History): the deed / OM / source doc behind the sale where present
  (`property_documents` for the property, deed source, or the sale's `source_url`/`intake_artifact`).
- **Leases** (Rent Roll): the lease document via `property_documents` (doctype lease) where present.
- **Deeds / documents** (Ownership & CRM / docs): open the deed PDF / `property_documents.source_url`.
- Behavior: open in a new tab for an external PDF/CDN/SharePoint URL, or the SF deep-link for an SF
  record. Only render the affordance when a real source exists (no dead "View source" on rows with
  none). Keep it `stopPropagation` so it doesn't trigger a row-level drill (Unit 2).
- Source URLs are the app's own captured artifacts (CoStar CDN, SharePoint, SF) — fine to open on
  the user's click; don't fabricate URLs, only surface ones already on the record.

## Unit 2 — drill the two richest sub-records (lease, sale) onto the 4A stack
For the sub-records worth a focused view, make the row a zoom target that PUSHES on the 4A stack
(breadcrumb grows, "← Back" ascends to the property):
- **A Rent Roll lease row** → a lease sub-detail (full terms, escalations/bumps, guarantor,
  expiration, + the Unit-1 source link). Note: a lease sub-view scaffold already exists
  (`switchLeaseSubView` details/rentroll, `detail.js:3743/3789`) — reuse/extend it rather than
  build anew; just make it a stack-pushed level reachable from a lease row.
- **A Deal History sale row** → a sale sub-detail (parties [R59 buyer/seller], price, cap rate +
  its provenance/`cap_rate_quality`, date, + the Unit-1 source link).
- Both ride the SAME 4A descriptor/stack pattern (add a sub-record descriptor kind, e.g.
  `sub:lease:<id>` / `sub:sale:<id>`, parseable like the prop/entity tokens so Back/breadcrumb +
  the hash work). Keep it best-effort on reload (the top descriptor only, like 4A).
- Contacts + related-properties already drill (4B) — leave them.

## Unit 3 — zoom polish (cheap, completes the model)
- **Keyboard:** Enter = zoom into the focused row (open its detail/drill), Esc = zoom out one level
  (`detailBack()`), consistent with the research cards' existing shortcuts. Scope to when the detail
  panel is open/focused so it doesn't hijack normal typing.
- **iOS / touch back-gesture:** confirm the OS back-gesture pops one stack level (it rides the 4A
  `history` integration already — just verify it ascends rather than exits, since the capture
  workflow is iOS).

## Boundaries / verify
- Client only (`detail.js` + `ops.js`/`gov.js` as needed); reuse the 4A stack + slide-over + the
  existing lease sub-view; **no api/*.js (stays 12), no migration**; reversible.
- Don't regress 4A/4B: property↔owner↔property hops, breadcrumb, Back-ascends, entity detail.
- `node --check`; suite green.
- Live walk: a sale/lease/deed/listing row shows "View source ↗" only when a source exists and
  opens the real doc/record; a lease row and a sale row drill into a sub-detail that PUSHES
  (breadcrumb grows, "← Back" returns to the property); Enter/Esc zoom in/out; the iOS back-gesture
  ascends one level.

## Documentation
Update `life-command-center/CLAUDE.md` zoom note: 4C adds sub-record drill (lease/sale) + source-doc
access (L5) on the 4A stack + keyboard/gesture; per-sub-record next-actions + full standalone
sub-record pages deferred as low-ROI. Mark the zoom model (4A–4C) complete.

## Bottom line
Give operators one-click access to the actual deed/lease/listing document (the real L5 win), let a
lease or sale row zoom into a focused sub-detail on the 4A stack, and add Enter/Esc + iOS-gesture
polish — reusing 4A/4B and the existing lease sub-view, deferring the speculative per-sub-record
detail pages. This completes the zoom-in/zoom-out model end to end.
