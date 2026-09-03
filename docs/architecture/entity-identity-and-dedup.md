# Entity identity & dedup — canonical topic page

> **START HERE for anything touching `entities.canonical_name`, `ensureEntityLink`, `lcc_merge_entity`,
> duplicate-mint rates, or "are these two rows the same party".** Created 2026-09-03 by consolidating
> the P195 → N15c/d/e → PR5c-entities-b-dupes → PR5c-entities-c arc out of `CLAUDE.md` (which keeps
> an eight-bullet invariant list and points here). §4 carries that arc's text **verbatim**.
> Siblings: `field-provenance-ladder.md` (which SOURCE wins on a column — a different question),
> `broker-and-firm-identity.md`, `property-identity-and-address-resolution.md`,
> `ADR-004-CANONICAL-PERSON-IDENTITY.md` (proposal, not executed).

## 1. The model

| object | role |
|---|---|
| `entities` (LCC Opps, ~66.9k live) | one row per party — person / organization / asset; `domain` is a PROVENANCE tag (`dia`/`gov`/`lcc`/`cre`), never an identity scope |
| `entities.canonical_name` | the dedup key. **Single writer: trigger `BEFORE INSERT OR UPDATE OF name` → `lcc_entity_canonical_key(name)`** (N15c). A caller's value is a suggestion the trigger overwrites. |
| `ensureEntityLink` (`api/_shared/entity-link.js`) | the choke point every producer mints through. Two identity tiers: **canonical_name** (domain is a ranking preference since `d5b0ac8`; cross-domain attach requires an exact non-generic email) and **email** (`&domain=eq.` kept ON PURPOSE — 27% precision without it). Dual-reads the legacy key. |
| `lcc_merge_entity` / `lcc_unmerge_entity` | the ONLY merge path; reversible since P196 (`lcc_entity_merge_log`, `r40_merge_reconcile_backup`); resolves both endpoints to the survivor; refuses cycles. |
| `lcc_entity_survivor(uuid)` | hop-capped tombstone follow; every writer keyed on a domain-supplied id must resolve through it (P175). |
| Review surfaces | `v_lcc_merge_candidates` (+ `dc:` fallback key for normalizer-blind names, P189) · `v_lcc_n15e_canonical_collision_candidates` · `v_lcc_entity_duplicate_mint_review` (PR5c-entities-b-dupes) · `v_lcc_entity_email_tier_blind_pairs` (55; 15 genuine) → `v_lcc_entities_c_review_merge_plan` (the 15, winner + deltas + `winner_decided_by`) over the `lcc_entities_c_pair_verdict` ledger (all 55 verdicts) · `v_lcc_tier0_coproposed_owner_duplicates` (7; 4 must never merge). **None carries `auto_mergeable`.** |
| Drift / rate instruments | `v_lcc_canonical_name_drift` (must be 0, positive-controlled) · `v_lcc_p195_resurrection_watch` + cron 243 · the duplicate-mint query (`PR5c_entities_c_…md` §6): creates landing on an existing live key, 30-day window |

**Banned for identity:** `lcc_normalize_entity_name`, `dup-pair-planner.ownerCore`/`nameSimilarity`,
`lcc_owner_strict_core`, any token-level fuzzy match, email-DOMAIN grouping (25%), co-proposal (7%),
cross-domain email-tier attach (27%). Each was measured on named rows before being refused.

## 2. Live state — dated, re-measure before quoting

**2026-09-03 07:40 UTC:** live `/version` = `cbac828a` (= `main`); `v_lcc_canonical_name_drift` **0**;
`v_lcc_entity_email_tier_blind_pairs` **55**; `v_lcc_entity_duplicate_mint_review` **691** (90-day
window incl. the 553-pair `older_row_has_no_email` bucket — deliberately not swept); **0**
`salesforce/Contact` identities minted since `d5b0ac8`, so the post-fix rate is **not yet
measurable** (baseline 3.37%, expect ~0.6% residual from the two races). `auto_mergeable` last
read **3,007** (2026-09-03; 3,006 on 2026-08-28 — re-derive, never quote).
👤 **N15e unique-key decision open: 6,608 groups violate `(workspace_id, canonical_name)` today.**
👤 **PR5c-entities-c-review open: the 15-pair plan is built and NOTHING is merged** — one
`confirm_sql` per row on `v_lcc_entities_c_review_merge_plan`, Scott's call, row by row.

