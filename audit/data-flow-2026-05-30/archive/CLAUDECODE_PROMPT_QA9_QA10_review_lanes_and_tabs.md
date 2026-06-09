# Claude Code prompt — QA#9 (review-lane "—" counts + dark detail badges) + QA#10 (tab overflow)

Paste into Claude Code, run from the **life-command-center** repo. (Your harness
picks the branch — fine; end with merge + deploy commands.)

---

## Context (verified live 2026-06-03 — don't re-investigate the symptoms)

### QA#9 — 4 of 6 Review Console lanes show "—", and two property-detail badges are dark
`/api/review-counts` returns `count: null` for **ownership_research,
merges_dupes, pending_updates, sos_owner_links**. Only the two lanes built on
LCC-Opps `opsCount(...)` (data_conflicts, intake_identity) work. Every lane
built on `domCount('gov'|'dia', …)` is null (`handleReviewCounts` in
`api/admin.js`).

There are **two independent causes** — confirm each in code, fix both:

1. **Allowlist 403s (client read path).** The frontend reads domain DBs through
   the allowlist proxy (`api/_shared/allowlist.js` → `GOV_READ_TABLES` /
   `DIA_READ_TABLES` Sets, mirrored in `supabase/functions/data-query/index.ts`).
   These gov views are **not allowlisted** and return
   `403 "Read access denied for table: …"`:
   - `ownership_research_queue`
   - `v_recorded_owner_link_review`
   - `v_recorded_owner_link_status`
   - `v_recorded_vs_assessor_owner_divergence`

   **Impact beyond the lanes:** the property-detail **ownership-divergence** and
   **SOS-link-status** badges call `gov-query` for the last two views and are
   silently 403'ing in prod (the features look dead). Add all four to
   `GOV_READ_TABLES` (non-PII, read-only views) **and** mirror the additions in
   the `data-query` edge function, then redeploy that edge function. Verify no
   PII columns are exposed by these views before allowlisting.

2. **`domainQuery` never returns a count (server count path).** `handleReviewCounts`'s
   `domCount` does `r.count || 0` but `domainQuery` (`api/_shared/domain-db.js`)
   returns only `{ ok, status, data }` — it never parses the `Content-Range`
   header, so `r.count` is always undefined. Even for tables that DO read
   (e.g. `pending_updates`, `llc_research_queue` return 200), the count is lost.
   Fix `domainQuery` to: send `Prefer: count=exact` (merge with existing
   `Prefer`, don't clobber `return=representation`) when a caller asks for a
   count, read `res.headers.get('content-range')`, parse the total after the
   `/`, and return it as `count`. Then confirm each `domCount` view actually
   returns 200 under the domain key used by `domainQuery` — if any return
   401/403 (RLS / not exposed to that role), expose/grant them or route that
   lane's count through the same proxy the client uses.

After both: all six review lanes should show real numbers (sanity targets from
the live DB — ownership/merges/pending in the hundreds–thousands, sos_owner_links
≈ the `v_recorded_owner_link_review` row count, ~9), and the property-detail
divergence + SOS-link badges should render instead of silently failing.

### QA#10 — detail tab bar clips the last tab
On a standard-width window the 6th tab ("Activity Log") is cut off at the detail
panel's right edge with a scroll arrow. In `styles.css`, let `.detail-tabs`
wrap or shrink to fit (e.g. `flex-wrap: wrap` or reduce per-tab padding /
`min-width`) so all six lifecycle tabs are reachable without horizontal scroll.
Keep the active-tab styling intact.

## Verify + ship
- `node --check api/admin.js api/_shared/domain-db.js`; redeploy the `data-query`
  edge function (allowlist mirror) and the Vercel/Railway app.
- Live check: `/api/review-counts` returns 6 non-null `count`s; the property
  detail's Ownership & CRM tab shows the divergence + link-status badges; the
  detail tab bar shows all six tabs without clipping.
- Function count unchanged. End with merge + deploy commands (note the edge
  function redeploy explicitly — it's separate from the Vercel deploy).
