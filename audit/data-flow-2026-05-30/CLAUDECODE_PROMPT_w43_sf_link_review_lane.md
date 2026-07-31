# CLAUDE CODE PROMPT — W4.3 follow-up: SF-link candidate review lane

> **Unit:** W4.3 realization / W3.4-family Decision Center lane (LCC Audit Rollout Plan)
> **Written:** 2026-07-31 (Cowork session 33) — every fact below verified live that day.
> **Goal:** Surface the 3,452 `needs_review` SF-link candidates produced by the W4.3
> splink batch in the Decision Center, with one-click verdicts that (a) apply or
> decline the Salesforce link via the EXISTING attach semantics and (b) write an
> `entity_match_labels` row per verdict — the hard-negative training data the W4.4
> retrain needs. No new architecture: this is one more sub-lane in the existing
> owner_reconcile / comp_review pattern.

---

## Ground truth (verified 2026-07-31)

**The backlog.** `sf_link_research_queue` rows with `status='needs_review'`:
gov (scknotsqkcheojiaewwh) **3,064**, dia (zqzrriwuavgrquhisnoa) **388**. Each row
already carries the machine's best candidate: `sf_account_id_resolved`,
`sf_account_name_resolved`, `score_resolved` (probability from the W4.3 run —
uniform ~0.851 for the review band; band semantics in ROLLOUT_STATUS W4.3 row).

**The read view.** Both domain DBs have `v_sf_link_review_queue`:
`queue_id, source_table, source_id, owner_name, canonical_name, state,
property_count, priority_score, sf_account_id_resolved, sf_account_name_resolved,
score_resolved, resolved_at, last_attempted_at` — ordered `priority_score DESC`
(impact-first). Use it as the lane's source; do NOT re-derive ordering.

**The 18 conflict rows (dia only).** `last_error LIKE 'w4_3_conflict_existing_sf_company_id_%'`
— the source `true_owners` row already had a DIFFERENT `sf_company_id`, so the W4.3
batch refused to overwrite. The existing id is embedded in the `last_error` suffix.
These need a THREE-way card (keep existing / switch to candidate / research), and a
"conflict" badge. All other rows are two-way + research.

**Attach semantics (mirror `handleSfLinkTick`, api/admin.js ~8148–8188 — do not
reinvent):**
- gov `true_owners` → `{ sf_account_id, sf_last_synced: now }`
- gov `recorded_owners` → `{ sf_account_id, sf_last_synced: now }`
- dia `true_owners` → `{ sf_company_id }` (no sync stamp; dia recorded_owners has
  no SF column — but note ALL dia queue rows are source_table='true_owners')
