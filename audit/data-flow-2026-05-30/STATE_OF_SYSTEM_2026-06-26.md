# LCC — State of the System + Value-Ranked Remaining Gaps (end-to-end sweep, 2026-06-26)

Grounded live across LCC Opps (`xengecqvemvfknjvbvrq`), Dialysis_DB
(`zqzrriwuavgrquhisnoa`), gov (`scknotsqkcheojiaewwh`). Supersedes the running
status in SURFACE_WALK_ROADMAP_2026-06-23.md.

## TL;DR

The system is now **connected, fresh, value-ranked, and operationally healthy**.
The audit/build campaign (R4–R64, UI Phases 0–5, the CMS + disk fixes) did its
job: the foundations are sound. **The one thing still near-zero is the outreach
loop — the conversion of all this intelligence into actual BD touches.** That is
the highest-value remaining work because it is the literal point of the engine.

## WHERE WE STAND — healthy / shipped (verified live today)

- **Disk crisis fully resolved.** LCC Opps DB **9.85 GB → 4.23 GB**; inline
  artifacts offloaded (0 remain); well under the 11/12.5 GB disk-pressure
  thresholds. The auth-lockout risk that caused two near-misses is gone.
- **Feeds are current.** gov sales `2026-06-26`, GSA events `06-22`; dia clinics
  + sales `06-25`; active listings gov 577 / dia 557. CMS ingestion fixed
  (4.8h→35min, no hang, patient_counts batched); the only "stale" patient data is
  correctly periodic (CMS publishes ~annually; newest real period ~Mar 2025) and
  is now honestly labeled on the dia Overview.
- **Value-ranking is solid.** Priority queue ~1,131 rows. Touch/relationship
  bands (P1–P8, P-BUYER) **100% value-ranked** (0 rank-zero; P-BUYER top $169M).
  Connect bands (P0.4 537, P-CONTACT 165, P0.5 104) ranked at the top with
  genuine value-less orphan tails (R17 — correct, not noise).
- **Cadence universe is clean.** 909 total, **691 noise paused** (R63), **218
  active, 197 (90%) reachable** with a contact (R16/R20). The population is now
  real BD relationships, not capture noise.
- **Decision Center is bounded + honest.** ~454 open verdict-lane decisions
  (confirm_true_owner 175, junk_entity 199, match_disambiguation 32,
  sf_link_collision 30, map_sf_parent 11, sf_link_conflict 6, confirm_buyer 1),
  value-ranked; auto-resolve (R64) working; federated DQ backlogs kept off the
  badge.
- **Research backlog drained + gated.** 5,447 → 2,671 queued (R60 value-gate +
  auto-close holding).
- **Data integrity work landed.** Cross-DB mirrors reconciled (R22/R23/R35),
  entity dedup + merge-orphan reconcile (R39/R40), cap-rate framework, deed/lease
  OCR pipeline + R59 propagation all built and verified.
- **UI.** Phases 0–5 + zoom 4A/4B/4C shipped; dia↔gov Overview parity + tab/IA
  unification + the Owners-Missing-Contact worklist live.

## WHAT'S LEFT — value-ranked

### #1 (HIGHEST) — The outreach loop does not close
This is the conversion point of the entire system, and it is near-zero.
- **Live evidence:** 218 active cadences, 197 reachable. In the last 60d there
  were **96 Salesforce outreach events** (52 note / 23 call / 21 email) — Scott
  IS doing outreach and it IS being ingested. **58 of those 96 landed on an
  entity that has an active cadence**, 15 on a cadence's contact. **Yet only 7–9
  cadences have EVER advanced** (`last_touch_at`), 7 in the last 30d, 0 converted.
- **Root causes (to confirm + fix):** (a) **most SF outreach is logged as plain
  Tasks → category `note`**, and the advance trigger skips `note` — the
  OUTREACH#1 `deriveSfCategory` (infer email/call from the Task subject) and
  NBT-Phase-2 work either isn't deployed or isn't catching them; (b) even the
  call/email events landing on cadence-bearing entities aren't advancing — the
  SF-activity → entity → cadence bridge (entity-resolution + the asset→owner /
  contact hop) isn't connecting in practice. Net: the system computes who to
  contact, the operator contacts them in SF, and the loop never registers it.
- **Why it's #1:** everything upstream (fresh data, value rank, reachable
  cadences) exists to drive outreach. Until SF activity reliably advances
  cadences (and the dashboard reflects real touches), the BD engine's output is
  invisible. Recommend this as the next build: ground the SF-activity→cadence
  advance end-to-end on the 58 cadence-entity events, confirm deployment, fix the
  note-Task categorization + the bridge resolution.

### #2 — Free-attach contact drain (pending deploy, PR #1350)
88 high-value owners already have a named decision-maker identified; the fix to
drain them is built and awaiting Railway redeploy. Connects 88 owners for free.
Verify the live drain post-deploy (`active_contact_entity_id` populates, they drop
off the worklist).

### #3 — Document OCR/extraction backlog not drained
The R58/R59 deed+lease extraction pipeline is built but the backlog is sitting:
**gov 961 docs (237 deeds) + dia 1,086 docs (129 deeds) with `raw_text` NULL.**
Draining it (the `document-text-tick` + lease OCR workers, with the Document AI /
OPENAI key configured) unlocks deed→ownership/sale propagation (R59) at scale —
real ownership + comp data currently locked inside un-OCR'd PDFs. Bounded,
high-value, no new build — it needs the workers actually run.

### #4 — Contacts long tail (deferred)
3,520 owners missing a contact (357 ≥$1M). The 88 free + ~78 external-adapter
owners are subsets; the rest need the deferred SOS/address adapters or manual
research. Lower urgency (Scott deferred the adapter build).

### #5 — Phase 6: research-workbench UI convergence (last planned UI phase)
dia 10-mode ↔ gov 8-step → one Intake · Ownership · Leads · Monitor frame.
Lower marginal value now that the cockpit + dataflow are settled; do after #1–#3.

### #6 — Minor automation noise (triage, not a crisis)
4 open health alerts (1 feed_stale, 3 http_failure) + 4 transient cron failures
in 24h (`dia-link-provenance-replay`, `lcc-enrichment-worker`). Worth a quick
triage pass; not blocking.

## Corrections folded in this sweep
- The roadmap's "auto-apply high-confidence gov `pending_updates` (3,355 expired)"
  item is **withdrawn** — those high-confidence rows are confident *no-match
  exclusions* (`new_value` NULL), not discarded links. No data is being lost;
  nothing to build there.

## Recommended sequence
1. **Outreach loop (#1)** — the conversion point; highest value of everything left.
2. **Verify the free-attach drain (#2)** post-deploy (cheap, already built).
3. **Drain the OCR/extraction backlog (#3)** — unlocks ownership/comp data at scale.
4. Then Phase 6 UI convergence (#5); contacts long tail (#4) + automation triage
   (#6) as fill-in.
