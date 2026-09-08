# UX-T1c — Decision Center bucket audit: static census (2026-09-08)

**2026-09-08 · LCC repo (no DB access this pass — see §5 for the live-verify queries someone with
Supabase access still needs to run).**
Backlog row: `docs/os/PLANNED-BACKLOG.md` — **UX-T1c** / **UX44**: *"human-required vs
code/Ollama-resolvable, one-click resolution per bucket. Builds on P134/P137/P139 grading."*

> **Scope of this pass.** This is the STATIC half only: enumerate every Decision Center lane,
> confirm the two lane-registries agree, and — for every lane — say whether a prior round already
> graded it (measured its precision/consumer/throughput) or whether it has never been looked at.
> **It does NOT touch live data.** Open-count, real-verdict-count and drain-rate for the fifteen
> ungraded lanes are unmeasured; §5 lists the exact queries the next pass needs to run them. Per the
> repo's own doctrine (`CLAUDE.md` §00, BUILD-TURN-PROTOCOL): *"measure before concluding"* — this
> pass concludes only what can be concluded without a database.

---

## 1. The two lane registries — NO DRIFT FOUND

`api/admin.js` `FEDERATED_DECISION_TYPES` (line 7335) and `ops.js` `_DC_FEDERATED` (line 1856) are
the two places a federated Decision Center lane must be registered — both carry inline comments
saying *"Keep in sync with … (test/decision-center-partition.test.mjs)"*, so this was checked as
the first thing, expecting to find at least one drift (the comments exist precisely because past
lanes have drifted). **They do not drift today.** Both sets hold the same **28** lane names, with no
extras on either side:

```
admin.js FEDERATED_DECISION_TYPES : 28 unique entries
ops.js   _DC_FEDERATED            : 28 unique entries
in admin.js, not in ops.js        : {}  (empty set)
in ops.js, not in admin.js        : {}  (empty set)
```

The 28 lanes (order as they appear in `admin.js`):

```
junk_entity_review, w8_u3_link_review, naming_hygiene_review, reachability_harvest_review,
contact_acquisition_review, comms_owner_attribution_review, owner_contact_attach_review,
tier0_owner_contact, intake_disposition, property_merge, provenance_conflict, property_twin,
pending_update, cms_link_suspect, implausible_value, merge_duplicate_entities, caprate_review,
bad_rent_lease, resolve_owner_parent, listing_event_action, resolve_ownership, loan_maturity,
contact_company_link, owner_reconcile, sf_link_candidate, agency_risk_action, npi_dedup_review,
npi_dedup_autoapprove
```

**No parity fix was needed or made.** `test/decision-center-partition.test.mjs` (not re-run here —
no `npm test` was executed this pass; the census above was done by direct set-diff of the two
literal arrays) is presumably what keeps this in sync, and on this reading it is working. This is
worth recording precisely because the backlog row's premise ("audit the buckets") could have led
someone to assume the registries themselves needed the fixing; they don't.

---

## 2. Prior-grading census — 13 graded, 15 ungraded

For every lane, `CLAUDE.md` (repo root, the durable-invariants file — **not** the archived
`docs/history/CLAUDE_full_2026-07.md`) was grepped for the literal lane name, then each hit was read
to confirm it is a genuine grading (a round that measured the lane's precision, consumer, or
throughput) rather than a passing mention.

