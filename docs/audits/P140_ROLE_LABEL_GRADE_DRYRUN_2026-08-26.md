# P140 — grading the dormant `OWNERSHIP_CHAIN_ROLE_LABELS` layer (2026-08-26)

**Status: dry-run endpoint shipped. The flag is UNCHANGED (`off`). Nothing was written.**
The grade is what decides the flip; this prompt builds the thing that produces the grade.

`GET /api/ownership-chain-draft-tick?role_labels=1&generate=1`
(optional `&sample=N`, default 18, max 25)

---

## What it does

Runs P131's optional **Layer 2** — the Ollama role-labeller that may LABEL a transfer type on a
chain link it *may not add, remove, reorder, re-date or re-name* — over a shape-spread sample of
real chains, and returns, per link:

* the link **as drafted** (grantor → grantee, date, price, `data_source`, `ownership_id`, `gap_before`),
* the proposed `role_label` and the model's one-line rationale,
* the **party-presence guard verdict** (`pass` / `fail` / `no_rationale`) and `would_apply`,
* the drop reason when it would be dropped.

No writes, no flag requirement, no flag change. Mirrors the P138 analyst-take `?generate=1`
grading path, which is likewise ungated and write-free.

---

## Three things measured live while building it, each of which changed the build

### 1. ⚠️ The obvious wiring would have graded ZERO rows and reported it as a clean run

The tick prepares its work from `fresh` — the open lane rows that do **not** yet carry a draft —
because that is what the write path needs. Measured on LCC Opps 2026-08-26:

| | |
|---|---|
| open `establish_ownership_history` rows | **545** |
| `lcc_clean_assist_proposals` rows, `source='ownership_chain_draft'` | **545** (all `proposed`, written 2026-08-26 15:50–16:02) |
| `fresh` (open ∧ undrafted) | **0** |

P131/P133 drained the lane in one pass, so a grade wired to `prepared` returns
`sample_taken: 0` — an empty grade block that renders **identically to a clean one**. This is the
house failure mode ("the failure that matters looks exactly like success") arriving in the
grading tool itself.

The fix is conceptual, not defensive: **Layer 2 labels a chain that already exists**, so an
already-drafted row is the *ideal* candidate, not an excluded one. The grade prepares from the
open lane (`candidate_source: 'open_lane_including_already_drafted'`, capped at 200 rows) and the
response names what it sampled, so an empty grade is diagnosable rather than silently reassuring.
Guarded by `test/ownership-chain-role-label-grade.test.mjs`.

### 2. A sample off the value-ranked head would grade one chain shape and call it accuracy

Shape distribution of the **453 draftable** open-lane chains, measured on gov
`v_ownership_transitions_portfolio` with the P138 guards re-applied (453 = the P131 figure, exactly):

| shape | properties | links | has a price |
|---|---:|---:|---:|
| `priced_transfer` (a real price — the arms-length candidate) | 173 | 229 | 173 |
| `single_link` (one unpriced link) | 133 | 133 | 0 |
| **`affiliate_name_overlap`** (grantor/grantee share a non-generic token — the SPE case) | **119** | 155 | 45 |
| **`nominal_price`** (≤ $100 — the classic non-arm's-length deed) | **22** | 50 | 22 |
| `multi_link` (unpriced, ≥2 links) | 6 | 14 | 0 |

**26% of the lane is the SPE/affiliate case and 5% is a nominal-consideration deed** — exactly the
two cases the grade exists to test (an SPE reshuffle must not read as an arms-length sale; a
$0/nominal transfer must be flagged non-arm's-length). `pickGradeSample` round-robins across shape
buckets, rarest-first, so neither can be starved by the 173 priced rows. It is deterministic, so
two grading runs are comparable.

**Scope note on the shape classifier:** it is for **sample selection only** — never identity, never
a write. That is why `affiliateNameOverlap` may use the loose, generic-token-stripping comparison
CLAUDE.md bans for identity (grouping-for-review ≠ identity-for-write, the `v_lcc_merge_candidates`
precedent). The buckets are named for what is **observable on the record** (`nominal_price`,
`priced_transfer`), never for the answer under test — a bucket called `arms_length` would pre-judge
the label being graded.

### 3. The grader and the applier are ONE decision, or the grade is of something that doesn't ship

`evaluateRoleLabel` is now the single owner of the per-label verdict.
`applyRoleLabels` (production) = evaluate + mutate; `gradeRoleLabels` (dry run) = evaluate + report.
Neither re-implements a predicate — the `lcc_mailbox_mirror_error_is_terminal` discipline (P119), and
a test asserts the two reach identical `applied` / `dropped` / `drop_reasons` on the same input.

Immutability is **proven, not asserted**: each sample fingerprints its deterministic chain, runs the
**real production applier** over a deep copy, and re-fingerprints (`chainFingerprint` covers exactly
the fields the model is forbidden to touch — date, both party names, price; `role_label`/`role_why`
are excluded, since those *are* the additive annotation). `chains_altered_by_layer2` must read **0**.

---

## How to read the output

| field | means |
|---|---|
| `summary.drop_rate` | dropped ÷ proposed. **A meaningful drop rate is the guard WORKING.** W8 U3 dropped ~52% (`quote_not_verbatim`) on this same gap and that rate was the finding. |
| `summary.party_presence_fail_rate` | the hallucinated-rationale rate **specifically** — kept separate from the drop total, because a single number would answer a different question. Evaluated for every resolvable index, even labels already dropped for another reason, so the guard's own rate is not measured only on labels that got past every other check. |
| `summary.chains_altered_by_layer2` | must be 0. Non-zero ⇒ do not flip. |
| `summary.providers` | which seam answered. A sample rescued by the cloud fallback is **not** a grade of the on-box layer the flag turns on. |
| `samples[].parse_failure` | "answered nothing usable" ≠ "proposed no labels". An abstention is a legitimate answer; a parse failure is not. |
| `samples[].would_render` | the labels that would actually reach the card. |
| `flag.forced_by_query` | `true` ⇒ the grade ran with the flag **off**. A populated grade block is not evidence the layer is live. |
| `budget_stopped` | a truncated grade says so rather than reading as a complete small sample. |

**Graded clean means:** labels accurate to each link's own facts (an SPE→parent transfer is not an
arms-length sale; a $0/nominal transfer is flagged non-arm's-length), the party-presence guard is
catching hallucinated rationales, `chains_altered_by_layer2 = 0`, `unknown`/abstention on genuinely
ambiguous links rather than a guessed type, and the on-box provider answered.

A live spot-check on gov property **9525** (a 5-link chain, 2005→2021) showed the guard also catches
a rationale describing the **wrong link** — a `sponsor_internal_transfer` label on index 2 whose
`why` named the parties of index 3 was dropped `why_names_unknown_party`. That is index/rationale
mismatch, not only invented parties, and it is caught for free.

---

## Not changed

* `OWNERSHIP_CHAIN_ROLE_LABELS` is still **off** in `feature_flags_registry`.
* The POST apply path still honours both flags exactly as before; the grade did not loosen it.
* No migration, no view, no verdict path, no auto-write. GET only, ships on the Railway redeploy.
* Layer 1 (the deterministic chain) is untouched — it remains the whole deliverable, with or
  without Layer 2.
