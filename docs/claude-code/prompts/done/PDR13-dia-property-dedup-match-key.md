# PDR13 — dia's `properties` table has 5 un-deduped rows for one address; the existing merge cron's match key is too strict to see them

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P17 PDR13 (this finding, measured 2026-09-11) and its
PDR2/PDR3/PDR6 rows (the three symptoms this traces back to) · `docs/architecture/
property-identity-and-address-resolution.md` · the `dia_auto_merge_property_duplicates` cron migration
(search for it — confirmed alive, runs hourly, last run 2026-09-11 11:35 UTC, historically ~89.6%
success) and its `v_property_merge_candidates` view (the query this prompt needs to fix).

## Why this, why now

`PDR1` (life-command-center, merged) resolved a cross-domain `entities`-layer duplicate for the DaVita/
Donna-TX property. Checking live afterward, three tabs that should have self-resolved (ownership, sale
history, CMS link) did not. Root cause, found 2026-09-11 by read-only investigation: dia's own
`properties` table carries **5 separate, never-merged rows for this one physical address** —

| property_id | what it carries |
|---|---|
| `37722` | canonical per the PDR1 entity merge (LCC's chosen record) |
| `23545` | the real owner "Phil Decarion" + the real Feb-2019 sale (`sales_transactions.sale_id=311`, $3,639,317) |
| `37710` | a duplicate CoStar-sourced capture of the same sale (`sale_id=8747`) |
| `39874` | the correct CMS/Medicare facility link (`medicare_id='672843'`, matched 2026-09-10) |
| `45543` | address null |

The existing `dia_auto_merge_property_duplicates` cron is real and running, but its match key requires
**byte-for-byte identical normalized address strings** within the same state
(`lower(trim(regexp_replace(address,'\s+',' ','g')))`). These 5 rows' address strings never match each
other under that key, so this entire group is invisible to `v_property_merge_candidates` (47 pending
groups currently, none involving this address). **This is a match-key-too-strict bug in the detection
query, not a missing/unwired feature** — the merge mechanism itself works; it just never sees this group.

## 1. Measure the real population before touching the match key

Before changing anything, measure how many OTHER property groups are in the same shape — same physical
address by some looser signal (zip + street number, geocoded lat/long proximity, or a shared CCN/
medicare_id/parcel-id) but failing the current exact-string match. Report the real count fleet-wide, the
same discipline every value-gated writer in this arc has used before sizing a fix. Do not assume this
DaVita case is rare or common — measure it.

## 2. Loosen the match key, carefully — do not lower the bar to hit a bigger number

Options to weigh (pick the one the measured population actually supports, don't assume): a fuzzier
address-normalization pass (strip suite/unit noise, standardize directionals/abbreviations) reused by
the existing normalizer if one already exists in this repo; or a secondary merge pass keyed on a strong
shared identifier — CCN, `medicare_id`, or parcel/APN — that doesn't depend on address-string matching at
all and would independently catch this exact case (39874 shares `medicare_id='672843'` with the property
being resolved). **A wrong auto-merge here corrupts `sales_transactions`/`property_cms_link`/ownership
records fleet-wide** — same caution PDR1 used for `reconcile_entity`. If the honest, safe match only
catches a modest number of groups, ship that and say so.

## 3. Confirm this specific case resolves

Once the fix ships (flag-gated, dry-run first per this repo's existing pattern for the cron — check how
`dia_auto_merge_property_duplicates` itself is gated/tested before assuming a new toggle is needed),
verify directly that `37722`/`23545`/`37710`/`39874`/`45543` end up merged (or correctly identified as a
candidate group), and that the canonical `property_id`'s `sales_transactions`, `true_owners`/ownership
fields, and `property_cms_link` all populate correctly post-merge — this is the acceptance test PDR3 and
PDR6 are waiting on.

## 4. What NOT to do in this pass

- Do not touch `PDR2` (the ownership-display guard gap in `api/operations.js`'s
  `assemblePropertyPacket()`) — that's a separate, larger-scoped fix (4,026-property blast radius,
  unrelated to whether the properties table gets de-duped) filed on its own.
- Do not touch `PDR12` (the Rock Hill self-referencing-candidate gap in the LCC-side
  `ambiguous-entity-merge-planner.js`) — a different repo, a different planner, filed separately.
- Do not build a general property-deduplication UI or review queue in this pass — first fix the
  detection query and confirm it correctly and safely enlarges the candidate pool; whether the existing
  auto-merge cron is trusted to run unattended on the newly-visible population, or those go through
  human review first, is worth naming as an open question rather than deciding silently.

## Guard + ship

Mutation-guarded tests for the loosened match logic (two genuinely different properties at similar
addresses must NOT merge; the DaVita/Donna-TX 5-row group specifically used as a positive-control
fixture). Confirm live, post-merge, that this specific property's ownership/sale/CMS data actually
surfaces through the canonical record — that's the real acceptance bar, not just "the merge ran."

## Ship + record

Branch name of your choice. Response saved to `life-command-center`'s
`docs/claude-code/responses/` per the usual convention. Report the real fleet-wide population measured
in step 1, and whether DaVita/Donna-TX's own PDR3/PDR6 tabs actually populate post-fix — don't assume,
confirm.
