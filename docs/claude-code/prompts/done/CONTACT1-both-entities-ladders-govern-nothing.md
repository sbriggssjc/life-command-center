# CONTACT1 — `entities.email`/`phone` have TWO authority ladders and neither has governed anything; find out why before grading either

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. **Diagnosis first.**
This subsumes backlog **PR5c-enforce** and **PR10** — both were queued as "grade the ladder / decide
which ladder owns the decision", and both are **unanswerable today** because there is nothing to
grade. Do not flip an `enforce_mode` in this prompt.

**Read first:** `docs/architecture/field-provenance-ladder.md` (§1 model, §2 instruments, §3 live
state) → backlog **PR5c-enforce**, **PR10**, **PR5c-entities**, **PR5c-entities-b** →
`docs/audits/PR5c_entities_LADDER_WIRED_2026-09-02.md` §2 (why wiring a ladder onto an empty ledger
buys recording, not protection) → `api/_handlers/contact-writeback.js` (its header comments already
describe the two-ladder situation) and `api/_shared/contact-fields.js::planContactFieldPromotion`.

## What is measured, live, 2026-09-03 — verify each in one query

**Ladder A — `field_provenance` via `lcc_merge_field`.** 10 rungs on `entities.email`/`phone`
(`manual_edit`/`manual_resolution`@1 → `salesforce`@20 → `domain_owner_contact`@55 →
`costar_sidebar`@60), **every one `enforce_mode='record_only'`**. Rows ever written:

| field | source | rows |
|---|---|---:|
| phone | `domain_owner_contact` | **4** |
| everything else (9 rungs) | | **0** |

Those 4 came from a single manual `owner-contact-propagate` tick on 2026-09-03. **`email` has never
been recorded once.**

**Ladder B — `metadata.field_sources` in `planContactFieldPromotion`.** This is the ladder PR10 calls
the second, *enforcing* one. It exists on **exactly 1 entity in the whole table** (a `phone`, source
`salesforce`). **It has governed one row.**

**So both ladders are empty, and PR5c-enforce's premise — "flip to `warn` then `strict` once the
ledger has history" — has no history to grade.**

## The question this prompt answers: why does nothing run?

1. **`contact-writeback.js` is gated `SF_CONTACT_WRITEBACK`, which is `off`** in
   `feature_flags_registry` (and `off_since` is NULL — nobody recorded when or why). **Was it ever
   on?** Is it off because writing back to Salesforce is doctrinally refused (`CLAUDE.md`:
   *"never writes back to clean SF"*), in which case the ladder on that path can never fill and the
   right answer is to say so — or is it off pending a rollout? **Read the flag's history and the
   handler's own header before assuming.**
2. **`owner-contact-propagate` has no cron.** Confirm against `cron.job` — the contact family has
   11 active jobs (`lcc-contact-acquisition` 120, `lcc-owner-contact-enrich` 139,
   `lcc-sf-contact-resolve` 165, …) and **none of them is this writer.** Was that deliberate, or did
   it simply never get scheduled? Its one manual run wrote 4 provenance rows, filled 4 org phones
   and queued 31 reviews from 25 owners scanned — so it is not inert, just unscheduled.
3. **Which of the 11 live contact jobs writes `entities.email`/`phone` at all?** Census the writers
   (AST walk, not grep — the PR5c-entities lesson: grep found 24 of 41 sites). If a LIVE job writes
   those columns and does NOT go through either ladder, that is the real finding and it outranks
   both PR5c-enforce and PR10.
4. **Does the SF bridge's CREATE path (PR5c-entities-b) actually produce rows?** It was predicted at
   **~12/day**; `source='salesforce'` on `entities` is **0**. Check `external_identities` for
   `salesforce/Contact` mints since `886cdf86` deployed — if the lane has simply been quiet, say so
   with the count; if it has minted and written no provenance, that is a defect.

## Then answer PR10 on evidence, not preference

With the census in hand: **which ladder should own `entities.email`/`phone`?** State the trade
explicitly — `field_provenance` is the fleet-wide, queryable, append-only ledger with a registry and
conflict lanes; `metadata.field_sources` is per-row, local to the writer, and is what
`planContactFieldPromotion` *reads back next run* (so a lie in it is self-perpetuating —
PR5c-entities already had to fix a dropped-field stamp for exactly that reason). **Recommend one
owner and say what happens to the other** (retire it, or keep it as the writer's private cache with
`field_provenance` authoritative). Do not implement the change here.

## Build (small, only if the census justifies it)

- If a live job writes those columns outside both ladders: route it through `shouldWriteField` the
  way PR5c-entities did, mutation-verified guard, no `enforce_mode` change.
- If `owner-contact-propagate` should be scheduled: propose the cron with a **named free minute**
  (the 04:00–05:59 block is dense — 120/136/137/139/151/158/165/176/216/224/237 are taken) and say
  what its value gate is. ⚠️ **Do not schedule a producer that has never been graded** — the
  assessor-enrichment lesson: run it manually once more, read the output, then schedule.
- Otherwise: write the verdict and the unblock condition, and change no code.

## Verify on

- The two ladders' row counts re-measured (expect A=4, B=1 unless something ran).
- The writer census: every path that writes `entities.email`/`phone`, with which ladder (if any)
  it consults — counted by parser, not grep.
- `SF_CONTACT_WRITEBACK`: on/off, why, and whether it can ever be on.
- A one-line answer to PR10 with the trade stated.
- **The unblock condition for PR5c-enforce, as a number** — e.g. *"grade when
  `field_provenance where target_table='entities'` exceeds N rows across ≥2 sources"* — so the next
  session knows when it is ready instead of re-deriving this.

## What NOT to do

- Do not flip `enforce_mode` to `warn` or `strict`. Do not enable `SF_CONTACT_WRITEBACK` (Scott's
  flag, and a Salesforce-write decision). Do not backfill `field_provenance`. Do not add a third
  ladder.

## Report back

The writer census · why each ladder is empty · the PR10 recommendation with its trade · the
numeric unblock condition for PR5c-enforce · anything that outranks this.