- Null-guard on approve: only write if the SF column is currently null OR already
  equals the candidate (then it's an idempotent no-op success). If it holds a
  DIFFERENT id (a conflict that appeared after W4.3), do not write — return the
  conflict to the UI so the card re-renders as the three-way variant.

**Provenance (both domain DBs have `provenance_event_log`):** insert one row per
applied link. CHECK constraints require `target_database='gov_db'` (gov) /
`'dia_db'` (dia). `old_value`/`new_value` are **jsonb** — wrap with `to_jsonb()`
or JSON-encode in JS. Use `source='sf_link_review_human'` (distinct from the
batch's `splink_v1`), `confidence=score_resolved`, `field_name`
`'sf_account_id'`/`'sf_company_id'`, `record_pk_value=source_id`,
`metadata={"batch":"w4_3_review","queue_id":...}`.

**Queue disposition per verdict:**
- **Link** → `status='linked'`, keep the resolved fields, `last_error=null`,
  `resolved_at=now`, `updated_at=now`.
- **Not a match** → `status='no_match'`, `last_error='human_rejected_w4_3'`,
  `resolved_at=now`.
- **Keep existing** (conflict card only) → `status='linked'`,
  `sf_account_id_resolved` = the EXISTING id parsed from last_error,
  `sf_account_name_resolved=null`, `last_error='human_kept_existing_w4_3'` (no
  source write — it already holds that id; still write the label row: the
  candidate pair verdict is `distinct`).
- **Research** → leave `needs_review`; create a research task via the existing
  `createResearchTask` path (mirror the owner_reconcile research branch,
  admin.js ~2249).

**Label writer (already exists):** `writeEntityMatchLabel(row)` — api/admin.js
~1023, idempotent upsert on `subject_ref`. Write one row per Link / Not-a-match /
Keep-existing verdict:
```
seeder: 'sf_link_review', source_domain: 'gov'|'dia',
owner_a: owner_name, owner_b: sf_account_name_resolved,
verdict: 'same_party' (Link) | <the lane's existing negative verdict value> (see
  ownerReconcileLabelVerdict, admin.js — reuse its exact verdict vocabulary so
  W4.4's corpus reader sees one consistent enum),
raw_verdict: 'approve'|'reject'|'keep_existing',
match_score: score_resolved,
subject_ref: 'sf_link:'+domain+':'+queue_id,
evidence_json: { batch:'w4_3_splink_v1_2026_07_31', probability: score_resolved,
                 source_table, sf_account_id: sf_account_id_resolved,
                 conflict_existing_id: <or null> }
```
This is THE point of the lane — every verdict is retraining fuel. Do not make
label-writing optional or best-effort; a verdict that fails to write its label
should surface an error, not silently proceed.

**UI wiring (ops.js):**
- Add to `SUBLANES` (~line 1853):
  `{ dt: 'sf_link_candidate', label: 'Salesforce link — confirm candidate', open: "renderFederatedLane('sf_link_candidate')" }`
- Follow the **live source-backlog read** pattern (comp_review / sos_owner_links
  lanes), NOT a 3,452-row `lcc_decisions` mint. Add the count to
  `/api/review-counts` (admin.js `handleReviewCounts`, ~line 235) so the lane
  badge is live: sum of both domains' `v_sf_link_review_queue` counts.
- Card: owner_name (+ state, property_count, source_table badge) vs
  sf_account_name_resolved, probability, conflict badge where applicable.
  Buttons: Link / Not a match / Research (+ Keep existing on conflict cards).
  Keyboard-fast: the review population is homogeneous (all ~0.851); Scott may do
  hundreds in a sitting. NO bulk-approve — per-row eyes are the point.
- Record one `lcc_decisions` row per VERDICT (not per queue row) via the existing
  `record()` pattern in the verdict handler, decision_type `'sf_link_candidate'`,
  for don't-re-ask + audit — mirroring how owner_reconcile verdicts are recorded.

**Server endpoint:** extend the existing decision-verdict handler (admin.js) with
`decision_type==='sf_link_candidate'` handling, taking
`{ domain, queue_id, verdict, ... }`. Use `domainQuery(dom, ...)` (already maps
dia→dialysis / gov→government creds) for all domain reads/writes.

## Non-negotiables

1. **Never overwrite a non-null different SF id from this lane's Link button** —
   that path must render the conflict card instead.
2. Label vocabulary must match the existing `entity_match_labels` enum exactly
   (the 50 W3.2 rows use `verdict='same_party'`, `raw_verdict='approve'`).
3. All writes idempotent; verdict endpoint safe to retry.
4. Tests: verdict handler unit tests (link happy path, null-guard conflict path,
   reject, keep-existing, label-write failure surfaces error) + the lane count in
   review-counts. Suite must stay green.
5. Update docs/audits/ROLLOUT_STATUS.md (W4.3 row: review lane SHIPPED + session
   log entry) and note in the W4.4 unit that entity_match_labels now accrues
   sf_link_review seeder rows.

## Verification (post-merge, live)

1. Decision Center shows "Salesforce link — confirm candidate" with count ~3,452.
2. Approve one gov row → domain true_owners/recorded_owners sf_account_id set,
   provenance_event_log row source='sf_link_review_human', queue row linked,
   entity_match_labels row seeder='sf_link_review' verdict='same_party'.
3. Reject one row → queue no_match + label row with the negative verdict.
4. One of the 18 dia conflict rows renders the three-way card; Keep-existing
   writes the label and does NOT touch true_owners.