**Junk-named person rows holding a real mailbox (PR5c-entities-c-oldest, 2026-09-03): 80** — 30
carry a Salesforce identity and **0 are in `junk_entity_review` (281 rows)**. That is the live
landmine the email tier resolves onto. ✅ **Censused ENTC 2026-09-03 —
`v_lcc_entities_c_junk80` — and the 80 are NOT one class:** 41 `sweep_candidate` · 27
`hold_salesforce_identity` · **6 `hold_email_corroborated`** (the row IS that mailbox's person) ·
4 `hold_inbound_reference` · 2 `hold_name_repairable`. ⚠️ Two corrections to the numbers above:
**11 of the 80 DO carry `metadata.junk_name_flagged`**, and **"37 alone on their mailbox" is
domain-scoped — by email address it is 31** (the view emits both). §5b.

## 3. The arc — one line each

| id | date | what it settled | record |
|---|---|---|---|
| P189 | 08-26 | `lcc_normalize_entity_name` returns NULL for 1,089 acronym-named firms ($185M) — the merge detector could not SEE them; `dc:` fallback key | `P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md` |
| P195 | 08-27 | 66 byte-identical entities → 56 survivors ($102.2M); 4 groups held on the generic-residue gate; `lcc_merge_entity`'s unsnapshotted pivot DELETE found | `P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md` |
| P196 | 08-27 | the merge is REVERSIBLE; 2,411 pre-P196 tombstones never will be | `P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md` |
| A2a | 08-27 | 26 ambiguity groups merged to unblock chains; the producer was `canonical_name` having >1 author, NOT r9 | `A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md` |
| N15c | 08-27 | ONE writer (trigger); 15,402 backfilled; dual-read JS; drift 0 | `N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md` |
| N15d/e | 08-27 | producer proven at 4,618 mints; 537 held rows recomputed; collisions 3,930 → 6,608 | `N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md` |
| PR5c-entities-b-dupes | 09-02 | `&domain=eq.` scoped the canonical_name tier; 9 of 11 dupes; fixed `d5b0ac8` (#2076) | §4 below (no separate audit) |
| PR5c-entities-c | 09-03 | the EMAIL tier keeps the filter — 27% precision without it; blind-pair view; guard goes red on removal (#2079) | `PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md` |
| PR5c-entities-c-review | 09-03 | the 15 as a plan Scott confirms row by row; the P195 winner rule degenerates here; **`lcc_p195_unmerge` strands duplicate edges** | `PR5c_entities_c_review_oldest_2026-09-03.md` |
| PR5c-entities-c-oldest | 09-03 | sized and the gate REFUSED — every guard catches 12 of 26 junk-oldest rows, reaches 22 of 193 groups, and cannot help the 37 alone on their mailbox | same |
| ENTC | 09-03 | the junk80 census (**not one class** — 6 rows ARE their mailbox); the entity mint gated with the guard the `contacts` write already used; **`lcc_p195_unmerge` FIXED, not retired — 66 open merges have no P196 ledger row** | `ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md` |

**Open (backlog ids):** N15e (👤 unique key — 6,608 groups) · N15f (`[MERGED]` PATCH bypasses the
trigger) · N15g (dead `canonical_name` argument in the asset mint) · N16 (retire r9's unattached
mints) · N20 (gov address-punctuation duplicate properties) · N21 (`sync.js`/`domains.js` POST
without looking up by key) · N3h (9 $0 duplicates on three firms; Gardner Tanenbaum's history split)
· PR5c-entities-c-race (needs N15e)
· ~~PR5c-entities-c-oldest~~ **MEASURED AND THE GATE REFUSED 2026-09-03**
· ~~PR5c-entities-c-junk80~~ **CENSUSED + PRODUCER GATED (ENTC 2026-09-03)** — the seeder is
dry-run and 👤 **nobody has applied it** (`junk80-apply`); the JS mint gate reaches 47.5% and the
residue needs `lcc_p131_is_document_row_label` reachable from JS without a second regex copy
(`junk80-gate-p131`) · **PR5c-entities-c-review — 👤 the 15-pair plan is BUILT, nothing merged,
Scott confirms row by row** · ~~PR5c-entities-c-p195-unmerge~~ **FIXED (ENTC 2026-09-03)**, and
`test/p195-merge-gate.test.mjs` now slices a superseded body (`p195-unmerge-callers`).

## 4. Lessons carried verbatim from `CLAUDE.md` (moved 2026-09-03, unedited)

## P195 — merging the byte-identical owner groups, and the two traps in doing it (2026-08-27)

P189 surfaced 60 byte-identical owner groups (147 entities, $102.4M) and merged nothing. P195 landed
the cleanup: **66 entities merged into 56 survivors, $102,216,468 of current annual rent consolidated,
0 live backrefs left on any tombstone, `auto_mergeable` unchanged at 3,053.** NGP Capital 5→1
($59.8M→$68.3M, 29→38 assets). Machinery: `lcc_p195_merge_byte_identical` (dry-run default) driven
group by group, gate `lcc_p195_name_has_distinctive_residue`, plan `v_lcc_p195_merge_plan`, ledger
`lcc_p195_merge_log` + snapshots in `r40_merge_reconcile_backup` (`note='p195:<batch>'`), reversal
`lcc_p195_unmerge(batch_tag)`. Full writeup:
`docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`.

- **⚠️ A BYTE-IDENTICAL NAME IS NOT AN IDENTITY CLAIM WHEN EVERY TOKEN IS GENERIC — AND THE
  DETECTOR'S OWN FILTER GUARANTEES THAT POPULATION IS OVER-REPRESENTED.**
  `v_lcc_merge_candidates_normalizer_blind` selects names where
  `lcc_normalize_entity_name(name) = ''`, i.e. names that reduce to NOTHING under the generic-CRE
  stoplist. That set is two different things: acronym-named REAL firms (**"NGP Capital" → `ngp`**,
  3 chars, under the normalizer's 4-char floor — the P189 blind spot) and pure-generic FRAGMENTS
  (**"Capital", "Properties", "Partners Group"** → empty), which are failed extractions. Measured:
  **4 groups / 25 entities carry no distinctive residue** — the three `Capital` rows span dia + gov
  with three DIFFERENT external identities and 15 relationships (three separate real parties whose
  captured name got truncated to one word), and 17 of the 18 `Partners Group` rows are empty husks
  minted in two bursts on 2026-06-24/26. Merging them fabricates a party. **When a detector's filter
  is "this name reduces to nothing", grade the residue before treating identity as proven.**
  - The held group worth reading is `capitalgroupproperties`: one member is a gov `true_owner`
    holding one asset; the other carries a **`costar/company` external_id of `capital properties`** —
    a different company string. Genuine ambiguity, surfaced not guessed.
  - `lcc_p195_name_has_distinctive_residue` is NARROW and scoped to this gate (the
    `lcc_p131_is_document_row_label` precedent) — never reuse it as a general name filter. Its
    stoplist is pinned token-for-token against `lcc_normalize_entity_name`'s by
    `test/p195-merge-gate.test.mjs`; if the normalizer gains a word and the gate does not, the gate
    silently stops describing the population it was measured on.
- **⚠️ `lcc_merge_entity` DOES NOT SNAPSHOT, AND ITS `owner_contact_pivot` DEDUP IS UNCORRELATED.**
  It calls `lcc_reconcile_tombstone_backrefs(loser, winner, p_snapshot => **false**)`, so every dedup
  DELETE it performs (portfolio facts, identities, relationships, watchers, pivot) is
  **unrecoverable** — `lcc_apply_fuzzy_merges` therefore auto-merges irreversibly today. And the pivot
  predicate is `exists (select 1 from owner_contact_pivot w where w.entity_id = v_winner)` with **no
  correlation**: it asks only whether the winner has a pivot *at all*, then deletes the loser's.
  Live on `bamproperties`: the winner by ownership (1 asset, $517k) had a pivot naming **nobody**;
  the loser carried the group's **only named contact, "Alex Bias"**. A bare merge deletes it — no
  error, no ledger, in the exact lane the pass exists to clean. **Any caller that wants reversibility
  must snapshot BEFORE calling the merge, and must reconcile the pivot fill-blanks first.**
  `active_source` is carried across VERBATIM, never restamped — the Tier 0 lane reads it with `<>`
  and `IN`, and a new value there is the P194 trap.
- **⚠️ A REVERSAL PATH THAT HAS NEVER BEEN RUN IS A CLAIM, NOT A CAPABILITY.** The round-trip gate
  (real merge → unmerge → compare) failed first time with **`428C9: cannot insert a non-DEFAULT value
  into column "is_current"`** — `lcc_entity_portfolio_facts.is_current` is `GENERATED ALWAYS`, a
  footgun already documented in this very file, and a `select *` restore over a snapshotted row
  shipped past review anyway. Run the round trip, on real data, before trusting the ledger.
- **Measured nil, with the positive control (P182): ZERO `(source_domain, source_property_id)`
  collisions between members across all 60 groups**, so the P175a ghost-vs-ENDED conflict never
  arises here and no portfolio fact was dedup-deleted. The same query shape finds **2,678** such
  collisions fleet-wide, which is what makes the zero believable. Likewise `portfolio_edges_moved`
  reads 0 for the whole no-owner slice because the snapshot ledger records **no** portfolio rows on
  any of those 40 losers — an honest zero, not a broken counter.
- **Winner rule is ownership-first**, not rent: `owns_assets → current_rent → portfolio_facts →
  external_ids → relationships → created_at → id`. The entity that actually owns assets is the one
  every downstream consumer already points at. It deliberately does NOT promote the pivot-bearing
  member — the fold preserves the contact regardless of who wins.
- **Class 8 is scheduled, not remembered:** `v_lcc_p195_resurrection_watch` +
  `lcc_p195_check_resurrection()` on **cron 243 (06:52 UTC)**, after `generate-research-tasks`
  (06:35) so a group re-minted overnight is caught the same morning. **Read `regrown_groups`, never
  `open_groups`** — a group that was never merged is not a resurrection.


## N15c — `entities.canonical_name` has ONE writer, and the census was wrong twice (2026-08-27)

Ten code paths wrote `entities.canonical_name` with five different normalizations, so **10,336 of
62,368 live entities carried a key `ensureEntityLink`'s own lookup could not reproduce from their
own name** — it missed and minted, ~4 duplicates/day. Now: `lcc_entity_name_tokens` owns the token
rule, `lcc_entity_canonical_key` (space join) is the value, and a `BEFORE INSERT OR UPDATE OF name`
trigger is the sole writer. Writeup: `docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md`.

- **⚠️ GREP CANNOT FIND EVERY WRITER OF A COLUMN, AND THREE PASSES PROVED IT.** N15b's census said
  seven; the brief added an eighth; the build found **ten** — `api/sync.js` and `api/domains.js` both
  POST/PATCH `entities` — plus a **twelfth normalization hiding in a dead defensive ternary**
  (`(typeof normalizeCanonicalName === 'function') ? … : newName.toLowerCase()`). **That is the
  argument for putting the rule in a trigger rather than in the callers**: a trigger does not care
  how many writers there are, and it closes the staleness class in the same stroke because it
  recomputes when a name-repair path rewrites `name`. When a column has "a few" writers, assume you
  have not found them all.
- **⚠️ ONE TOKEN LIST, TWO JOIN STYLES — never two token lists.** `lcc_owner_domain_core` ends
  `string_agg(tok,'')` with **no separator**, which is right for a domain comparator and wrong for a
  name key: over 43,219 live organizations the no-separator form yields **115 FEWER distinct keys,
  and every one is a false collision** (`Gate Way` == `Gateway`, verified on the named row). Both
  functions now read one stoplist and differ only in the join. **Adopting a function's RULE is not
  adopting the function** — re-grade the join, the separator and the residue on named rows first
  (the same lesson as A2's `strict_core` and P189's normalizer hazard: the hazard travels with the
  TECHNIQUE).
- **⚠️ A REFACTOR OF A LOAD-BEARING FUNCTION NEEDS A BYTE-IDENTICAL PROOF *AND* A POSITIVE CONTROL.**
  `lcc_owner_domain_core` underwrites P187/P188/P194/P196/P197/P198. It was compared over **103,710
  values** (every live entity name, every `company_name` in `lcc_sf_list_membership` and
  `unified_contacts`, plus NULL/empty/`İstanbul`/tabs/apostrophes): **0 mismatches**. That zero was
  not believed until the same detector was pointed at deliberately-wrong variants and reported
  ~59,800 (Class 11). Note one mutation — appending `LLC` to every name — correctly reported 0,
  because appending a stopword *is* a no-op; **a mutation that mutates into a no-op is not a failed
  control, but you have to notice which kind you wrote.**
- **⚠️ DEPLOY ORDER IS THE *SECOND* KIND HERE: CONSTRAINT AFTER WRITER DEPLOY.** The trigger writes
  the new key while the *deployed* `ensureEntityLink` still reads the old one, so applying it (and
  especially the 15,402-row backfill) before the JS ships would make those rows unfindable at once
  and turn a ~4/day leak into a spike. The trigger therefore ships as its own migration
  (`…230200`), **unapplied**, with the inert half (`…230100`: functions, ledger, dry-run backfill,
  drift view) live. The JS is **dual-read** — `ensureEntityLink` queries the current key AND the
  legacy key in one PostgREST `in.(…)` — which is what makes the order safe once it is live and what
  keeps the held-back rows resolving. **A schema change that enforces a writer's output is not
  "additive" just because it adds an object.**
- **⚠️ A GUARD THAT MATCHES A SHAPE IS DEFEATED BY A LOCAL VARIABLE.** The inline-copy test first
  matched `canonical_name: x.trim()`; the mutation that assigned an inline copy to a `const` walked
  straight through it. Rewritten to **resolve the assigned identifier to its initializer**, it went
  red — and finding that is what surfaced the 12th normalization. Every one of the 8 tests is
  mutation-verified. (Same family as the P182 deparse trap and the A1 prose detector: assert on the
  substance, never the spelling.)
- **The empty key is namespaced, and fixing it rescued a real firm.** 98 live entities reduce to no
  tokens (`--` ×89, `Llc`, `Corporation`, `The`, `Trust`); they key `'dc:'||…`, provably disjoint
  from any real key because a real key is `[a-z0-9 ]+` and can never contain a colon (the P189
  `v_lcc_merge_candidates_normalizer_blind` precedent). ⚠️ **Today 114 entities share
  `canonical_name = ''` and one of them is `Partners Group`** — a real firm whose two semantic tokens
  are both stripped by the outgoing normalizer, keyed identically to `--` junk. The new rule keys it
  `partners group`.
- **⚠️ A CONSUMER THAT READS ANOTHER WRITER'S COLUMN CAN BE MADE WORSE BY FIXING THAT COLUMN.**
  `v_lcc_developer_classification_candidates` joined `e.canonical_name` against
  `lcc_normalize_entity_name(developer_name)` — the one surface that wants the *aggressive*
  normalizer. Of 277 candidates it resolved **218** today, **267** once it COMPUTES the normalizer,
  and **196** if left alone after N15c. Repointing was not optional. ⚠️ **And its own row count is
  not that measurement** — the view returns 5 rows because 269 candidates sit in
  `lcc_developer_classification_log`; N15b's "222 of 274" does not reproduce off the view.
- **Verify by `v_lcc_canonical_name_drift`, and read `drift_class`, never the total.** After the
  backfill the total holds at the held rows; a **new `backfillable` row means a writer escaped the
  trigger**. A one-shot backfill of a live producer is Class 8 — the standing view is what says
  whether the producer is actually fixed.
- ✅ **APPLIED 2026-08-27 (PR #1850, `d8fcfbf`).** Trigger + backfill landed 20:03–20:38 UTC;
  `v_lcc_canonical_name_drift` is **0 rows** (positive-controlled), `auto_mergeable` 3,040,
  unranked 33, Tier 0 91 — all unmoved. **Two batches**: `n15c_go` = the 15,402 attributable rows;
  **`n15e_go` = the 537 held rows**, an operator decision the gated function cannot produce (it
  filters on `lcc_n15c_canonical_is_attributable`). Reversible by batch tag.
  ⚠️ **The "recomputing discards a captured string" caution was right in principle and mostly wrong
  in substance** — read on named rows the held keys were a CoStar listing blob
  (`davita dialysis tulsa ok 9647 ridgeview st … 780 cap rate` on an entity named `9647 Ridgeview
  St`), `by colliers`/`by cushman wakefield` brokerage pollution, and raw unnormalized strings that
  could never match. **Grade a held population on named rows before treating it as precious.**
- **⚠️ DRIFT = 0 PROVES THE BACKFILL, NOT THE PRODUCER — and this is the Class 8 distinction
  itself.** **Zero entities have been minted since 18:00 UTC**, so no real ingestion has yet
  exercised the trigger and the JS dual-read together. A one-shot backfill and a fixed producer are
  indistinguishable until the producer runs. The check that matters is a **NEW `backfillable` row**
  in `v_lcc_canonical_name_drift` after the next sync — that, not the zero, is what says a writer
  escaped the trigger. (Still unconfirmed at the time of writing: whether the Railway redeploy
  carrying `d8fcfbf` preceded the 20:03 backfill. The sandbox cannot reach the Railway host —
  `http=000` while `api.github.com` returns 200 — so `/version` must be checked from somewhere that
  can.)
- ✅ **THE PRODUCER IS VERIFIED FIXED — AND CONFIRMED AT SCALE (2026-08-29).** The first check rested
  on 3 mints; a bulk sync has since minted **4,618** (live 62,346 → 66,901) and **drift is still 0**.
- **⚠️ DRIFT = 0 IS NECESSARY AND NOT SUFFICIENT — A DUPLICATE STORM READS DRIFT 0 TOO**, because the
  trigger dutifully computes a correct key for every duplicate. The gate that matters is *did a new
  mint land on a key that already had a live entity*: **22 of 4,618 (0.48%)**. And **19 of those are
  not an LCC defect** — each colliding gov `asset` pair carries a DIFFERENT `gov/asset/<property_id>`,
  i.e. two rows in gov `properties` for one building, differing only by address punctuation
  (`303 "H" St` / `303 H St`, `St. Albans` / `St Albans`) which the key strips. The asset path mints
  one entity per domain property id **by contract**, so LCC is mirroring a DOMAIN-level duplicate the
  N15c key merely made visible (**N20**) — do not "fix" it by weakening that contract. **The genuine
  residual is 3 of 4,618 (0.06%)**, from `api/sync.js` / `api/domains.js`, which now compute the right
  key but still POST `entities` without looking up by it (**N21**).
- 👤 **One decision remains Scott's, and its size CHANGED:** whether the column becomes an enforced
  **UNIQUE** key. ⚠️ **3,930 was measured on the OLD keys; on the N15c key it is 8,136 groups**
  (`v_duplicate_candidates`). The extra ~4,200 are **not an over-collapse** — read on named rows they
  are pre-existing duplicates the disagreeing keys were hiding (`Office Properties Income` /
  `…Income Trust` ×8; `AEI Capital` / `Corp` / `Corporation` ×6; `Rainier Companies` /
  `The Rainier Companies`; **`Realty Income` ×5**, the name N15b showed the old fuzzy comparator
  reduces to the empty string so it cannot match itself). **Surfacing them is the fix working.**
- 👤 **Two decisions were left to Scott. ⚠️ BOTH LINES BELOW ARE NOW SUPERSEDED — see the N15d/N15e
  section that follows.** (1) The **537 stale rows** were **recomputed 2026-08-27 (batch `n15e_go`),
  drift 537 → 0**; the "recomputing discards a captured string some preserve" concern measured at
  **73 of 537, and the ledger preserves all of them**. (2) The UNIQUE-key question is still Scott's,
  but **"3,930 groups violate it today" is a PRE-N15c figure — it is 6,608 now**, because collapsing
  keys is exactly what creates collisions.

## N15d + N15e — the producer proof, and the 537 recomputed (2026-08-27)

`v_lcc_canonical_name_drift` **537 → 0**: every one of 62,368 live entities now keys to
`lcc_entity_canonical_key(name)`. `auto_mergeable` 3,040 → 3,040, Tier 0 82/9/137 unmoved,
`lcc_owner_domain_core` byte-identical. Migration `20260827240000`, batch `n15e_go`, reversible.
Writeup: `docs/audits/N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md`.

- **⚠️ THE CLASS-8 WALL-CLOCK CHECK COULD NOT BE RUN, AND "0" WOULD HAVE BEEN A LIE OF OMISSION.**
  The trigger landed 20:03–20:05 UTC; the check ran at 20:26. **Elapsed window 21 minutes, entities
  created in it ZERO.** At a pre-fix ~4/day (one per six hours) a detector over an empty population
  returns 0 regardless of what the producer does — the *detector cannot fail*, so its zero is not
  evidence (Class 11). **Still due 2026-08-28**, and even a full day at ~4/day is weak (daily counts
  range 0–8). The general rule: **before quoting a recurrence zero, state the elapsed window AND the
  population that passed through it** — "no new bad rows" and "no new rows at all" read identically.
- **⚠️ N15b's recurrence query is NOT PUBLISHED — a prompt saying "re-run it" cannot be taken
  literally.** Three reconstructions were built and run against pre-backfill values rebuilt as
  `coalesce(ledger.old_canonical_name, e.canonical_name)` — **which is the only reason a baseline is
  reproducible at all after a backfill has rewritten 15,402 rows.** All three reproduce the burst
  (1,760–1,789 vs 1,789) and the most-recent date (2026-08-26) **exactly**, and put the trickle at
  **70–94 against the quoted 79**. Adopted: *E was minted because an OLDER sibling sharing its key
  was invisible* — the actual mint mechanism. **Quote the band, never the 79 as if reproduced.**
- **⚠️ EXERCISING EVERY WRITER PATH BEATS WAITING FOR ONE TO LEAK.** In a self-rolling-back
  transaction: verbatim INSERT, `ON CONFLICT (id) DO UPDATE` (the P196 hazard), aggressive-normalizer
  INSERT and `UPDATE OF name` **all landed on the trigger's key**; a `canonical_name`-only UPDATE
  bypassed it *by design* and drove drift **537 → 538**, which is the Class 11 positive control
  proving the detector can fire. That is stronger evidence about the producer than a day of wall
  clock, and it is available immediately.
- **⚠️ A LATENT BYPASS EXISTS AND IT IS INVISIBLE UNTIL IT FIRES.** `api/operations.js:4666`
  (`merge_duplicate_entities`) PATCHes `canonical_name: '[MERGED] …'` **without `name`**, so the
  `UPDATE OF name` trigger never fires — and it stamps `metadata.merged_into`, **not the
  `merged_into_entity_id` column**, so the row would stay in the live population and in the drift
  view forever. **Measured `canonical_name LIKE '[MERGED]%'` = 0 rows** — never fired. Filed as
  **N15f**, not patched. **A `BEFORE UPDATE OF <col>` trigger is only as complete as the set of
  writers that touch that column** — enumerate the writers that touch the DERIVED column directly.
- **⚠️ THE "RECOMPUTING DISCARDS CAPTURED TEXT" PREMISE IS 14%, AND THE LEDGER COVERS IT.** Of the
  537, **463 (86%) had a stale key holding LESS** alphanumeric content than the recomputed one; 73
  held more, 57 held >10 chars more. The backfill writes the ledger **before** the UPDATE, so those
  strings move to `lcc_n15c_canonical_backfill_log.old_canonical_name`. **A dedup key is not an
  archive.** Round trip run on 50 real rows and rolled back — reversal restored them byte-identically
  (P195: a reversal never RUN is a claim).
- **ONE BACKFILL FUNCTION.** `lcc_n15c_backfill_canonical_names` gained `p_include_held boolean
  DEFAULT false`. ⚠️ **Adding a parameter creates an OVERLOAD** and, with defaults on both, every
  1–3-arg call becomes *"function is not unique"* — so the old signature is **DROPPED** first. The
  default gate still plans **0** rows, so N15c's behaviour is unchanged.
- **⚠️ THE COLLISIONS ARE THE BENEFIT, AND THE PRE-APPLY COUNT COULD NOT SEE HALF OF THEM.**
  Predicted 39 (held vs a pre-existing live entity — confirmed exactly); actual **47 entities / 73
  pairs**, because after the recompute the held rows also collide with **each other** (14 pair rows).
  **A prediction made against the un-mutated population misses within-batch effects.** They are
  byte-identical names the stale key was hiding (`1121 California Avenue LLC` ↔ itself,
  `National Government Properties` ×3). `v_lcc_n15e_canonical_collision_candidates` is
  **read-only, human-confirm, and deliberately carries NO `auto_mergeable` column** (P198 —
  `lcc_apply_fuzzy_merges` loops on that flag). **9 pairs are cross-`entity_type`** (`David Siegel`,
  `Dennis Needleman`, `Alexandria`, `Societe Generale` each exist as both person and organization) —
  a shared key is correct, reading it as identity is the person/org conflation `sf-account-link.js`
  exists to prevent. `American Realty Capital` ↔ `American Realty Capital Trust` is Scott's adopted
  trust rule **working**, not a defect.
- **⚠️ 👤 THE UNIQUE-KEY DECISION'S INPUT MOVED, AND THE BRIEFED FIGURE WAS STALE.** "3,930 groups
  violate it" is **pre-N15c**; collapsing keys is precisely what creates collisions.
  **3,930 → 6,584 (after N15c) → 6,608 (after N15e)** — 68% above the number the question was framed
  against. Whether `canonical_name` becomes an enforced UNIQUE key is **still Scott's**, and the
  honest input is 6,608.

## PR5c-entities-b-dupes — `domain` was scoping the IDENTITY key (2026-09-02)

> ⚠️ **This fixed ONE of the two identity tiers.** The EMAIL tier carries the identical
> `&domain=eq.` filter — deliberately kept, measured at 27% precision. See **PR5c-entities-c** below
> before "finishing the job".

`ensureEntityLink`'s canonical_name tier — the primary dedup key, the one N15c gave a
single writer — carried a hard **`&domain=eq.<domain>`** filter. `entities.domain` is a
PROVENANCE TAG that legitimately carries `lcc` and `cre` beside `dia`/`gov`, so a party
already held under `gov` (or with a NULL domain) was **structurally invisible** when the
same party arrived tagged `lcc`, and the tier minted a duplicate on the very key that
exists to prevent one. Fixed in `api/_shared/entity-link.js`: domain is now a RANKING
PREFERENCE, and a cross-domain attach additionally requires an exact non-generic email
match. Guard `test/pr5c-entities-dupes-domain-scope.test.mjs` (11 tests, 4/4 mutations
RED; reverting the filter turns 6 red). Review surface
`v_lcc_entity_duplicate_mint_review` (read-only, **no `auto_mergeable` column** — P198).

- **⚠️ THE PROMPT NAMED THE WRONG MODULE, AND THE RUN LEDGER SETTLED IT IN ONE QUERY.**
  The brief located the defect in `findEntityForUpsert`
  (`bridge-handlers-salesforce.js`). Measured on `bridge_runs`: **zero Salesforce bridge
  runs in the entire incident window** (2026-08-07..20) — the only bridge running was
  `outlook.messages`, 41,519 runs. That handler never executed for these rows. The real
  writers are the **`lcc-sf-contact-resolve` tick (cron 165, `*/30`)** — 10 of 13 mints
  land within seconds of `:00`/`:30` — and the **CoStar sidebar** (3 off-cadence mints
  carrying a `costar/contact` identity). Both mint through `ensureEntityLink`. **Before
  fixing a lookup, prove from a run ledger that it RAN** — this is C1's *read a handler's
  direction before counting it as a consumer* one step earlier.
- **🚨 A SHALLOW CLONE MAKES `git log -S` REPORT THE GRAFT BOUNDARY AS THE "ADD", AND I
  PUBLISHED THAT AS A FINDING BEFORE CATCHING IT.** `git log -S findEntityForUpsert`
  returned a single commit dated **2026-09-02**, which read as *the lookup did not exist
  during the incident* — a clean, wrong refutation. The repo was `--depth`-limited (149 of
  7,709 commits); after `git fetch --unshallow` the true introduction is **2026-05-09**,
  and the function was byte-identical throughout the window. **Run
  `git rev-parse --is-shallow-repository` before dating anything from history.**
  Compounding it: my "absent in the parent" check was `git show <sha>^:file | grep -c`,
  and `<sha>^` did not exist — grep printed `0` over empty input and the `|| echo`
  fallback printed too, so **a failed command rendered as a confirming zero.** The
  file's own doctrine, committed by its author: *never let an error render as a zero.*
- **⚠️ THE OBVIOUS FIX — DROP THE DOMAIN FILTER — WAS MEASURED AND NARROWED.** Over live
  shared-email person groups, **44 of 75 carry DIFFERENT names**: `colt.neal@nmrk.com`
  holds two different real brokers, `alex.sharrin@am.jll.com` holds OM row-labels
  (`expenses`, `per sf` — P131), `bcorriston@northmarq.com` holds a person and
  `ace hardware`. And **two distinct "Frank Johnson"s exist here under different
  domains.** So a shared canonical_name alone is NOT identity for a common person name;
  the cross-domain arm requires email corroboration. **No name-similarity test is used —
  fuzzy name matching stays banned for identity.**
- **⚠️ THE `intra_request_race` IS A SECOND MECHANISM AND THIS CHANGE DOES NOT FIX IT.**
  Two mints (W. Aaron Poling, Ransome Foose) are **0.14 seconds apart with the SAME
  domain** — the lookup ran before the sibling insert committed. A lookup fix cannot close
  a race; that needs a unique constraint on `(workspace_id, canonical_name)` — the open
  operator decision N15e sized at **6,608 violating groups** — or retry-on-conflict.
- **Honest rate, with its definition.** Over 30 days: **326** `salesforce/Contact` creates,
  **17** landed on an existing live canonical key (5.21%), of which **11 are probable
  duplicates (3.37%)** — 9 `cross_domain_canonical_miss` (fixed here) + 2 races. Expect
  ~0.6%, not 0. ⚠️ The brief's "14 / 4.3%" does not reproduce; **re-derive before quoting.**
- **⚠️ THE LARGEST BUCKET IS DELIBERATELY LEFT ALONE.** At 90 days, `older_row_has_no_email`
  is **553 pairs / 495 entities** — same name, older row carries no email, so there is no
  corroboration for a cross-domain identity claim, and the bucket visibly contains orgs
  misfiled as people (`Ace Hardware`, `Sperry Van Ness`). Attaching them would be the
  destructive guard. Named on the view, not swept.

## PR5c-entities-c — the fix landed on ONE of two tiers, and the sibling must NOT be "fixed" (2026-09-03)

The six predicates a brief named for the Salesforce duplicate mints are **all refuted**: across the
11 same-email pairs the older row is a **live `person`, same workspace, byte-identical email**
(one differs only in CASE, which `ilike` matches anyway) — no NULL email, no wrong `entity_type`,
no `%`/`_`/`+`/whitespace, no tombstone. **The named lookup would have found it**, and
`findEntityForUpsert` never ran for these rows at all. The real mechanism was
`cross_domain_canonical_miss` on **9 of 11** (the other 2 are 0.14 s races), fixed by `d5b0ac8` and
**live at `9158055`**. Writeup:
`docs/audits/PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md`.

- **⚠️ THE HAZARD TRAVELS WITH THE TECHNIQUE (P189), ONE ROUND LATER, IN THE SAME FUNCTION.**
  `ensureEntityLink` has two identity tiers. PR5c-entities-b-dupes removed the `&domain=eq.` filter
  from the canonical_name tier and its own guard scoped the other out — *"the email tier is a
  separate query ... unchanged by this fix."* **`entity-link.js:1168` carries the identical
  filter**, and it is the fallback that exists precisely to catch what the canonical tier misses.
  Both tiers were blind at once, which is why the nine cross-domain pairs had no backstop. **When a
  hazard is documented for one lookup, grep every sibling lookup in the same function.**
- **⚠️ AND THE OBVIOUS FOLLOW-UP IS THE DESTRUCTIVE ONE — 27% PRECISION, REFUSED.** The email tier
  is blind to **55** live pairs sharing a non-generic email with different canonical names (so the
  canonical tier cannot catch them either) and different domains. Read on **named rows**: **15 are
  the same person** under a name variant (Andy/Andrew Nathan, Nicholas/Nick Borrelli, Vince/Vincent
  Curran, Ravi/Ravindra G. Gangavaram…); **40 are not** — two different **real** brokers on one
  mailbox (**Phillip Kelly / Toby Scrivner** @northmarq.com; Jack Minter / Creighton Stark; David
  Gellner / Matthew Dodson), firms filed as persons ("Marcus & Millichap", "Kidder Mathews",
  "Global Net Lease"), and P131 document row labels ("Income & Expenses", "Per SF", "First Vice
  President"). That is the band **P189 (25%) and P198 (7%) already measured and rejected**.
  **An attach is worse than a duplicate**: a duplicate is merged later by a reversible, snapshotted
  `lcc_merge_entity`; a wrong attach folds two people into one row at write time, silently.
- **⚠️ THE TWO TIERS ARE NOT SYMMETRIC, WHICH IS WHY THE SAME FIX DOES NOT TRANSFER.** The
  canonical tier matches on NAME, so it can require EMAIL to agree cross-domain — that is exactly
  what `d5b0ac8` did. The email tier matches on EMAIL, so the symmetric corroboration would be a
  NAME test, **banned for identity** everywhere here. A structural person-shape gate on the
  resolved row was considered and does not fix the core case (Jack Minter and Creighton Stark are
  both plausible real people on one mailbox). **Copying a fix between two tiers requires checking
  what each one keys on.**
- **The filter therefore STAYS, and the guard says so with the reason attached.**
  `test/pr5c-entities-c-email-tier-domain-scope.test.mjs` (6 tests, **8/8 mutations RED**) goes red
  on its removal — the PR1b `consideration` precedent: *a test that fails when someone "guards it
  for consistency"*. Comment-stripping is load-bearing AND population-controlled: the subject and
  the guard both quote `&domain=eq.` in prose, so a raw-source grep finds it present over a
  complete revert (A5c / N18).
- **Surface: `v_lcc_entity_email_tier_blind_pairs`** (migration `20261012120000`) — the 55,
  read-only, **no `auto_mergeable` column** (P198: `lcc_apply_fuzzy_merges()` loops on that flag).
  A measured blindness must EMIT, not vanish (I4 / B6a), or the 27% is a claim that rots.
  `lcc_is_generic_inbox_localpart()` mirrors the JS Set and is **pinned token-for-token** by the
  guard (the P195 precedent). ⚠️ It excludes **0** pairs here — inert on this population, not
  protective.
- **⚠️ READ THE RATE, AND READ WHETHER IT HAS BEEN EXERCISED.** Baseline: **326 SF-Contact creates
  / 13 landed on an existing live key (3.99%) / 11 probable duplicates (3.37%)**. The brief's
  "14 / 4.3%" does not reproduce — **re-derive, never quote**. And the post-deploy rate is **not yet
  measurable**: **zero `salesforce/Contact` identities have been minted since the fix landed**
  (newest 2026-09-02 16:01, fix 22:30), though the code path itself has run via CoStar. *Deployed is
  not exercised* — the N15c lesson. Expect ~0.6% residual from the races, never 0.
- **Filed, not built:** the 2 races need the `(workspace_id, canonical_name)` unique constraint
  (blocked on N15e's operator decision, 6,608 violating groups); the email tier takes the **oldest**
  email match without checking it is person-shaped, so an inbound real person can attach to a P131
  row label that predates them (**live within a domain today**); and the 15 genuine pairs are a
  human merge decision. **No merges were performed.**

## 5. Lessons from rounds recorded here directly (never in `CLAUDE.md`)
## PR5c-entities-c-review + -oldest — the plan, and the reversal path that reported success (2026-09-03)

`v_lcc_entities_c_review_merge_plan` (15 rows) over the `lcc_entities_c_pair_verdict` ledger (all 55
verdicts, so the 40 non-merges are a recorded DECISION). Migration `20261013120000`. **No merges, no
`ensureEntityLink` change.** Writeup: `docs/audits/PR5c_entities_c_review_oldest_2026-09-03.md`.

- **⚠️ THE SELECTION IS TWO BASES AND SAYING SO IS THE DELIVERABLE.** A structural rule reaches **6
  of 15**: strip single-character tokens from both canonical names and require identical multi-token
  residues — it fires on 6 of the 55 and **0 of the other 49**, and the "extra tokens must be
  initials" clause is what refuses `Income & Expenses` / `Expenses`. The other **9 have no rule**:
  Andy/Andrew, Jim/James, Nick/Nicholas, Steve/Steven, Vince/Vincent, Ravi/Ravindra, Greg/Gregory
  need a nickname dictionary or a shared prefix, and Randy Blankstein/Blankenstein needs edit
  distance — all banned for identity. They ride as `basis='human_read'` with the reason on the row,
  never inferred. **A partial deterministic rule plus a named human read beats one comparator that
  covers everything.**
- **⚠️ THE P195 WINNER RULE DEGENERATES ON A BROKER POPULATION — READ `winner_decided_by`.**
  `owns_assets → current_rent → portfolio_facts` are **zero on all 30 endpoints, and on 92 of the 93
  endpoints across all 55 pairs**, so the ownership-first tiers are constant and the winner is
  decided entirely by `external_ids` (9) then `relationships` (6). That tie-break says nothing about
  which NAME should survive: it picks `Frank Johnson` over the older, better-connected
  `Frank D. Johnson`, and `Steve Karlson` over `Steven Karlson`. **A rule calibrated on owners is
  not wrong here, it is SILENT** — the plan names the deciding tier and hands Scott an explicit
  `(loser, winner)` to swap.
- **🚨 `lcc_p195_unmerge` STRANDED ROWS AND REPORTED `restored` — ✅ FIXED ENTC 2026-09-03 (P196's
  shape + a want-vs-have `note`; round trip 24/24, 0 lost, 0 stranded, `restored` 17 → 19). ⚠️ The
  "retire it, it is redundant" verdict below was REFUSED on a measurement: 66 open
  `lcc_p195_merge_log` rows have NO `lcc_entity_merge_log` row, so `lcc_unmerge_entity` cannot
  reverse any of them — retiring it would have made 66 live merges irreversible.** Round trip
  on the Harrison pair, rolled back: the P195 wrapper restored 17 rows and left **two byte-identical
  `brokers` edges on the winner**, because `trg_lcc_entity_rel_resolve_survivor` (BEFORE INSERT)
  SKIPS a duplicate of an edge the now-live loser already holds, so the row never reaches
  `ON CONFLICT (id) DO UPDATE`. **P196's exact finding, in the one reversal path that never got
  P196's fix.** The plain P196 path (`lcc_merge_entity`, self-snapshotting since P196, then
  `lcc_unmerge_entity`) round-tripped **0 lost / 0 new / 0 changed**. ⚠️ **Row COUNT was 26 before
  and after in BOTH runs** — counting rows reads the broken path as clean; only an identity-keyed
  fingerprint (`id:from>to:type`) exposes it. The wrapper is also now redundant (it double-snapshots
  and double-folds). Filed **PR5c-entities-c-p195-unmerge**.
- **⚠️ THE `-oldest` GATE WAS MEASURED AND REFUSED, AND THE REFUTATION IS THE GUARDS THEMSELVES.**
  193 same-domain mailboxes hold ≥2 live person entities. Reading all 193 oldest names, **26 are
  clearly not a single person** — firms (`CBRE`, `Kidder Mathews`, `Northmarq`), row labels (`Condo`,
  `Taxes`, `Public`), whole sentences (`This transaction was not financed.`), a country, a street and
  **UI chrome (`View Less`)**. Every SQL guard combined catches **12 of the 26**, and
  `lcc_looks_like_person` **PASSES 16 of them** (P188's documented leak on a new population). The
  rule's reach is the **22** groups where exactly one row is plausible; on the **171** where ≥2 rows
  pass every guard it is silent, and switching oldest → most-evidenced would re-pick the winner on
  **139** of those for no reason connected to identity. **A gate whose own instrument fails on half
  the population it exists for is not a fix.**
- **⚠️ AND THE REAL DEFECT IS UPSTREAM AND ALREADY LIVE.** **80 live person entities carry a
  non-generic email and a junk-shaped name**; **30 carry a Salesforce identity** (21 of them named
  `--`, the N15c empty-key population, each holding a real broker's mailbox; plus a job title on
  `steven.weinstock@marcusmillichap.com`, a sentence on `teamherrold@northmarq.com`, `Switzerland` on
  `peter.gilbertie@ubs.com`, a listing TEAM on `daniel.chumbley@marcusmillichap.com`). **37 of the 80
  are ALONE on their mailbox, so no tiebreak can help them** — there is nothing to prefer. And **0 of
  the 80 are in `junk_entity_review` (281 rows) or carry `metadata.junk_name_flagged` (706 live)**:
  the junk lane exists and has never seen this population. Retiring them is the cheap reversible fix
  (**PR5c-entities-c-junk80**), not a new gate at the choke point.
- **⚠️ SEPARATE THE VENDOR DEFECT FROM THIS TIER.** `Cushman & Wakefield` carries **710**
  relationships, `Public` (on Joey Agree's mailbox) **380**, `View Less` **245**, `Northmarq` (on
  Scott's own address) 17 — those edges are the RCA/CoStar deal-party slot minting a COMPANY as a
  `person`, i.e. **C13c's `entity_type` defect, not an attach this tier made.** They are what a
  future attach would fold a real person into, which is the reason to care, but attributing them to
  the email tier would be wrong.
- **Two nuances the brief did not state.** The `.find` runs over the oldest **10** rows only (one
  group holds 24, outside the window entirely), and **`if (domain)` means an inbound with no domain
  searches the whole workspace** — the tier is not always same-domain.

## ENTC — junk80 censused (and it is not one class), `lcc_p195_unmerge` fixed not retired (2026-09-03)

Full record: `docs/audits/ENTC_JUNK80_AND_P195_UNMERGE_2026-09-03.md`. Migrations
`20261014120000` (p195 fix) + `20261015120000` (census). Guard
`test/entc-junk80-and-p195-unmerge.test.mjs` — 13 tests, **19/19 mutations RED**.
**Nothing was retired, renamed, merged or swept; the seeder is dry-run and unapplied.**

- **⚠️ BEFORE RETIRING A SUPERSEDED FUNCTION, CHECK THE POPULATION IT STILL OWNS — NOT THE DATE
  THE SUCCESSOR SHIPPED.** `lcc_p195_unmerge` was filed as redundant since P196 taught
  `lcc_merge_entity` to self-snapshot. Live: **66 open `lcc_p195_merge_log` rows, ZERO with a
  `lcc_entity_merge_log` row** — they ran hours before P196 landed, so `lcc_unmerge_entity`
  answers `no_open_merge_log_row` for all of them. Both ledgers start 2026-08-27, which is exactly
  why "redundant now" reads true and is false. **Retiring it would have made 66 live merges
  irreversible.** Fixed instead: P196's UPDATE-survivors + INSERT-only-deleted shape on both
  `entity_relationships` and `external_identities`, plus want-vs-have residue in a new `note`.
  Round trip on the Harrison pair, rolled back: **24/24, 0 lost, 0 stranded, `restored` 17 → 19,
  `note='restored'`** (before: 2 `brokers` edges left on the winner while reporting `restored=17`).
- **⚠️ A GUARD-DEFINED POPULATION IS NOT A CLASS — READ IT.** The 80 split
  41 `sweep_candidate` / 27 `hold_salesforce_identity` / **6 `hold_email_corroborated`** /
  4 `hold_inbound_reference` / 2 `hold_name_repairable`. The six that matter carry a ≥4-character
  name token **inside their own mailbox localpart** (`Eyal (Al) Elkayam`/`eyal@`, `Hunt`/`hunt@`,
  `Jackson`/`kjackson@`, `Lew (Doug) Hodge`/`louhodges5901@`) — **the row IS that mailbox's person
  and clearing its email is the harm, not the fix.** The detector fires on 6 of 80, not 0 and not
  80, and all six read correct on named rows. Two more are a real person behind a CoStar
  `Seller Contacts…` prefix — `stripContactLabelPrefix` already exists, so they are a **rename**,
  not a retire. Only `sweep_candidate` proposes an action; every hold seeds `uncertain` at
  confidence 0 so a confirm can never be a default.
- **⚠️ TWO WRITERS ON ONE CAPTURE HAD TWO DEFINITIONS OF "JUNK", AND THE WEAKER ONE MINTED THE
  ENTITY.** `upsertSidebarContacts` (the domain `contacts` table) has always dropped a candidate
  failing `isJunkContactName`; `unpackContacts` (the **entity** mint, via `ensureEntityLink`)
  applied only the TrafficMetrix street/label + fan-out detector. So a firm name, a section label
  or a CoStar verification sentence carrying a real mailbox minted a **person entity** — exactly
  what the email tier then resolves inbound people onto. `planContactMinting` now takes an
  **injected** `personJunkName` filter (injected, not imported: `sidebar-pipeline` imports
  `tm-misparse`, so importing back is circular and a second regex copy is normaliser drift), and
  the gate is **PERSON-ONLY** — `isJunkContactName` rejects firm suffixes by design, so running it
  on an organization candidate would block every legitimate company mint. Suppressed candidates go
  to the existing review path, never dropped.
  **Measured reach: 38 of the 80 names (47.5%), and 0 of the 6 corroborated real people.** The
  residue (`Taxes`, `Condo`, `Public`, `Canada`, `Government`, `User`) is caught only by
  `lcc_p131_is_document_row_label`, a SQL guard with no JS twin — so the gate halves the inflow
  rather than stopping it, and that is stated rather than papered over (`junk80-gate-p131`).
- **⚠️ THE REMEDY WAS UNREACHABLE FOR THE NEW HEURISTIC, AND THE TEMPTING FIX WAS A LIE.**
  `unstampMisparseMember` — clear `entities.email`, detach the conflated `external_identities`,
  snapshot both into `junk_review_batch` first, **touch no relationships** — is precisely what this
  class needs. It fired only for `review.heuristic === TM_MISPARSE_HEURISTIC`, so a junk80 row
  under its own heuristic would soft-retire **without** clearing the mailbox. Labelling these rows
  `tm_misparse` to reach that branch would have put a false fact in the ledger (they are vendor
  party-slot and P131 row labels). The gate is keyed on the **class** now —
  `EMAIL_CONFLATION_HEURISTICS`, i.e. *this row holds someone else's mailbox*, which is what the
  remedy is actually about.
- **⚠️ THE BRIEF'S TWO VERIFICATION TARGETS ARE IN TENSION AND THE PROTECTIVE ONE WINS.** Simulated
  confirm of the 41 `dismiss` rows: junk-oldest contested mailboxes **14 → 3**, but rows alone on
  their mailbox only **37 → 29**, because 23 of the 37 carry a Salesforce identity and the brief
  itself sends those to review. Driving `alone` to ~0 requires bulk-retiring the population the
  same brief protects. 35 mailboxes freed, 49 identities detached, **0 relationships touched**.
  ⚠️ The prior audit's **26** junk-oldest mailboxes was a HUMAN read; the guard-measurable figure
  on the same population is **14** — do not read 14 → 3 as 26 → 3.
- **The definer unmerge surface was narrowed in the same change.** `lcc_p195_unmerge`,
  `lcc_unmerge_entity` and `lcc_a2a_unmerge` were all reachable by `anon`/`authenticated` with
  **zero PostgREST callers** (censused across `api/`, `scripts/`, `test/`). Now `service_role`
  only — revoking from **both** `public` and the explicit Supabase default-privilege grants, and
  **asserted with `has_function_privilege()`** rather than read off the REVOKE.
