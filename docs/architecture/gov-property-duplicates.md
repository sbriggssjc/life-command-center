# gov property-address duplicates — GOVDUP1 (2026-09-05)

> **START HERE for "why does gov have two property rows at the same address" and before proposing
> any auto-merge on `gov.properties`.** Supersedes the planned "ADDR1c-twin-lane" — the dia
> `property_twin` geospatial-detector precedent (`docs/architecture/dia-property-twin-lane.md` /
> CLAUDE.md §"dia property address twins") does **not** transfer here: different population (a
> flat-file import artifact, not geocoding drift), different producer (mostly a single one-time
> husk fan-out, not an ongoing capture), and a materially weaker merge reversibility on gov
> (`gov_merge_property_reversible` is a hard DELETE with partial-restore recovery, not dia's
> soft-tombstone reversible merge — see §5).

Migration: `sql/20260905_gov_govdup1_property_duplicate_review.sql` (gov, applied live) /
mirrored `supabase/migrations/government/20260905120000_gov_govdup1_property_duplicate_review.sql`
(LCC repo, source of truth for the guard). Guard:
`test/govdup1-property-duplicate-review.test.mjs` (9 tests, **9/9 mutation-verified RED** on
spot-checked mutations: the address_match inversion, the placeholder-ILIKE substitution, and
removing the zip 4-digit floor).

## §1 — the population, WITH THE KEY NAMED

