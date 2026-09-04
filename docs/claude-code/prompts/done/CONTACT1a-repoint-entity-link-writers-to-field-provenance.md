# CONTACT1a — repoint the LIVE `entities.email/phone` writers at `field_provenance`

**Repo: life-command-center.** Target **LCC Opps `xengecqvemvfknjvbvrq`**.

**Read first:** `docs/architecture/field-provenance-ladder.md` (§1 model, §2 instruments) →
`docs/claude-code/responses/done/CONTACT1-both-entities-ladders-govern-nothing.response.md` (the
diagnosis this prompt fixes) → `docs/claude-code/responses/done/PR5c-entities-*.response.md` (how
the ladder was originally wired, and onto what) → `api/_shared/entity-link.js` (`ensureEntityLink`
— **30+ live call sites**, grepped) → `api/_shared/field-priority-guard.js`
(`shouldWriteField`/`recordFieldWrites` — the two functions to call) →
`api/_shared/salesforce-sync.js::writeEntitySalesforceLink` and
`api/_handlers/sf-list-import.js` (the two writers CONTACT1 traced as live).

## The finding this prompt fixes

`bridge-handlers-salesforce.js::handleSalesforceContactUpsert` was instrumented with
`recordFieldWrites` under PR5c-entities-b and has **never run** — zero rows in `enrichment_jobs`
of that job type, ever. The real writers of `entities.email`/`entities.phone` are
`salesforce-sync.js::writeEntitySalesforceLink` (cron 165, ~195/336 mints in the last 30 days) and
`sf-list-import.js` → `ensureEntityLink` at entity creation (~10/day) — neither calls
`shouldWriteField`/`recordFieldWrites` anywhere. `field_provenance` for `entities.email/phone`
therefore holds 4 rows total and `email` has never been recorded once, even though real traffic
writes those columns daily.

## 1. Measure before choosing where to wire it — do not guess the insertion point

`ensureEntityLink` has **30+ live callers** across `api/`, `api/_handlers/`, and `api/_shared/`.
Wiring the ladder into every caller is wrong (P159a/normaliser-drift class — one behaviour, many
copies). The candidate insertion points, in order of preference, each with a measured cost/benefit:

1. **Inside `entity-link.js` itself**, at the actual `UPDATE`/`INSERT` statement(s) that set
   `email`/`phone` on `entities` — if there is a SINGLE choke point where every caller's
   email/phone write actually lands (read the function body; do not assume — a prior round found
   `ensureEntityLink` is NOT the only path, since `sf-list-import.js` and `salesforce-sync.js` both
   write independently). If this exists, wiring here covers every caller for free.
2. **Inside `salesforce-sync.js::writeEntitySalesforceLink`** and **`sf-list-import.js`'s create
   path** directly, if #1 does not resolve to one choke point — these are the two CONFIRMED live
   writers; wiring only them is a smaller, safer, still-materially-useful first cut.
3. Anything else — state why #1 and #2 don't cover it before proposing it.

**Census first, in the same style as CONTACT1's writer census (AST walk, not grep-and-assume):**
for each of the 30+ `ensureEntityLink` callers, does it ever pass a non-null `email`/`phone`? Most
won't (many calls are for organizations, properties, or entity resolution with no contact fields).
Narrow the real target set before deciding the insertion point.

## 2. Wire it — fill-blanks discipline, `record_only`, no enforce_mode change

- Call `shouldWriteField` before the write, `recordFieldWrites` after — same contract
  `bridge-handlers-salesforce.js` already used (read its dead call site as the reference shape,
  even though it never fired).
- **Leave `enforce_mode='record_only'` on all ten rungs.** This prompt is about making the ledger
  see real traffic, not about blocking writes yet (PR5c-enforce's numeric unblock condition — ~50
  rows spanning ≥2 sources — cannot be met until this ships, and must not be graded prematurely).
- **Do not enable `SF_CONTACT_WRITEBACK`.** Out of scope; a separate, doctrinally-guarded decision.
- Do not touch `metadata.field_sources` / `planContactFieldPromotion` in this prompt — PR10's
  retire-it recommendation is a separate change once this one proves the ladder actually receives
  traffic.

## 3. Guard

A behavioural test (not a source-shape grep — CONTACT1's own finding was that a shape-only check
would have missed the dead-code misattribution) that exercises the real write path(s) chosen in
step 1 with a stubbed Supabase client and asserts `field_provenance` receives a row for a
non-null email/phone write. Mutation-verify it.

## 4. Verify (state delta, named rows)

- `field_provenance` row count for `(target_table='entities', field_name IN ('email','phone'))`
  before vs. **7 days after this ships** (report both — the fix needs traffic to accumulate; a
  same-day count near 0 is expected and is not a failure of this prompt).
- Name which of the 30+ callers now flow through the ladder and which don't (if the choke-point
  in step 1 doesn't exist, name the residual gap explicitly rather than implying full coverage).
- Confirm zero regression: `npm test` full suite, same fail/skip count as before.
- Re-state PR5c-enforce's numeric unblock condition against the NEW row count/source count — say
  how many more days/writes are needed to reach it, or that it's already met.
- Update `docs/architecture/field-provenance-ladder.md` with the corrected writer census (the
  dead-code misattribution CONTACT1 found) and this fix, in the same PR (BUILD-TURN-PROTOCOL).
  Update `PLANNED-BACKLOG.md` (**CONTACT1a**, **PR5c-enforce**) and `STATUS.md` in the same change.

## What NOT to do

Do not flip any `enforce_mode`. Do not enable `SF_CONTACT_WRITEBACK`. Do not touch
`metadata.field_sources`/`planContactFieldPromotion`. Do not backfill `field_provenance` for past
writes. Do not wire every one of the 30+ `ensureEntityLink` callers individually if a single
choke point covers them.
