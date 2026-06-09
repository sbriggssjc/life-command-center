# Claude Code prompt — R14 HOTFIX: promote-drain must follow the lcc→domain bridge

**Live verification of the merged R14 drain (2026-06-08) found it recovers
ZERO of the dominant stranded class.** The mechanics are sound (no errors,
cooldown + attempt-cap working, scan reaches items), but the re-promotion does
not actually finalize the items it was built for. **I have PAUSED the cron
`lcc-intake-promote-drain`** (unscheduled on LCC Opps) to prevent a harmful
side-effect — see below. Re-enable only after this hotfix.

## Grounded evidence (live, LCC Opps)

- `matched` = 863; **598 carry `domain_not_supported`** (the dominant class).
- 4 live POST drain ticks: `repromoted` 71, **`finalized` 0**, `surfaced` 0,
  `errored` 0. `matched` count did NOT drop. Zero recoveries.
- Root cause: these are `match_domain='lcc'` matches. The drain re-runs
  `runDownstreamPipeline` → the matcher re-matches to the SAME lcc entity →
  `domain='lcc'` → the promoter hits `domain_not_supported` again →
  `result.ok=false` → no finalize → stays `matched`.
- **But recovery IS possible and was the whole premise:** of the
  matched+`domain_not_supported` lcc rows, **851 bridge to a dia/gov property**
  via `external_identities (entity_id = <lcc entity>, source_system IN
  ('dia','gov'))` — the link R4-A (2026-06-04) repaired. The drain just never
  follows that bridge; it re-matches to lcc and re-skips.

  Confirming query (run on LCC Opps):
  ```sql
  SELECT count(*) AS dns_lcc, count(*) FILTER (WHERE x.entity_id IS NOT NULL) AS bridges
  FROM staged_intake_items s
  JOIN staged_intake_matches m ON m.intake_id=s.intake_id AND m.domain='lcc'
  LEFT JOIN external_identities x
    ON x.entity_id=(m.property_id)::uuid AND x.source_system IN ('dia','gov')
  WHERE s.status='matched' AND s.raw_payload::text ILIKE '%domain_not_supported%';
  ```

## Why the cron is paused

With `PROMOTE_DRAIN_MAX_ATTEMPTS=2`, leaving the cron running would, within
~24h (as the 24h cooldowns expire and a 2nd attempt also fails to promote the
lcc match), **surface ~600 RECOVERABLE items to `review_required`** — burying
the real review queue with items that should auto-recover via the bridge. That
is worse than leaving them `matched`. Hence the pause until the drain follows
the bridge.

## The fix

When an intake's match is `domain='lcc'` and that lcc entity carries a dia/gov
`external_identities` row, the promote path must resolve to the **domain
property** and promote THERE — not re-match to lcc and skip.

1. **In the drain (and ideally the shared promoter resolution):** before
   re-running the matcher, check the existing `staged_intake_matches` row. If
   `domain='lcc'`, look up `external_identities` for that lcc entity_id with
   `source_system IN ('dia','gov')`, resolve the domain + domain property_id
   (the `external_id` is the domain `properties.property_id` per the R4-A
   canonical scheme: `source_type='asset'`), and run the promoter against that
   domain/property. Mirror the inline lcc-handling the extractor already does
   at `intake-extractor.js:941` (`matchResult.domain==='lcc'` → entityId =
   property_id) — but for PROMOTION, you need the reverse: lcc entity → its
   dia/gov asset identity → promote to that domain property.
2. **If the lcc entity has multiple domain identities or none:** none →
   genuinely not recoverable, let it surface to review after the cap (correct).
   Multiple → pick deterministically (most recent / the asset-type identity)
   and record which; report any.
3. **Finalize** on the domain promotion's `result.ok` (the Unit-2 finalize-flip
   fix already broadened to `result.ok` — confirm it triggers on this path).
4. **Idempotent + effect-first** as before: success → `finalized`; genuinely
   unrecoverable after cap → `review_required`; never claim finalize without
   the promotion landing.

## Verify (live, before re-enabling the cron)

- A few POST `/api/intake-promote-drain?limit=100` ticks now show
  **`finalized > 0`** and the `matched` count dropping; spot-check 2 recovered
  intakes — their dia/gov property should now hold the OM data (listing / lease
  / financials / documents).
- Report the split across the full drain: `finalized` (real deals recovered) vs
  `surfaced` (genuine review residue — expect the ~159 `not_a_listing_doc` +
  ~88 `confidence_below` here, NOT the 851 bridged ones) vs `errored`.
- Once `finalized` is landing and the bridged class is draining, **re-apply the
  cron** (`20260609200000` / re-`cron.schedule('lcc-intake-promote-drain',
  '15,45 * * * *', …)`).
- House rules: `node --check`; 12 functions; effect-first; report the recovered
  count — that's the number of real deals that were silently stranded.

---

## FOLLOW-UP (live verification 2026-06-08, post-hotfix-deploy)

The hotfix is CONFIRMED WORKING live: 8 lcc→domain recoveries finalized in 30
min, traced to real targets (dia:26793, gov:30389, gov:16560, dia:35724, …) —
the deal data lands at the domain property, not just a label flip. The cron
`lcc-intake-promote-drain` has been **re-armed** (15,45 * * * *) to drain the
~520 recoverable backlog over the next 24-48h as cooldowns expire.

Two residual items found during verification:

1. **NULL `entities.domain` gap (9 items).** The hotfix normalizes
   `entities.domain` short→long, but some lcc asset entities have
   `entities.domain = NULL` while carrying a perfectly valid dia/gov
   `external_identities` row (e.g. lcc entity 67f65207 "990 W 41st St, Hibbing
   MN" → `source_system='gov', source_type='asset', external_id='31523'`).
   These 9 won't recover (guard fails on NULL) and will wrongly surface to
   `review_required` after the attempt cap. **Robust fix: derive the target
   domain from the bridge row's `source_system` (the authoritative signal),
   not from `entities.domain`.** `external_identities.source_system` is always
   present for a bridged entity and already canonical (`dia`/`gov`); map it →
   long form for the promoter guard. This both closes the 9-item gap and is
   strictly more correct than relying on `entities.domain` (which is nullable).
2. **Cooldown contamination (my diagnostic artifact, self-clearing).** My
   pre-hotfix + post-hotfix diagnostic drain ticks left 24h `promote_drain`
   cooldown stamps on ~126 recoverable items, so a clean full-rate measurement
   wasn't possible this session (eligible pool was small + skewed). Not a code
   issue — the stamps expire in 24h and the re-armed cron will then drain them.
   No action needed unless you want an immediate clean measure (then clear the
   promote_drain cooldown stamps on `status='matched'` rows).

Re-check after ~48h: `matched` should fall from ~877 toward the genuine
residual (~77 no-numeric-asset + the 9 NULL-domain if unfixed + real inflow),
and `finalized` should climb by ~500. If `matched` isn't dropping, investigate
before assuming the cron is draining.
