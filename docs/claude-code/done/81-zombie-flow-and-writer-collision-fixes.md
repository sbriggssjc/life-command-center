# Prompt 81 — Ops cleanup: zombie-flow logging + dedup/FK/ON-CONFLICT writer fixes

Grounded live against LCC Opps (`xengecqvemvfknjvbvrq`), dia (`zqzrriwuavgrquhisnoa`),
gov (`scknotsqkcheojiaewwh`) on 2026-08-08 via `v_lcc_w8_u4_flow_failure_clusters` /
`v_lcc_w8_u4_ingest_failure_clusters` and the underlying `flow_run_failures` /
`ingest_write_failures` tables.

Proof of the after-state is **September's U4 report**: the flow clusters below drop to 0
immediately (view fix, live), and each ingest signature's `cnt_30d` decays to ~0 over 30 days
as the fixed writers stop emitting new rows.

---

## Item 1 — `Unflag Completed Email Tasks` (524) + `To Do - Life Command Center Sync` (131): NOT zombies, stale-surface bug

**Diagnosis (grounded):** both flows' `flow_run_failures` rows are **100% resolved**
(`resolved_at IS NOT NULL`), auto-closed by the existing dead-letter sweep
(`lcc_autoresolve_recovered_flow_failures`, "flow quiet 18h"). Last failure for BOTH was
**2026-07-29** — no failures in the 10 days since. `STATUS.md` confirms both are **retired /
Off**, consolidated into **LCCToDoCompletionPoll** (30-min recurrence). So they are **not live
zombies** — the flow stopped erroring on/around 2026-07-29.

**The actual defect:** `v_lcc_w8_u4_flow_failure_clusters` counted EVERY `flow_run_failures`
row regardless of `resolved_at`, so a retired flow's already-resolved history kept ranking as
the #1/#2 cluster on the U4 surface. Fixed the view to count only OPEN failures
(`WHERE resolved_at IS NULL`). Migration
`supabase/migrations/20260808130000_lcc_prompt81_flow_cluster_resolved_filter.sql`, **applied
live**. Post-fix the view returns **0 rows** (all current flow failures are resolved); a
genuinely-broken flow re-surfaces the moment it fails again (the auto-resolver only closes on
18h quiet). Output columns unchanged → `api/admin.js` reader unaffected.

**For Scott — confirm the flows are truly Off in Power Automate (do NOT let me guess-modify a
flow):**
1. Open <https://make.powerautomate.com> → **My flows**.
2. Find **`Unflag Completed Email Tasks`** and **`To Do - Life Command Center Sync`**.
3. For each, confirm the status toggle reads **Off**. If either still reads **On**, click the
   `…` menu → **Turn off** (they were superseded by `LCCToDoCompletionPoll`, which is healthy).
4. (Optional) `…` → **Delete** once you're satisfied `LCCToDoCompletionPoll` covers the
   unflag/sync behavior — it does (STATUS.md §"Retired flows").

No PA change is required for the surface to clear — the view fix already removed the noise —
but confirming Off prevents a silent turn-back-on from re-polluting later.

---

## Item 2 & 5 — 23505 dedup collisions (dia 1,863 + gov 382) fold into the dedup path (R37)

Root seam: `api/_shared/domain-db.js::domainQuery` auto-logs every non-2xx domain write to
`ingest_write_failures`. Added `opts.suppressFailureCodes` so a writer that **handles** an
expected collision no longer records it as a failure. New helper `domainPropertyExists`
(item 3). Then, per colliding writer:

- **`contacts` email/phone/name (dia `contacts_email_idx` 1,180 · `contacts_phone_idx` 87 ·
  `true_owners_name_key`/`recorded_owners_name_key`) + the labeled sidebar 409s
  (`upsertSidebarContacts:entityUpdate` 217 / `:personUpdate` 121 = item 5):**
  `email`/`phone` are GLOBALLY unique, so the sidebar's deliberate "insert a fresh person when
  name-affinity rejects a firm-pool-email match" was **guaranteed to 23505** — the row was
  simply lost. New `insertContactOrReuse` folds the collision into the existing row (resolve by
  the exact colliding key parsed from the PG error, fill-blanks-patch NON-unique descriptive
  columns only, so the recovery write can never re-collide). `patchContactSafe` retries a
  colliding PATCH without the unique columns. Both suppress the handled 23505. Wired at all 4
  contact INSERT + 4 PATCH sites in `sidebar-pipeline.js`. Reuse does not inflate `count` and
  records no fabricated name/email provenance.

