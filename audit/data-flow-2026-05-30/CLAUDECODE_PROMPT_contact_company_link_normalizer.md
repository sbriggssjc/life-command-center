# Claude Code (LCC) — widen the contact→company auto-tier with an iterative name-core normalizer

Phase 1b shipped and worked (887 owners connected, $73.2M). This is the follow-on that
drains most of the review lane it produced. **Every number below is measured live on LCC
Opps (`xengecqvemvfknjvbvrq`) on 2026-07-21 — not projected.**

---

## What's actually in the lane

`v_lcc_contact_company_link_candidates` currently holds **799 candidates carrying $238.6M**
in owner `rank_value` (40 ≥ $1M). It is a **federated** lane — it lists live from the view
and mints a `lcc_decisions` row only at verdict time. That is correct and should stay;
`contact_company_link` has zero rows in `lcc_decisions` today, which is the intended state,
not a bug.

The lane is not one population. It splits cleanly:

```
n_candidate_orgs = 1  (unambiguous)   634    $180.4M    27 ≥$1M
n_candidate_orgs > 1  (real judgment) 165     $58.3M    13 ≥$1M
```

The multi-candidate tier is genuinely hard and **must stay human** — e.g. `T Scott ·
Cambridge Holdings LLC` offers **six** Cambridge orgs, five with no rent. Do not touch it.

The single-candidate tier is mostly not ambiguous at all. It failed exact-core matching
only on legal suffixes, a leading `The`, a parenthetical, or a ` | ` dual affiliation:

- `Blake Real Estate` ↔ `Blake Real Estate Inc`
- `Xenia Management Corp` ↔ `Xenia Management`
- `Kingsbarn Realty Capital` ↔ `Kingsbarn Realty`
- `Claremont Group Llc | Brewran Islip` ↔ `The Claremont Group`
- `Merlin Management Company | Northwind Development LLC` ↔ `Merlin Management`
- `HC Government Realty Trust Inc` ↔ `HC Government Realty Trust`

## The measured fix

Applying an **iterative** suffix strip (repeat until stable), plus parenthetical removal and
` | ` split, to **both** sides:

```
auto-resolvable      347 of 634    $114.3M    18 ≥ $1M
remains for review   452 total     (287 single + 165 multi)
```

**Note the trap I hit first:** a single-pass regex anchored at `$` strips only ONE trailing
token, so `Claremont Group Llc` stalls at `claremontgroup` and never matches `claremont`.
That single-pass version recovers only 232. **The strip must loop until the string stops
changing.**

Suffix set used in the measurement (case-insensitive, trailing, repeated):
`inc llc lp llp ltd corp corporation company co trust group holdings partners properties
props realty "real estate" management mgmt associates enterprises capital development
developers`
Plus: leading `the`, `\(.*?\)` parentheticals, everything before the first `|`, then
`[^a-z0-9]` removal.

**False-positive check came back clean.** I grouped every match at core length 4–9 and
inspected: no cross-firm collision. All collapses are the same firm with descriptor noise
removed. The `n_candidate_orgs = 1` gate is what makes this safe — the Cambridge-style
multi-org rows never enter this tier.

Most aggressive rule is paren-stripping (`EMR Land Co` ↔ `EMR Land Co (formerly Elk
Mountain Ranch)` — correct, but worth knowing). Keep it; it is gated behind single-candidate.

---

## What to build

### Unit 1 — one iterative normalizer, in the shared helper

Add the iterative strip to the **existing** name-core helper — `lcc_normalize_entity_name`
/ the ORE core normalizers / `api/_shared/owner-cross-reference.js` as appropriate.
**Do not write a fifth normalizer.** If an existing helper can gain an `aggressive` /
`stripDescriptors` mode, prefer that over a new function.

It must be usable from **both** SQL (the view) and JS (the resolver), so the two tiers can
never drift. If that means a SQL function plus a thin JS mirror, add a test asserting they
agree on a shared fixture list.

### Unit 2 — widen the auto tier in the view

In `v_lcc_contact_company_link_candidates`, classify a row as auto-appliable when:

- `n_candidate_orgs = 1`, **and**
- iterative-strip core equality between `company_name` and `owner_org_name`, **and**
- core length ≥ 4 (the measured-safe floor), **and**
- the existing junk / implausible-name / tombstone guards still pass

Everything else stays in the review lane. Preserve column order (append only).

### Unit 3 — apply the 347, reversibly

Run the linker over the newly-auto tier using **`linkPersonToEntity`**
(`api/_shared/contact-attach.js`) — the same helper Phase 1b used. Dupe-guarded,
`associated_with` / `works_at`, `metadata.via='contact_company_link:<batch_tag>'`.

**Dry-run first and report** before applying: `edges_would_create`,
`owners_gaining_first_contact`, `owners_ge_1m`, `rent_covered`, `remaining_in_lane`.

### Unit 4 — fix it forward, not just the backlog

Point the ingest-time resolver at the same normalizer so a new contact matches on arrival
rather than accumulating in the lane. This is the actual lesson from this thread: the
account backfill produced data without firing its consumer, and Tier A seeding sat at 108
because nothing re-ran it. **Fix the mechanism, not only the current backlog.**

---

## Boundaries

LCC-Opps only · no SF writes · no dia/gov writes · reuse `linkPersonToEntity` and an
existing normalizer — **do not fork a matcher** · multi-candidate rows are never
auto-applied · every edge reversible by `metadata.via` batch tag · no new `api/*.js` ·
keep `test/decision-center-partition.test.mjs` green (`contact_company_link` is federated
and must stay out of the seeded set).

## Verify

1. `npm run check:boot`, `npm run verify:deploy`, full suite.
2. Dry-run report first — expect ~347 edges / ~$114M. If it materially exceeds that,
   **stop**: the normalizer is over-collapsing. Report rather than applying.
3. Sample 10 applied pairs across the core-length range and confirm each is genuinely the
   same firm.
4. Lane count drops 799 → ~452, and the ≥$1M subset drops 40 → ~22.
5. Queue refresh stays low single-digit seconds:
   `select duration_ms from lcc_refresh_log where refresh_name='lcc_refresh_priority_queue_resolved' order by refreshed_at desc limit 5;`
6. Rehearse reversal on the batch tag.
7. Report the contactless-worklist shift (currently **3,202**).

## Context worth carrying

The Tier A institution fan-out was drained today: 114 owners attached, 0 failed, 0
remaining. Measured multiplier was **1.06×** (108 sponsors → 114 attachments), because the
"institutions" are mostly individuals and small LLCs, not sponsors with SPE portfolios.
Real fan-out happened only for Global Net Lease (8), Xenia (3), Princeton Holdings (2),
USAA (2). **The company-resolution path in this prompt is the higher-yield mechanism by an
order of magnitude** — worth weighting accordingly if a trade-off comes up.