| lane | in admin.js | in ops.js | prior grading citation |
|---|:-:|:-:|---|
| `tier0_owner_contact` | ✅ | ✅ | **GRADED** — P186→P188→P194→P196→P197→P198, twelve rounds; precision curve (~91% at $16M+ rent, ~60-70% at $2M), park reasons, employer resolver, prefix-8 arm measured on named rows |
| `property_twin` | ✅ | ✅ | **GRADED** — built 2026-08-14 with a self-measuring accuracy view (`v_lcc_property_twin_assist_accuracy`); Prompt 106 deterministic pre-rank + Ollama assist, graded on evidence quotes |
| `loan_maturity` | ✅ | ✅ | **GRADED** — UX-T1a-gates (2026-09-03): coverage gap closed (0→172 rows/109 owners), attribution-vs-value ordering bug found and fixed, dedup-key collision with the domain `v_loan_maturity_watch` fan-out measured |
| `w8_u3_link_review` | ✅ | ✅ | **GRADED** — P131/P140: measured at **~52% hallucinated citations** (`quote_not_verbatim` drop rate) on the ownership-chain gap; P140 built a gradeable dry-run mode before flipping any flag |
| `property_merge` | ✅ | ✅ | **GRADED** — P134 (2026-09): the lane's grouping view (`v_property_merge_lane`) was found to disagree with a re-derived GROUP BY (150 vs 2 members on one group), fixed by appending `member_property_ids` to the view directly |
| `provenance_conflict` | ✅ | ✅ | **GRADED** — P137/P139: the lane's two sub-populations (`field_provenance` vs dia sales-price xref) were found ranked on incomparable scales so one always starved the other; fixed with an interleave key |
| `reachability_harvest_review` | ✅ | ✅ | **GRADED** — P136 (Dead-End Audit Playbook class "worker whose cursor is its own output"): 16 review rows *ever*, 0 in 11 days behind a ~15k pool, fixed with a negative-marker cursor |
| `contact_acquisition_review` | ✅ | ✅ | **GRADED** — W9.1: Stage 1 (internal sources) built and reasoned about; Stage 2 (SOS-direct) is the separate, extensively-graded §25 bot-wall saga in the government-lease repo |
| `owner_contact_attach_review` | ✅ | ✅ | **GRADED** — Prompt 114 / P114: shape-aware three-verdict split built specifically because the naive "confirm" reading of the source lane (Prompt 111) was measured at 77% organization-shaped, mostly transaction counterparties, not decision-makers |
| `sf_link_candidate` | ✅ | ✅ | **GRADED** — W4.3/W4.4 (splink batch, ~0.85 probability population) plus C1 (2026-08-27): the lane's own consumer coverage was measured against the two SF research lanes it was thought to duplicate |
| `owner_reconcile` | ✅ | ✅ | **GRADED** — W3.2 (audit 3.2.3): three folded source queues, each individually reasoned about; feeds `entity_match_labels` as a training corpus, itself a form of ongoing self-grading |
| `pending_update` | ✅ | ✅ | **GRADED** (gov side) — §15 of the government-lease `CLAUDE.md`: the auto-apply consumer for this exact decision type was measured and found to have **no genuine high-confidence backlog to recover** (the apparent 496 rows were exclusion classifications, not property matches) |
| `junk_entity_review` | ✅ | ✅ | **GRADED** — W8 U1 original build, then re-graded twice: P176 (seed-predicate re-mint) and ENTC (2026-09-03, the 80-row junk census with five distinct sub-classes, three of which must NOT be swept) |

**Ungraded — no round in `CLAUDE.md` measures this lane's precision, consumer, or throughput:**

