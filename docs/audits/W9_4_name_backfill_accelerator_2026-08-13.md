# W9.4 accelerator — historical Outlook display-name BACKFILL (2026-08-13, Prompt 101)

**Status: SHIPPED + APPLIED LIVE.** The comms-harvest header-pair arm was
input-starved because Prompt 96 made display-name capture forward-only. This
backfill reconstructs `activity_events.metadata.from_name` / `to_names` on the
historical correspondence corpus, so `harvestBuildCommsIndex` sees thousands of
name↔email pairs **today** instead of waiting weeks for organic mail accrual.

## ⚠️ GROUNDING CORRECTION — the prompt's premise (email_bodies) was refuted live

Prompt 101 (and the Prompt-96 root-cause doc it quotes) asserted *"`email_bodies.from_name`
was already stored"* — so a join off `email_bodies` would light up the harvest.
**Live check (LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-13) refutes it:**

| Store | Rows | `from_name` populated |
|---|---|---|
| `email_bodies` | 23,071 | **0** |
| `activity_events` (outlook family, `from_name`) | 7,051 | **0** |

`email_bodies` has the `from_name` COLUMN but it is NULL in every row (the PA flow
that fills it never sent the Graph display name), and no structured historical
display name exists anywhere in the corpus. **There is no name to copy from
`email_bodies`.**

**The real, available structured name store is `unified_contacts`** (17,527 rows
carry `full_name` + `email`). This backfill therefore reconstructs each row's
display name by looking up the EMAILS ALREADY ON THE ROW
(`metadata.from_email` / `from` / `to_emails` / `cc_emails`) in `unified_contacts`
— the Prompt-93 reconstruction pattern. Provenance is stamped
`metadata.name_backfill = { source:'unified_contacts', … }` — honest about the
true source, not `email_bodies`.

## What ships

- **`api/_shared/outlook-name-backfill.js`** — pure, testable patch builder
  (`buildNameBackfillPatch` / `reverseNameBackfillPatch`). Fill-blanks (never
  overwrites an existing `from_name`/`to_names`), external+non-generic parties
  only (reuses `reachability-harvest-planner` gating), and the display name is
  round-tripped through the SAME `parseAddress` the forward loggers use
  (`outlook-recipients.js`) — **one code path, no fork**. Returns `null` when
  there is nothing to fill (idempotent).
- **Route `GET/POST /api/outlook-name-backfill`** (`api/admin.js`,
  `handleOutlookNameBackfill`; mounted in `server.js`). GET = dry-run report;
  POST = apply ONE cursored batch (id keyset, resumable via `after=next_cursor`
  until `done=true` — the 92-class walk-the-pool guard); `POST ?reverse=1&batch=<tag>`
  reverses a batch. Batched name resolve via the new RPC — **never per-row DB work**.
- **Migration `20260813120000_lcc_outlook_name_backfill_log.sql`** (applied live):
  append-only audit ledger `lcc_outlook_name_backfill_log` + RPC
  `lcc_names_for_emails(text[])` (case-insensitive, batched email→`full_name` over
  `unified_contacts`; PostgREST `in.()` is case-sensitive and `uc.email` is not
  reliably lowercased). REVERSAL RUNBOOK in the migration foot.

## Applied result (batch `nb_sql_20260813`, live)

The one-shot apply was run in SQL faithfully mirroring the handler's fill-blanks +
internal(`northmarq`/`stanjohnsonco`)/generic-inbox gating (the deployed route is
the durable mechanism and re-affirms/extends idempotently on the next Railway
deploy — same "SQL apply now, route re-affirms" pattern as gov §25).

| Metric | Before | After |
|---|---:|---:|
| `metadata.from_name` populated (outlook family + email_intake) | 0 | **2,357** |
| rows with `metadata.to_names` | ~27 (forward) | **2,438** (+2,411) |
| recipient name↔email pairs added | 0 | **3,768** |
| **simulated `header_name_pairs`** (from + to, external, non-generic) | **0** | **6,050** |

The harvest reads live `activity_events` (no deploy needed for the DATA), so
`GET /api/reachability-harvest-tick?score=1&n=10` now returns non-zero
`comms_counts.header_name_pairs` (the harvest applies its own business-attribution
gate `commsRowHarvestable`, so the realized number is a subset of the 6,050
simulated upper bound — but it is decisively non-zero, up from 0).

## Discipline

Additive · fill-blanks-only (existing names never clobbered) · external/non-generic
gated · provenance-marked · **reversible** (in-row `name_backfill` marker +
`lcc_outlook_name_backfill_log`; `?reverse=1&batch=nb_sql_20260813` or the SQL in
the migration foot) · idempotent (re-run fills 0; the marker/blank check short-circuits)
· cursored/resumable · never fabricates (no known name ⇒ no fill).

## Tests

`test/outlook-name-backfill.test.mjs` (13): join correctness, fill-blanks
(existing `from_name`/`to_names` untouched), parser reuse (one code path),
external/internal/generic gating, `to_names` reconstruction, reversal (strips only
what the batch filled), function-form lookup, idempotence. Full suite green
(`outlook-recipients` 15, `reachability-harvest-planner` 34, `operations-subroutes` 5).

## Flag gate (unchanged doctrine, now on REAL historical yield)

`W9_2_REACHABILITY_HARVEST` stays OFF until the operator reviews a live
`?score=1` sample. The difference from Prompt 96: the review sheet now has
thousands of header pairs to inspect **immediately**, not a weeks-long trickle.
Cowork flips the flag after the sampled review.
