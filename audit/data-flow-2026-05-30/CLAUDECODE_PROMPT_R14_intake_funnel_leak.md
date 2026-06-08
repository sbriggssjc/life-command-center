# Claude Code prompt — R14: intake funnel — the stranded 'matched' state

> **ADDENDUM (2026-06-08, post-INTAKE_AUTOCREATE-enable) — Unit 4: fix the
> rematch/auto-create SCAN STARVATION. Add this to the SAME branch as the R14
> work (it's the same `handleIntakeRematch` worker) so it ships in one redeploy,
> if not yet merged; otherwise its own quick round.**
>
> Grounded live after Scott set `INTAKE_AUTOCREATE=1`: a real POST tick returned
> `scanned=400, skipped_no_address=167, skipped_cooldown=233, rematched=0,
> auto_created=0`. The flag is live (`auto_create_enabled:true`) but produces
> zero because the scan window is starved:
> - The worker fetches the OLDEST review_required by `created_at.asc`, `limit*4`
>   (= 400 with the default limit=100). The backlog is 651, so ~251 newer items
>   are **never scanned**.
> - **167 address-less items permanently squat the front of every scan**: they
>   can't match, can't auto-create (auto-create requires an address), and aren't
>   being discarded (they carry deal signal, so the `dispositioned_non_deal`
>   path skips them). They consume 167/400 slots every tick, forever.
> - The remaining 233 are in the 168h (7-day) cooldown.
> - Net: the auto-create-eligible items (cooldown-expired + full signature) are
>   never reached, so the flag can't drain the address-bearing review tail it
>   was enabled for.
>
> **Fix (Unit 4):**
> 1. **Stop the address-less squatters from consuming the scan.** Either exclude
>    `review_required` items with no parseable address from the rematch fetch
>    (they can never match/auto-create), OR give them a proper disposition: an
>    address-less item that DOES carry deal signal (tenant/price) but no address
>    is a real triage item — surface it (keep in review with an `needs_address`
>    flag the inbox shows) rather than silently re-skipping it every tick. An
>    address-less NON-deal item should `dispositioned_non_deal` → discarded.
>    Decide per signal; the rule is "never re-skip the same dead row forever."
> 2. **Cover the whole backlog.** Order the fetch by cooldown-eligibility
>    (oldest `last rematch` / never-rematched first), not raw `created_at.asc`,
>    and/or raise the fetch cap so the full review_required set is reachable
>    across a few ticks. The goal: an auto-create-eligible item is actually
>    reached within a bounded number of ticks, not starved behind dead rows.
> 3. Verify live: a dry-run GET shows `eligible > 0` (or a POST shows
>    `auto_created > 0`) once the scan reaches full-signature cooldown-expired
>    items; the 167 address-less items no longer appear as `skipped_no_address`
>    every tick (they're excluded or dispositioned once). Report the new split.
>
> The flag does no harm while starved (it no-ops) — but it won't deliver the
> intended review-tail drain until the scan reaches eligible items. Keep the
> conservative cap (`INTAKE_AUTOCREATE_CAP`, Scott set 5) intact.

---


Audit grounded live 2026-06-08 (LCC Opps). The intake funnel has a silent
leak: a whole status bucket that is neither auto-promoted nor surfaced for
human action. Resolve severity FIRST (cosmetic-label vs real-data-leak), then
fix.

## Grounded funnel (staged_intake_items, live)

| status | count | >30d old | notes |
|---|---|---|---|
| discarded | 2,622 | 2,492 | terminal, fine |
| finalized | 1,679 | 325 | terminal success (promoted to property) |
| **matched** | **1,263** | **413** | **the leak — see below** |
| review_required | 651 | 248 | human-review queue (DC intake lane) |
| failed | 81 | 6 | extraction failures |

`matched` by channel: **email 1,129, copilot 136** (zero sidebar — sidebar
writes domain DBs directly and doesn't land here). **701 of the 1,263 are
stale >7 days with no `updated_at` change; oldest 2026-04-25.**

## The finding

`matched` is set by the matcher (`intake-matcher.js` returns
`status:'matched'`) and by the disambiguation `pick` verdict. Promotion to the
property + flip to `finalized` is a SEPARATE step. But:
- **No cron promotes `matched` items** (live `cron.job`: intake-rematch,
  discard-stuck-intakes, nightly-preassemble, artifacts-prune, availability —
  none consume `status='matched'`).
- **The inbox triage UI excludes `matched`** (`intake.js` ~1294 filters
  `status=in.(review_required,queued,failed)`).
- **The Decision Center intake_disposition lane is `review_required + failed`
  only** — `matched` isn't in it.
- `matched` isn't even in the code's own documented status enum (`intake.js`
  ~1291: "review_required / queued / failed / finalized / discarded").

So a `matched` item sits in NO operator surface and is consumed by NO
automation. Yet within the same channel, items DO reach `finalized` (email
1,431 finalized vs 1,129 matched; copilot 252 vs 136) — so promotion completes
for some and silently strands the rest.

## Unit 1 — determine severity (do this BEFORE any fix)

For a sample of ~20 stale `matched` email/copilot intakes (oldest first),
determine whether the promotion actually ran:
- Trace the promote path: does the email/copilot pipeline promote INLINE at
  match time (`intake-extractor.js` / `intake-om-pipeline.js` →
  `intake-promoter.js promoteIntakeToDomainListing`), and separately flip
  `finalized` (`intake.js` ~1657)? Or is promotion a manual inbox/F4 action?
- For the sample, check whether the matched property actually received the OM
  data (provenance `source='om_extraction'`, or the listing/lease/financial
  rows the promoter writes, dated near the intake's match time).
- **Two outcomes:**
  - **(A) Cosmetic** — the property WAS promoted but the status never flipped
    to `finalized` (e.g. the finalize PATCH was skipped on the async path, à la
    the documented "promoted-not-allowed" Bug from intake.js 1652). Then the
    fix is a reconciliation: flip promoted-but-mislabeled rows to `finalized`
    and close the gap in the promote path so it always finalizes.
  - **(B) Real leak** — promotion never ran; ~1,265 OMs matched to a property
    but their deal data never landed. Then the fix is to run those matched
    items through the promoter (a backfill drain + an ongoing
    matched→promote→finalized step).
- Report which it is with the sample evidence. The fix in Unit 2 forks on this.

## Unit 2 — close the matched→finalized gap (fork on Unit 1)

- **If (A) cosmetic:** a reconciliation migration/worker that flips
  promoted-but-matched rows to `finalized` (gated on real promotion evidence,
  never blind), + fix the promote path so the finalize flip always happens
  (the async/sync path parity). Idempotent; report counts.
- **If (B) leak:** a promoter drain (admin.js sub-route or extend
  intake-rematch's sibling) that reads stale `status='matched'`, runs
  `promoteIntakeToDomainListing` (idempotent — the promoter already dedups), and
  flips `finalized` on success / leaves `matched` + records the error on
  failure (effect-first). Batch-capped, cron-scheduled like intake-rematch.
- **Either way:** `matched` must stop being a silent terminal. Either it's
  transient (promoter consumes it within a tick) or it's surfaced. If any
  matched item can legitimately need human eyes (e.g. promote failed), it
  should appear in the inbox or a decision lane, not vanish.

## Unit 3 — review_required backlog hygiene (smaller)

651 `review_required` (248 >30 days old). The `lcc-discard-stuck-intakes` cron
(daily 04:15) should be aging out genuinely-dead ones — verify its predicate
and why 248 persist >30d (is it only discarding `queued`/`failed`, not
`review_required`? is 30d the wrong threshold? are these genuinely workable
and just un-worked?). These ARE surfaced (DC intake_disposition lane, 732), so
this is lower priority than the invisible `matched` bucket — but a 248-item
month-old review tail suggests the lane isn't draining and/or the discard cron
doesn't cover review_required. Recommend: confirm the cron's scope; if
review_required items past N days with no actionable signal should auto-discard
(or auto-create-property via F4 when full-signature), wire it.

## Verify + ship
- Unit 1: the sample determination (A vs B) with evidence — this is the gate.
- Unit 2: the matching fix exercised on a small batch live, counts reported,
  idempotent, effect-first; `matched` no longer a silent dead status.
- Unit 3: cron predicate confirmed; any change idempotent.
- House rules: `node --check`; 12 functions; migrations idempotent; crons after
  routes; report per-unit. DB-side reconciliation per standing posture; JS on
  the Railway redeploy.
