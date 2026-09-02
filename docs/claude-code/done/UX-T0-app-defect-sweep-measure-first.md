# UX-T0 — the app defect sweep from Scott's 2026-09-02 walk-through: measure first, fix the source, never the pixel

> **Scope: the 18 DEFECT rows + 2 REMOVE rows of `docs/architecture/app-ux-review-2026-09-02.md`
> §1.** Every item below names a MECHANISM HYPOTHESIS drawn from a footgun this repo already
> documents — treat each as a claim to test, not a diagnosis. **No redesign in this prompt** (that is
> UX-T1/T2, and it is blocked on C4a). Correct data on the surface the operator already has.

**Read first:** `app-ux-review-2026-09-02.md` §0 (the doctrine — it decides what a "fix" is) and
§1 · `CLAUDE.md` → *Known footguns* (in particular: `diaQuery` returns `[]` on ANY non-OK response;
a round-number count means a tile is reading a paged query; Overview tiles must read ONE canonical
view; the P116 user-id-space collision; `security_invoker` views returning `[]` to anon; the
`data-query` edge ALLOWLIST 403 → `[]`) · `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 11 (a
zero is often the instrument).

## 0. The rules for every item

1. **Read the response, never the tile.** For any "0 / empty / unavailable": capture the HTTP
   status and body of the request the surface actually makes (`diaQuery`/`govQuery` swallow
   non-OK into `[]` — pass `throwOnError` or read the network). A 403 from the edge allowlist, a
   statement timeout, and an empty view are the same pixels.
2. **Positive-control every zero** before recording it as a data fact.
3. **Read named rows.** "Numbers don't reconcile" is settled by three named rows, not a rate.
4. **Fix the SOURCE** (the view a tile reads, the writer, the query), then the surface reads it.
   If the fix is "the surface computed its own number", repoint it at the canonical view — never
   add a second computation.
5. **One PR per item is fine; one measurement per item is mandatory.** Report the before/after
   state delta for each, and say plainly which items turned out NOT to be defects.

## 1. The items

| id | symptom (Scott) | hypothesis to test first | done means |
|---|---|---|---|
| **UX1** | Home *Work Your Outreach* → "Outreach list unavailable / Retry" | `renderOutreachOnramp` (`app.js:~7407`) — read the response of the endpoint it calls. Candidates: auth (a 401 rendered as unavailable), the P118 correlated-subplan timeout on the worklist view, or a view returning `[]` to anon (`security_invoker`). | tile renders the value-ranked cadence list; the failing status is named in the writeup |
| **UX10** | Overview on-market ≠ Deals ▸ Sales ▸ Availables | dia canonical is `v_dia_on_market` (`dialysis.js:1057`); find which surface computes its own predicate (status filter, `off_market_date`, recency) instead of reading membership. gov: `v_gov_on_market`. | both surfaces read ONE view; counts equal on a dated screenshot |
| **UX11** | Verification feed shows "no update" on every row | `listing_verification_history.asking_price_at_check` / `price_delta` are NULL on 5,636/5,637 (the lvh writer records `prior_asking_price` only). If the feed derives "update" from those columns it is structurally blank. Fix the WRITER (record observed ask + delta), then the feed. | a real reprice renders as an update; the writer's next rows carry `asking_price_at_check` |
| **UX12** | SJC deal-book Salesforce buttons empty; Fresenius Woodland Hills lacks the Team Briggs flag | Two facts: the Northmarq/Team-Briggs flag on the sale (`sales_transactions` — Prompt 50 propagated the sale as id 14832; check the flag column and its trigger) and the SF deal-book link (what column, what writer). | Woodland Hills shows the flag; the buttons populate or their absence is named |
| **UX13** | Kelly's touchpoints stale; touchpoints not domain-scoped | P116: `resolveSourceUserId` — is Kelly's `lcc_users` id mapping to `public.users`? Count her `activity_events` by day vs Scott's. Domain scoping = C19; do the measurement here, the filter only if it is one predicate. | her events resume or the rejected-write cause is named |
| **UX20** | Deals opens on Pipeline, slow; clicking another sub-tab snaps back mid-load | an async render re-asserting the default sub-tab on completion (the `_rendered` once-flag class). Find the late `navTo`/`switchUnifiedTab` call in the Pipeline loader. | sub-tab clicks stick during load |
| **UX22** | Sales comps: blank fields | measure which columns are blank on the top 50 rows of `rpc_query_comps` and whether the value exists upstream (Prompt 55 fixed chairs/patients for 217 sales the same way). | per-field blank counts before/after; fills are from canonical sources only |
| **UX23** | Property → true owner: Contacts block "messed up", conflicting data across the record | pick the record from the screenshot (Scott can name it); check `v_lcc_portfolio_ownership_conflict` (P175a) and the panel's `reachable_via` vs `subject.email` merge (P161). Read every field's source. | the named record is coherent; the conflict class is recorded |
| **UX26** | Ownership tab "covering 500 properties" | `dialysis.js:5110` `limit: 500` rendered as a count — the round-number footgun. Count must come from `count=exact` or a summary view; the list pages. | the count is the population; the list pages |
| **UX27** | Players: numbers don't reconcile internally | three named rows: which two views/fields feed the two disagreeing tiles. | one source per fact |
| **UX28** | Buyers: duplicates | read survivors only (`merged_into_entity_id IS NULL`, P175) and group on `canonical_name` (N15c); 6,608 duplicate groups are known and human-confirm — the surface must not show both halves. | no tombstone on the list |
| **UX29** | Sellers: **0 in dataset / $0** | `dialysis.js:~11119` pulls `sales_transactions` wholesale via `diaQueryAll` — read the response: edge allowlist 403, the 1,000-row cap, or an 8 s statement timeout. Also check `security_invoker` if it reads a view. | the real status is named; sellers render from a bounded summary view, not a table pull |
| **UX30** | Brokers: data issue, no firm/individual split, much missing | **do NOT build here** — BR1–BR5 own it (`broker_name` is a composite; the firm registry is 56% composites). Measure only: how many rows the tab shows vs `sales_transactions.listing_broker_id` non-null (1,027 after BR2). | a one-line measurement + pointer to BR3 |
| **UX31** | Inventory tile building size looks too large | unit (I12: acres vs sq ft, 43,560×) or RBA-vs-leased. Read 5 named tiles against `properties.building_size` / `sf_leased`. | the tile states which figure it shows; leased SF added if one predicate |
| **UX34** | Reference ▸ CMS data tab broken | read the failing request. | tab renders or the failing view/allowlist entry is fixed |
| **UX37** | CM charts missing/partial vs export | **K13–K18** already name five; measure which chart on the screenshot maps to which K row, fix nothing new here. | mapping recorded on K13–K18 |
| **UX48** | Metrics tab shows wrong aliases as team members | roster query: `users` vs `lcc_users` id-space (P116) and the 98 stale `@stanjohnsonco.com` Outlook primaries (`pickBestEmail`). | roster = the real team; aliases collapse to persons |
| **UX14b** | CMS runs still killed mid-flight (dia) | ⚠️ **operator item, not this prompt** — `B6d-cms-restart` needs Railway logs. Measure only that `medicare_clinics.source_last_seen` is still 2026-06-25-class stale and say so. | a dated number in the writeup |
| **UX39** | National ST tab: remove | grep routes/views/tests that reference it; delete; guard that nothing else imported it. | tab gone, suite green |
| **UX41** | All Other (288): fold into Prospects | inventory its routes/queries; list any function Prospects lacks BEFORE removing; remove only if the list is empty, else file the gap. | tab gone or a named list of what would be lost |

## 2. Do not

- Do not re-rank, re-label or re-design any queue or dashboard — UX-T1/T2 own that and they are
  gated on C4a and UX0.
- Do not add a second computation of any count; repoint at the canonical view.
- Do not touch broker storage (BR-owned) or CMS ingestion (B6d-owned).
- Do not read a `0`, a `[]`, or "unavailable" as a data fact without the response status.

## 3. Report back

- A table: item · what the measurement showed · defect / not a defect / owned elsewhere · fix · the
  before/after delta.
- Screenshots are Scott's; you report the state delta. Each fixed item cites the PR and the UX id.
- Anything that turns out to be a doctrine question (a card that should not exist) goes to
  UX-T1 by id — do not "fix" it here by hiding it.