- **`property_documents` `uix_prop_doc` / `property_documents_property_file_unique`
  `(property_id, file_name)` (dia 413 + gov 238):** the three plain-INSERT fallbacks
  (`property-doc-writeback.js`, `intake-promoter.js::attachEnrichDocument`,
  `sidebar-pipeline.js::upsertDocumentLinks`) now upsert on `on_conflict=property_id,file_name`
  + `resolution=merge-duplicates` (+ suppress) instead of a bare INSERT.

- **`recorded_owners` / `true_owners` name & canonical keys (dia 270 · gov 109):** the 23505
  recovery blocks refetched by the *normalized/canonical* column that already missed. Now they
  refetch by the **exact colliding CONSTRAINT key** parsed from the Postgres error
  (`Key (col)=(val)`), with the prior normalized lookup as fallback; the two fresh-insert paths
  that had NO recovery (gov `createFreshTrueOwner`, dia `ensureTrueOwner`) now fold on 23505.
  All suppress the handled collision. Composite-key value parsing guards a single-column value
  that itself contains `", "` (e.g. `Brandon Square, LLC`).

## Item 3 — 23503 FK (dia 494) `property_documents_property_id_fkey`

The base-shape doc write (`[property_id, file_name, document_type, source_url,
ingestion_status]`) aborted when the bridged/raw `property_id` had no live `properties` row
(234 logical writes × 2 attempts). Added `domainPropertyExists(domain, propertyId)` (proceed on
an unknown/transient read; skip cleanly on a confirmed-missing parent) and gated
`insertLccDocument`, `attachEnrichDocument`, and the `promoteIntakeToDomainListing` inline
listing-doc insert on it — a dangling parent now returns `skipped: 'missing_property'` instead
of a 23503 abort.

## Item 4 — gov 42P10 (243) ON CONFLICT inference mismatch

The agent's initial `lease_ti_amortization` guess was **wrong** (its live index is already the
plain-column form). The real offenders, grounded from `ingest_write_failures.path`:

- **`available_listings?on_conflict=property_id,listing_source,listing_status,listing_date`
  (gov, 223):** the matching unique index
  `available_listings_property_source_status_date_uniq` is **PARTIAL** (`WHERE` all four cols
  `IS NOT NULL`). PostgREST cannot infer a partial index from a bare `on_conflict` list → 42P10
  on **every** new-listing INSERT (0 rows written — real data loss, not just noise). The writer
  already pre-checks for an active row and PATCHes it, so the INSERT path is only reached when
  there is no conflict; replaced the upsert with a **plain INSERT + a 23505 race fallback** that
  re-converges on the active row.
- **`property_documents?on_conflict=property_id,content_hash` (gov 20 + dia 17):** there is **no**
  `(property_id, content_hash)` unique index — only `(property_id, file_name)`. Corrected the
  `on_conflict` list to the real index in `intake-document-notify.js`.

---

## Files
- `supabase/migrations/20260808130000_lcc_prompt81_flow_cluster_resolved_filter.sql` (applied live)
- `api/_shared/domain-db.js` — `suppressFailureCodes`, `domainPropertyExists`
- `api/_handlers/sidebar-pipeline.js` — contacts dedup helpers + owner fold + gov listing insert
- `api/_handlers/intake-promoter.js`, `api/_handlers/property-doc-writeback.js`,
  `api/_handlers/intake-document-notify.js` — property_documents on_conflict + FK guard
- `test/prompt81-writer-collision-fixes.test.mjs` (12 tests)

## Deploy
DB migration is live now. JS ships on the next Railway redeploy of merged `main`
(`npm run verify:deploy` after). No dia/gov migration needed — all writer fixes are LCC-side.