| lane | in admin.js | in ops.js | status |
|---|:-:|:-:|---|
| `naming_hygiene_review` | ✅ | ✅ | UNGRADED — built (W8 U5) and never re-measured since |
| `comms_owner_attribution_review` | ✅ | ✅ | UNGRADED — built (W9.6, has a design dry-run doc `W9_6_comms_owner_attribution_dryrun_2026-08-13.md`) but not graded in `CLAUDE.md`'s durable-invariants sense (no precision/consumer measurement recorded there) |
| `intake_disposition` | ✅ | ✅ | UNGRADED — the OM-intake *pipeline* is heavily graded (W53, P194, the channel-provenance saga) but the `intake_disposition` **decision lane itself** (the human-facing bucket) has no citation |
| `cms_link_suspect` | ✅ | ✅ | UNGRADED |
| `implausible_value` | ✅ | ✅ | UNGRADED |
| `merge_duplicate_entities` | ✅ | ✅ | UNGRADED — note this is distinct from the *entity identity & dedup* invariants section (P189→P195→N15c…), which governs the merge MACHINERY (`lcc_merge_entity`) this lane calls, not the lane's own candidate quality |
| `caprate_review` | ✅ | ✅ | UNGRADED — built R43; no re-measurement found |
| `bad_rent_lease` | ✅ | ✅ | UNGRADED — built R43 alongside caprate_review; same |
| `resolve_owner_parent` | ✅ | ✅ | UNGRADED — built R47; no re-measurement found |
| `listing_event_action` | ✅ | ✅ | UNGRADED — built R48; no re-measurement found |
| `resolve_ownership` | ✅ | ✅ | UNGRADED — the 2026-06-30 consolidation round is described in the `admin.js` header comment (it retired three overlapping lanes: `owner_source_conflict`, `suspected_sale`, the ownership-discrepancy slice of `pending_update`) but **no subsequent round in `CLAUDE.md` measured the consolidated lane's own precision or drain rate** — contrast with `establish_ownership_history` (a *research task* lane, not this Decision Center lane), which got the full A1→A2→A2a→A2b→A3→A4→A4b treatment |
| `contact_company_link` | ✅ | ✅ | UNGRADED — built Phase 1b (2026-07-21); no re-measurement found |
| `agency_risk_action` | ✅ | ✅ | UNGRADED — W5.2; UX-T1a measured that the Today-BD-tile *label* for this signal type is disconnected from any real emitting view, but that is a different surface (`v_lcc_bd_worklist`/`renderTodayBdActions`), not this Decision Center lane |
| `npi_dedup_review` | ✅ | ✅ | UNGRADED — W5.2 |
| `npi_dedup_autoapprove` | ✅ | ✅ | UNGRADED — W5.2 |

**Total: 13 graded / 15 ungraded**, of 28 lanes.

Two things worth flagging about this split before anyone reaches for it as a priority order:

- **"Ungraded" is not "empty" and not "wrong."** Every one of these fifteen shipped with its own
  producer/consumer/value-gate reasoning at build time (readable in the round comments inside
  `api/admin.js` and `dc-lanes.js`) — what's missing is a *later* round that came back and measured
  whether that reasoning held up against real usage, the way P188→P198 did for `tier0_owner_contact`
  or P131→A4b did for the ownership-chain research lane. Per this repo's own repeated finding (A5,
  A5a, C1, P196…), a lane's *design-time* reasoning is frequently wrong in a specific, measurable way
  once real rows are read — so "ungraded" should be read as "unverified," not "presumed fine."
- **The W5.2 trio** (`agency_risk_action`, `npi_dedup_review`, `npi_dedup_autoapprove`) is a
  plausible first target for a live-verify pass: three lanes shipped in one round, sharing one
  "signal → task automation" design doctrine, none re-measured since. If one has a defect the others
  are likely to share it (the recurring "hazard travels with the technique" pattern this repo's
  CLAUDE.md documents repeatedly for merge-detector normalizers, name comparators, etc.).

---

## 3. One-click vs navigate-away — read from `dc-lanes.js` `_DC_FED_META`

Every one of the 28 lanes has a `_DC_FED_META` entry (title + intro) and a card renderer inside
`_fedCardHTML()` (`dc-lanes.js`). This section reports, from reading the renderer, whether a verdict
can be entered **on the card itself** (a `dcFed(i, 'verdict')` button) or whether the card's primary
action **navigates to a second screen** first.

