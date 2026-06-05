# Claude Code prompt — R4-D: post-verification residue (9 small fixes, one pass)

Paste into Claude Code, run from the **life-command-center** repo. These are
the finds from the live verification of R4-A/B/C (all three verified passing
2026-06-05 — this is the residue, not rework). All evidence from the
production console/pages; don't re-investigate the symptoms, just root-cause
and fix.

---

## 1. Data-proxy allowlist gaps (recurring 403s on every detail load)
- `diaQuery deed_records: HTTP 403 "Read access denied for table: deed_records"`
  (dialysis.js ~:161 — fires on every dia detail open; Deal History needs it)
- `govQuery sf_activities: HTTP 403` (gov.js ~:121)
Add both to the data-proxy read allowlist (wherever the table allow-list
lives — likely api/_shared or the proxy handler). Audit the frontend for any
OTHER tables queried but not allowlisted (grep diaQuery/govQuery table names
vs the list) and fix the full set in one pass.

## 2. gov v_sales_comps statement timeout (500, recurring)
`govQuery v_sales_comps: HTTP 500 57014 statement timeout`. Diagnose on the
gov DB (`scknotsqkcheojiaewwh`): EXPLAIN the view with the frontend's actual
filter/order/limit, add the missing index or materialize the hot subset
(or push the query to an RPC with tighter predicates). The dialysis page also
computes cap-rate quartiles client-side over "loaded comps" and now shows
"— (0 loaded comps)" (gov TTM section) — once the view is fast, also move the
quartile/avg cap stats into the R4-B aggregate (mv_gov_overview_stats or a
small RPC) so they stop depending on client-loaded slices. Same for
"NM Performance 0 of 0 TTM deals" disagreeing with TTM tiles (1,172) — both
should read the same server aggregate.

## 3. gov LLC-queue widget gets SPA HTML
`gov llc queue load failed SyntaxError: Unexpected token '<' "<!DOCTYPE"` (gov.js
~:4393). The fetch hits a route that falls through to the SPA catch-all on
Railway — the E2E#1 class. Find the URL it calls, mount/alias it in server.js
(+ vercel.json if needed), and grep for any other frontend fetch hitting an
unmounted path (the JSON-vs-HTML check: any `.json()` caller without a
content-type guard).

## 4. Stale JS cache-busting (deploys don't reach browsers)
App bundles load as `dialysis.js?v=2026050802` etc. — the `?v=` is hardcoded
(May 8). Users keep running weeks-old frontends after every Railway deploy
until a hard refresh (likely a contributor to the 6/03 stale-exports day).
Fix the class: derive the version from the build/deploy (commit SHA or build
timestamp injected at server start — server.js can stamp index.html when
serving it) so every deploy busts caches automatically. Verify post-deploy
that the served index.html carries a fresh v= and the old one isn't cached
(check Cache-Control on index.html itself — it must be no-cache/short).

## 5. NBA top-10 duplicates + magnitude resurfacer
Today's Next Best Action list shows the same item multiple times (#6/#7/#9
all open gov 3198/3063-class item; #8/#10 same) — dedupe by (domain, item id)
before ranking. Also a dia row surfaced "$950M" ("Back-link sale to
recorded_owner: ARG FM16PCK001 LLC — $950M") — the magnitude-flag class from
QA#1: confirm whether that sale value is flagged in the DB and why the NBA
ranker still displays/ranks on it; route implausible values through the same
plausibility guard used elsewhere.

## 6. Gov action item uses the old expiration predicate
Page-top action item: "7,589 leases expiring within 6 months" — its predicate
counts everything with lease_expiration < now()+6mo INCLUDING long-expired
rows, contradicting the fixed Lease Expiration Risk section on the same page
(<6mo = 407). Re-use the R4-B bucketing (expiration BETWEEN now() AND
now()+6mo) and let the expired/holdover cohort live in its own (already
existing) bucket.

## 7. sales-comp xref disagreements: console → review lane
`[sales-comp xref] price disagreement sale_id=514 st=$8,415,000 oh=$7,140,000`
(+6 more) spams the console on every dia load. These are real data conflicts
(sales_transactions vs ownership_history price). Stop the per-load console
spam; surface them once as rows in the existing data-conflicts review lane
(or v_data_quality_issues) so they get resolved instead of ignored.

## 8. §5 skeleton sweep (carried from R4-C scope notes)
Extend the `_phase2Loaded` skeleton pattern to the remaining lazy gov/dia
overview sections that still render literal 0/"—" before data resolves
(e.g. CONTACTS 0→10,520, GSA Lease Intelligence, Ownership Coverage, TTM
tiles). Mechanical application of the existing pattern.

## Verify + ship
- Console clean on dia detail open + gov overview load (no 403/500/HTML-parse
  errors, no xref spam).
- gov LLC-queue widget renders data; v_sales_comps query returns < 5s.
- index.html serves a deploy-derived `?v=` and changes across two deploys.
- NBA top-10 has 10 distinct items; no implausible-magnitude rows ranked.
- Gov action item count ≈ the section's <6mo bucket.
- `node --check`; `ls api/*.js | wc -l` = 12; migrations idempotent +
  ordering noted (index/matview changes are DB-only, safe anytime).