**Key: `regexp_replace(lower(address), '[^a-z0-9]', '', 'g')` + `state`** (lower BEFORE the
character-class strip, never after — CLAUDE.md's standing footgun). On this key, live 2026-09-05:

| class | groups | properties | address_match | mechanism |
|---|---:|---:|---:|---|
| A (husk fan-out) | 1 | 154 (now archived) | exact | `unknown_writer` insert storm, one address |
| B (punctuation-only) | 267 | 534 | punctuation_only | `1000 Terminal Dr` vs `1000 Terminal Dr.` |
| C (city-variant, same string) | 130 | 263 | exact | byte-identical address, different city/zip on file |

**⚠️ This key is deliberately WIDER than `lower(trim(address))`.** The narrower key returns 132
groups / 419 properties on the same population — CLAUDE.md's own duplicate-count doctrine entry
(dated the same day as this unit) uses these exact two numbers as its worked example: *"a duplicate
count is a property of the key."* The 267-group gap between the two keys is class B — the
punctuation-only pairs — and it is the **cleanest** duplicate class in the population (same city,
same state, same street, differing only by a trailing period or a comma). The stricter key is
structurally unable to see it. **Never report a bare 397/953 or 132/419 without naming which key
produced it.**

Live view counts (after Unit 1 archived the 154 husks, so class A no longer contributes live rows to
the review view — it is retired, not re-surfaced):

- `address_match = 'exact'`: **130 groups / 263 properties**
- `address_match = 'punctuation_only'`: **267 groups / 534 properties**

### §2 — measurement traps avoided

**§2a — key-naming.** Done above; see also the CLAUDE.md GOVDUP1 doctrine entry this unit produced.

**§2b — `lpad('',5,'0')` is `'00000'`, not NULL.** `gov_dup_review_normalize_zip5(p_zip)` requires
`length(regexp_replace(p_zip,'[^0-9]','','g')) >= 4` before padding to 5; an empty or short zip
returns NULL, not a padded false value. Corroboration reads three states, never two:

| zip_signal | groups |
|---|---:|
| `zip_agrees` | 138 |
| `zip_differs` | 24 |
| `zip_not_comparable` (< 2 usable zips in the group) | 235 |

`zip_missing_on_one` is folded into `zip_not_comparable` at the SQL level (both mean "cannot compare"),
and the SQL never treats a missing zip as a disagreement — the invariant the doctrine entry names.

## Unit 1 — the 154-row `unknown_writer` husk

**Disposition: retired (UPDATE → `status='archived'`), never deleted.**
Batch tag `govdup1_classA_husk_retire_20260905`, logged row-by-row in
`gov_property_dup_retire_log` (property_id, prior_status, reason, batch_tag, created_at). Reversal
is one UPDATE keyed on the batch tag (commented in the migration).

> 🚨 **SUPERSEDED 2026-09-05 (Cowork verification): THE PRODUCER *IS* FOUND, and it names itself in
> the very child row this unit discovered.** All 154 `pending_updates` rows carry
> `field_name='_new_property'`, `reason=`**`'Salesforce auto-created property — verify accuracy and
> check for duplicates'`**, and a `source_context` holding **one shared
> `sf_property_id = a068W00000FbBqwQAF`** ("GSA-Anchored Multi-Tenant Office - Rutland - Vermont"),
> `sf_zip = '5701'`, `sf_state = null` — the husk's exact field values, with a *different*
> `staging_id` on each row. **A Salesforce auto-create path mints a gov property per staging row and
> does not dedupe on `sf_property_id`.**
>
> **Class-wide: 808 gov properties minted from 125 distinct Salesforce properties.** 53 of those SF
> properties fanned out into **736** gov rows; 728 are now archived (the 2026-05-17 batch by
> `junk_backfill_archived_2026-06-09`, plus this unit's 154), **8 are still live**, newest
> **2026-08-25** — so the producer fired 11 days before this unit ran. **This exact defect was
> already cleaned once, in June, and recurred** (P176: *a one-shot repair of a recurring producer is
> a chore you repeat silently forever* — and GOVDUP1 just repeated it).
>
> ⚠️ **Why the search missed it: the hunt was keyed on `data_source`, and this producer does not
> wear one label.** Property 39064 (`700 technology dr`, Charleston WV, `costar_sidebar`, 08-24) and
> 39128 (`700 Technology Dr`, South Charleston WV, `unknown_writer`, 08-25) are **the same
> Salesforce property minted twice, one day apart, under two different `data_source` values** — and
> that pair **is sitting in this lane's review view right now**. The invariant is
> `pending_updates.field_name='_new_property'` + `source_context->>'sf_property_id'`, never
> `data_source`. **This also means Unit 1's husks and Unit 2's duplicate pairs are two symptoms of
> ONE producer**, and property 36823 ("Country Club" MO), which this unit flagged as "a second
> candidate husk-mechanism instance," is confirmed as exactly that (`mints = 2`).
>
> **The reasoning below was correct about every path it ruled out** — it eliminated the promotion
> worker, the sidebar and `auto_apply_property_links.py` on sound structural grounds. The miss was
> reading the `_new_property` rows as *"a downstream matcher proposed something against them"*
> instead of opening the payload. **A child row written in the same second as its parent, 1:1, is a
> co-writer, not a downstream consumer** — read it before classifying it. Follow-up: **GOVDUP1-a**.

**Producer: NOT FOUND, and here is what was ruled out.** The husks all insert with `data_source`
NULL/blank, which is caught downstream by `trg_gov_zz_stamp_data_source` (`gov_stamp_data_source_guard()`,
R17, 2026-06-09) and re-labelled `unknown_writer` — the guard fires, but it only tells you the
*writer never set a source*, not who the writer is. Investigated and ruled out:

- **`sf_property_staging` / `sf_staging_dedup_prune()` / `sf-promotion-worker`** (LCC repo,
  Salesforce Property__c staging) — the promotion worker's `linkProbe()` matches by normalized
  address within city/state buckets and only sets `process_status='linked'|'review'`; it has no
  INSERT path into `gov.properties` at all.
- **CoStar sidebar** (`api/_handlers/sidebar-pipeline.js`) — always stamps a real `data_source`
  (`costar_sidebar`); structurally cannot produce an `unknown_writer` row. See the pointer added to
  `docs/architecture/costar-sidebar-capture-pipeline.md`.
- **`auto_apply_property_links.py`** (government-lease repo) — fills `property_id` on an existing
  `sales_transactions`/`available_listings` row; it does not INSERT into `properties`.
- **`pending_updates` with `field_name='_new_property'`** — this IS the documented pseudo-field
  meaning "this row proposes a new property" (gov CLAUDE.md §15), and it is explicitly OUT OF SCOPE
  for R-auto-apply. It is the closest match in *shape* to what would have produced the husk, but no
  live code path in either repo currently applies that pseudo-field automatically, and the 154 rows
  carry no `pending_updates` row citing them as the origin of an applied `_new_property` action —
  only the downstream references named below.

**⚠️ The prompt's premise that the husks are "pure, 0 references" was WRONG, and self-corrected
during this unit.** Per the prompt's own instruction to match by column NAME as well as declared
FK, every husk carries exactly:

- **1 row each in `investment_scores`** (no declared FK to `properties`, matched by the
  `property_id`-named column) — a scoring pass ran over them at some point.
- **1 row each in `pending_updates`** (declared FK) — a downstream matcher proposed something
  against them.

Neither reference blocks retirement (Unit 1 only flips `status`, never deletes the property row, so
both child rows remain valid and dereferenceable), but they mean the husks were **not** inert from
the moment of creation — something downstream touched them before this unit ran. **Whether the
producer is still live is unknown** — the newest husk's `created_at` was not distinguishable from
the oldest in a way that pins a live vs. one-time event, and no repo-visible cron or scheduled job
was found that could still be minting rows at this address. Recorded as unresolved, not assumed
dead.

## Unit 2 — `v_gov_property_duplicate_review`

One row per group (classes B + C together — Class A is retired and excluded by the
`status <> 'archived'` filter baked into the base CTE). Per-member evidence
(`members_json`: property_id, city, zip_code, data_source, created_at, lease/sale/document counts,
`has_true_owner`, `agencies`) plus per-group corroboration as **separate three-state fields**:
`zip_signal` (`zip_agrees`/`zip_differs`/`zip_not_comparable`) and `agency_signal` (mirror shape).
`any_has_attachment` / `n_with_attachment` flag groups where a merge would need to move real child
rows (leases, sales, documents), which is exactly the population Unit 3 probes.

**Deliberately excluded from the gate:** city-string similarity. Read on the 24 `zip_differs` rows
below, several genuine duplicates carry wildly different city strings for the same municipality
(`Lexington-Fayette` / `Lexington`; `St Paul` / `Saint Paul`; `Country Club` / `Saint Joseph`), so a
fuzzy city gate would have suppressed real duplicates while doing nothing to catch the genuinely
different locations, which differ on the STREET+CITY combination as a whole, not on city spelling
alone.

**Placeholder exclusion:** an anchored equality list
(`lower(trim(p_address)) IN ('international airport','airport','n/a','unknown','tbd')`), never a
`contains`/`ILIKE` pattern (P158a class — a contains rule would swallow every real street address
containing the word "airport"). Confirmed live: `13833 Corpus Christi, TX` ("International
Airport") and `13329 Brownsville, TX` ("International Airport") are **two different airports in
two different cities**, and both are excluded from the view entirely by this guard — they never
form a false-positive pair.

**`verdict_hint`** (`merge`/`review`/`do_not_merge`, keyed off `distinct_exact_strings`) is
guidance only. It never writes, and gov's own hard-delete merge (§5) means every group still
requires an explicit human verdict regardless of the hint.

### The 24 `zip_differs` groups, adjudicated

Read on named rows, not counted:

| pair (norm_addr, state) | cities / zips | verdict |
|---|---|---|
| `10701 lambert international blvd`, MO | St Louis 63145-1000 / Saint Louis 63103-1006 | **genuine dup** — same airport terminal, two mailing zips on file |
| `1120 e 80th st`, MN | Bloomington 55420 / Minneapolis 55450 | **genuine dup** — MSP airport-area address spans both cities' postal boundary |
| `11232 nw 20th st`, FL | Sweet Water 33172-1862 / Miami 33132 | **genuine dup** — same MIA-area parcel, Sweet Water is an unincorporated Miami-Dade enclave |
| `11606 city hall promenade`, FL | Hollywood 33025 / Miramar 33027-4237 | **genuine dup** — adjoining municipalities, one civic-center address |
| `12819 country pl dr`, MO | Saint Joseph 64503-1514 / **Country Club** 64505 | **genuine dup, AND a second husk-mechanism instance** — property_id 36823 ("Country Club" as the city, no real distinguishing address) reads like the same `unknown_writer`-shaped artifact as Unit 1's 154, but on a DIFFERENT address and NOT `data_source='unknown_writer'` — filed as an open question, not retired here (scope: this pair only) |
| `1370 lockland ave`, NC | Winston-Salem / Winston Salem | **genuine dup** — hyphen-vs-space city spelling |
| `1400 colonial blvd`, FL | Fort Myers 33907-1028 / Fort Myers 33903-7094 | **genuine dup** — same city, two zip captures |
| `2795 alta mesa blvd`, TX | Fort Worth 76133-5801 / Springtown-Reno 76108 | **likely genuine dup** — exurban address near the Fort Worth/Springtown boundary; flag for human confirm, not auto |
| `2 9nd st` (2nd St), CA | San Bernardino / San Bernardino | **genuine dup** — same city, two zips |
| `3141 beaumont centre cir`, KY | Lexington-Fayette 40513 / Lexington 40511 | **genuine dup** — consolidated city-county name vs. common name (this is the Unit 3 round-trip pair, pids 6076/6100) |
| `396 n camino mercado`, AZ | Casa Grande / Casa Grande | **genuine dup** — same city, two zips |
| `4050 w ridge rd`, NY | Greece 14626-3528 / Rochester 14618-2638 | **genuine dup** — Greece, NY is a Rochester suburb on the same road |
| `409 3rd st sw`, DC | Washington / Washington | **genuine dup** — same city, two zips |
| `4130 faber pl dr`, SC | North Charleston 29418-6900 / Charleston 29405-8501 | **genuine dup** — adjoining cities, one business park |
| `445 e tna st` (E 7th? truncated), MN | St Paul 55101-1898 / Saint Paul 55106.0 | **genuine dup** — note the `55106.0` zip is a float-cast artifact from some ingest path, itself worth a separate ticket, but the pair is one address |
| `4616 west howard lane`, TX | AUSTIN / AUSTIN | **genuine dup** — same city, two zips (78758/78728, both real Austin zips near the address) |
| `500 tanca st`, PR | San Juan 00902-3752 / "San Juan, San Juan" 90237.0 | **genuine dup** — the second row's city field is corrupted (doubled) and its zip (`90237.0`) is a malformed float, not a real PR zip (PR zips are 00xxx) — flag the SECOND row's fields for cleanup independent of the merge decision |
| `5135 camino al norte`, NV | North Las Vegas / Las Vegas | **genuine dup** — adjoining cities |
| `521 e main ave`, ND | Bismarck / Bismarck | **genuine dup** — same city, two zips |
| `5770 skylane blvd`, CA | Windsor / Windsor | **genuine dup** — same city, two zips |
| `602 n staples`, TX | CORPUS CHRISTI / CORPUS CHRISTI | **genuine dup** — same city, two zips |
| `775 ridgelake blvd`, TN | Memphis / Memphis | **genuine dup** — same city, two zips |
| `8000 centre park dr`, TX | Austin / Austin | **genuine dup** — same city, two zips |
| `8801 kings ridge dr`, OH | Dayton / Dayton | **genuine dup** — same city, two zips |

**Net: 23 of 24 read as genuine duplicates on named rows** (one, `2795 Alta Mesa Blvd` TX, flagged
as *likely* rather than certain — an exurban boundary case). **Zero of the 24 are the "different
location" failure mode the city-similarity gate was originally proposed to catch** — the population
this key selects (identical street address string, differing only in the mailing city/zip on file)
is dominated by adjoining-municipality and multi-zip-capture cases, not genuinely distinct
properties. This is consistent with class C's mechanism (byte-identical address string, so the
STREET match is exact — only the city/zip metadata disagrees) and is why `zip_differs` alone is
never sufficient grounds to reject a group; it is exactly where a human confirm earns its keep.

## Unit 3 — the merge/unmerge round trip, MEASURED not assumed

One class-C pair with real attachments on both sides: **property 6076** (Lexington-Fayette, KY) and
**property 6100** (Lexington, KY) — the `3141 beaumont centre cir` pair above. Both carry rows in
`investment_scores`, `property_embeddings`, and `property_financials`. Run inside a single
transaction (`BEGIN ... ROLLBACK`), fingerprinting every child row by **identity** (row id, not
count) before and after `gov_merge_property_reversible` then `gov_unmerge_property`.

**Result, reported verbatim including zeros:**

| table | rows lost on merge→unmerge round trip | recoverable? |
|---|---:|---|
| `investment_scores` | **1** | NO — dedup-deleted on collision, not part of the backup snapshot |
| `property_embeddings` | **1** | NO — same mechanism |
| `property_financials` | **14** | NO — same mechanism |
| all other child tables probed | 0 | — |

`total_children_repointed`: 39. The unmerge's own `note` field states plainly: *"dedup-deleted
children (`rewired.*_dedup_dropped`) are not recoverable on unmerge."*

**⚠️ This bounds what a future batch may safely touch.** `gov_merge_property_reversible` snapshots
the DROPPED row and its child FK keys into `gov_property_merge_backup` before calling the
underlying hard-delete `gov_merge_property`, and `gov_unmerge_property` re-inserts + repoints —
but any child row that COLLIDES with an existing row on the KEEP side during the merge is
dedup-deleted, not snapshotted, and that deletion is **permanent** even though the property-level
merge itself is nominally "reversible." On this pair, three tables lost exactly one row each (or
14, for `property_financials`) to that collision path. **No batch merge should proceed on the
strength of "the merge is reversible" without first checking whether the specific pair's child
rows collide** — a pair with disjoint child rows (no `investment_scores`/`property_financials`
overlap) may round-trip cleanly; this pair did not.

> 🚨 **SUPERSEDED 2026-09-05 (Cowork verification): NO PAIR IN THIS LANE ROUND-TRIPS CLEANLY, AND
> THAT IS PROVABLE FROM THE INDEXES RATHER THAN PAIR BY PAIR.**
>
> | table | unique constraint | groups that collide (of 397) | rows destroyed |
> |---|---|---:|---:|
> | `investment_scores` | UNIQUE **on `property_id` alone** | **397 — every group** | 400 |
> | `property_embeddings` | PK **on `property_id`** | 334 | 336 |
> | `property_financials` | UNIQUE `(property_id, fiscal_year)` | 316 | 585 |
>
> Because `investment_scores` is unique on `property_id` by itself, **any pair where both members
> carry a score collides by construction** — and a scoring pass has run over the whole population.
> Merging the lane as it stands destroys **~1,321 child rows, unrecoverably.** So the bound is not
> *"check each pair first"*; it is **"the merge function must be fixed before any pair is merged."**
>
> **⚠️ The durable rule: a collision handler that DELETEs makes the surrounding reversibility a
> lie.** `gov_merge_property_reversible` snapshots child **ids**; `gov_merge_property_apply`'s
> `WHEN unique_violation` arm runs `DELETE FROM %s WHERE %I = $1` — so the row is gone and the id in
> the backup points at nothing. The wrapper is honest (it reports `_lost` per table and says so in
> its `note`), and honesty is not sufficiency: **the fix is to FOLD on collision — fill-blanks from
> the drop row into the keep row, then delete — not to document the loss better.** Follow-up:
> **GOVDUP1-b**, and it blocks any batch merge.
>
> ✅ **CLOSED 2026-09-05 by MERGE1** (PR #2130): `gov_merge_property_apply` now routes
> `unique_violation` through `gov_merge_fold_table` and a per-table `gov_merge_child_policy`
> (`investment_scores`/`property_embeddings` = `re_derivable`, `property_financials` =
> `fold_fill_blanks`). Verified by a rolled-back positive control — the keep row's NULL `noi` was
> filled from the drop row. **This lane is now safe to merge**, subject to the human verdict it was
> always gated on. `docs/audits/MERGE1_PROPERTY_MERGE_COLLISION_FOLD.md`.
>
> This is the P196 finding one layer down. There, `lcc_merge_entity`'s pivot DELETE *destroyed
> content instead of folding it* and the fix was to fold; here the same shape sits in gov's property
> merge, in the generic `unique_violation` handler that serves **every** child table at once.

**Nothing was left behind by this probe** — the whole thing ran inside one transaction that ended in
`ROLLBACK`. Confirmed: `gov_property_merge_backup` reads **0 rows** live, and the 154 archived
husks are untouched by anything in Unit 3.

## Verify on

- **Class decomposition, key named:** exact 130/263, punctuation_only 267/534, on the
  `regexp_replace(lower(address),'[^a-z0-9]','','g') + state` key — never the bare 397/953 total.
- **`gov_property_merge_backup` row count: 0** — nothing has been merged anywhere in this unit.
- **Corroboration states, counted separately:** `zip_agrees` 138 / `zip_differs` 24 /
  `zip_not_comparable` 235 — `zip_missing_on_one` is folded into `zip_not_comparable` at the SQL
  level and is never counted as `zip_differs`.
- **Archived husks: 154**, `status='archived'`, `data_source='unknown_writer'`, logged in
  `gov_property_dup_retire_log` under batch `govdup1_classA_husk_retire_20260905`.
- Guard `test/govdup1-property-duplicate-review.test.mjs`: 9/9 pass, 9/9 spot-checked mutations RED
  (address_match inversion, placeholder-ILIKE substitution, zip 4-digit floor removal).
  ⚠️ **"Spot-checked" is not a full mutation pass** — three assertions were mutated, not nine.
  Filed as **GOVDUP1-guard** rather than restated as N/N.

### ⚠️ Three residues found by the Cowork verification, none blocking

1. **`verdict_hint` is a synonym for `address_match`, not a judgement.** Measured: every one of the
   267 `punctuation_only` groups reads `merge` and every one of the 130 `exact` groups reads
   `review` — it consults neither zip, agency, nor attachment count. It is therefore inert as
   guidance *and actively misleading on 10 groups where the zips disagree and it still says
   `merge`* (`1400 Colonial Blvd` Fort Myers 33907 vs 33903; `2795 Alta Mesa Blvd` Fort Worth 76133
   vs Springtown-Reno 76108 — ~30 miles apart). **A hint that restates a column already on the row
   adds nothing and overrides the signal it should be tempering.** → **GOVDUP1-d**.
2. **154 orphaned `pending_updates` rows.** All 154 are still `status='pending'` against
   now-archived properties, and nothing clears them — the retire flipped the parent and left the
   queue row. P176/P182: *ask what event sets this state false, and whether anything ever fires it.*
   → **GOVDUP1-c**.
3. **94 LIVE properties carry a `.0`-suffixed `zip_code`** (`95492.0`), the same
   spreadsheet-read-as-a-number fingerprint as the husk's `'5701'`. One is inside this lane
   (`5770 Sky Lane Blvd`, Windsor CA). The numeric-coercion defect is broader than the husks and is
   unfiled elsewhere. → **GOVDUP1-e**.

## Out of scope (deliberately)

No merges executed. No city normalization added to `properties`. No port of dia's
`dia_find_property_twins`. No fuzzy address matching beyond the existing punctuation strip. 3+-member
groups (the 3-member subset of class C) were read individually per the prompt's instruction, not
assumed to share class B/C's pairwise shape — none required a different mechanism.