**One-click on the card (inline `dcFed(...)` verdict buttons, no navigation required):**
`intake_disposition` (for the `matched`/`noise` classes — `create_candidate` also offers a one-click
`create_property`), `property_twin`, `resolve_ownership`, `merge_duplicate_entities` (a `<select>`
lets the operator pick the surviving record inline, then one click), `caprate_review` (apply/keep are
one-click; "Open property" is offered but not required), `cms_link_suspect`, `implausible_value`,
`resolve_owner_parent`, `listing_event_action`, `contact_company_link`, `owner_reconcile`,
`sf_link_candidate`, `agency_risk_action`, `npi_dedup_review`, `npi_dedup_autoapprove`,
`junk_entity_review`, `naming_hygiene_review`, `reachability_harvest_review`,
`contact_acquisition_review`, `comms_owner_attribution_review`, `owner_contact_attach_review`,
`w8_u3_link_review`, `tier0_owner_contact`, `provenance_conflict`, `pending_update`.

**Requires navigation to a second screen before a verdict can be entered:**
- **`property_merge`** — the only inline actions are `not_duplicate` / `research`; the primary
  action, `Compare & merge →`, calls `openUnifiedDetail(...)` to open the full property panel, and
  the actual merge happens from there (a "consolidate flow," per the lane's own `_DC_FED_META`
  intro: *"Merge is destructive (keep/drop is a BD judgment) → route to the existing consolidate
  surface; the inline verdicts are the safe ones"* — a deliberate design choice, not an oversight).
- **`bad_rent_lease`** — the primary button is `Open property / lease →`
  (`openUnifiedDetail(...)`), because the fix (correcting the rent figure) has to happen at the
  source lease record; the card's own inline actions (`mark_fixed`, `confirm_right`, `research`)
  are for AFTER that external correction, not a substitute for it — the lane's own intro says so
  explicitly: *"Fix the rent AT SOURCE (never auto-corrected)."*

Both two-screen cases are DELIBERATE per their own `_DC_FED_META` copy, not accidental gaps — worth
stating plainly so a future "make everything one-click" pass doesn't try to collapse them.

---

## 4. Trivial parity fixes found

**None.** §1 found zero drift between the two lane registries, so there was nothing to fix at that
level. No other one-line parity gaps were found in the scope reviewed (the two registry arrays and
the `_DC_FED_META` map, which is complete for all 28 lanes — checked by grepping every lane name
against `dc-lanes.js` and confirming a `_DC_FED_META[...]` entry exists for each).

---

## 5. Live-verify queries needed for the next pass (NOT run here — no DB access)

The fifteen ungraded lanes each need, at minimum, an open-count and a lifetime-real-verdict-count
before anyone can rank them for a redesign pass. Per this repo's own repeated finding (A5, A5a,
P159a, `already_annotated`…), **never trust a lane's own tally or a green cron** — assert on the
state delta of the underlying source table/view, and check who/what actually WRITES a terminal
status before crediting it as a "completion." The queries below follow that discipline: they read
the source view/table each lane's admin.js verdict-dispatch branch actually touches, not a proxy.

| lane | source (view/table) | open-count query sketch | real-verdict check |
|---|---|---|---|
| `naming_hygiene_review` | `v_naming_hygiene_review_open` (LCC Opps) | `select count(*) from v_naming_hygiene_review_open` | check `lcc_naming_hygiene_apply_log` (or equivalent ledger named in the round) for verdict rows, split by who/what set them — human UI vs a bulk sweep |
| `comms_owner_attribution_review` | `v_comms_owner_attribution_review_open` (LCC Opps) | as above | `comms_owner_attribution_apply_log` |
| `intake_disposition` | staged intake table feeding `intake_disposition` (grep `api/admin.js` verdict dispatch for the exact source) | count by `klass` (`matched`/`noise`/`create_candidate`) | check whether `create_property`/`dismiss`/`reextract` verdicts are ever recorded, and at what rate vs the intake volume — cf. the W53/P194 channel-provenance findings, which suggest this producer's *quality* is already well-understood even if this specific lane's throughput isn't |
| `cms_link_suspect` | the un-truncation pass's flag table/view (dia) | `select count(*) …` | verdict ledger for `confirm`/`unlink`/`research` |
| `implausible_value` | the magnitude-soft-ceiling review table (grep `admin.js`) | `select count(*) …` | verdict ledger; note P157/P182-style caution before trusting any "clean" zero here — positive-control it |
| `merge_duplicate_entities` | `v_lcc_merge_candidates` filtered to `auto_mergeable`-adjacent review rows (LCC Opps) | `select count(*) …` — ⚠️ this view has documented normalizer blind spots (P189, N15c) so a raw count may under-report | `lcc_entity_merge_log` — but note P196's caution: check the merge is REVERSIBLE-since date, pre-P196 tombstones can't be un-done |
| `caprate_review` | the parked cap-rate recompute table (R43) | `select count(*) …` | `apply`/`keep_old`/`needs_rent_fix` verdict ledger |
| `bad_rent_lease` | the R43 bad-rent flag population | `select count(*) …` | `mark_fixed`/`confirm_right` verdict ledger — and separately, whether a `mark_fixed` card's lease was ACTUALLY corrected at source (a completion that doesn't verify the underlying fix would repeat the A2/A5 "false completion" trap) |
| `resolve_owner_parent` | the R47 sponsor-cluster source (gov+dia unresolved LLC/LP shells) | `select count(*) …` | confirm/name-yourself/independent verdict ledger |
| `listing_event_action` | `lcc_listing_events` unprocessed slice | `select count(*) from lcc_listing_events where processed_at is null` (or the equivalent flag — confirm exact column) | verdict ledger; check `processed` means a human acted, not an auto-sweep (P119/P121-style anchor-on-durable-fact caution) |
| `resolve_ownership` | `v_ownership_resolution` (gov) | `select count(*) …` | verdict ledger for `update_owner`/confirm-sale/`keep`/`research` — and specifically compare against the retired `owner_source_conflict`/`suspected_sale` lanes' historical completion rates as a sanity check, the way A5 did for the research-task ownership lanes |
| `contact_company_link` | `v_lcc_contact_company_link_candidates` (LCC Opps) | `select count(*) …` | `link`/`not_a_match`/`research` verdict ledger |
| `agency_risk_action` | gov agency risk composite table + `processed_at` seam (§21 of `CLAUDE.md`) | `select count(*) from agency_risk_signals where processed_at is null and risk_level='high'` (per the seam description) | verdict ledger; cross-check against UX-T1a's finding that the Today-tile LABEL for this signal is disconnected from `v_lcc_bd_worklist` — confirm whether that finding also implicates this Decision Center lane or only the Today tile |
| `npi_dedup_review` | dia duplicate-NPI `data_error` cluster population | `select count(*) …` | confirm/not-duplicate verdict ledger |
| `npi_dedup_autoapprove` | dia duplicate-NPI `auto_resolvable` cluster population | `select count(*) …` | approve/reject verdict ledger — check whether "approve" spawns the reconcile task AND whether that task is ever actually completed (two-step completion, same trap as A2's partial-apply issue) |

**General instruction for whoever runs this pass:** before ranking any of the fifteen, re-read
`CLAUDE.md`'s Consumption-Layer doctrine (rule 5, "Honest counts") and the A5/A5a/C1 sections in
full — every one of those found that a lane's *apparent* open-count or completion-count was
measuring something structurally different from what it looked like (a query-window truncation, an
auto-close mislabeled as human work, a status set once in bulk). Assume the same is possible here
until checked.

---

## 6. Backlog update

`docs/os/PLANNED-BACKLOG.md` row **UX-T1c** updated in this pass: static census done 2026-09-08
(registry parity confirmed, 13/15 graded/ungraded split established, one-click-vs-navigate mapped);
the live-verify pass (§5 above) and the per-lane one-click redesign are still open.
