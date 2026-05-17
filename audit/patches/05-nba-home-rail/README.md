# Item #4 Phase C — Next Best Action rail on Home tab

User-visible payoff for the Item #4 build. Surfaces the top 10 cross-domain
gaps from `v_next_best_action` (dia + gov) on the Home page.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/05-nba-home-rail
node audit/patches/05-nba-home-rail/apply.mjs --dry      # preview
node audit/patches/05-nba-home-rail/apply.mjs --apply    # write
git add -A
git commit -F audit/patches/05-nba-home-rail/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/05-nba-home-rail -m "Merge audit/05-nba-home-rail: Next Best Action rail on Home tab"
git push origin main
```

## Smoke test

1. Hard-reload the app (Ctrl+Shift+R).
2. Land on Home. Look right under the 4 stat cards (Open Activities / Flagged
   Emails / Today's Events / Due This Week).
3. Verify the **Next Best Action** widget renders with 10 rows, each showing:
   - Rank number (#1–#10)
   - Severity chip (CRIT / HIGH / MED / LOW), color-coded
   - Domain tag (DIA or GOV)
   - Address / gap label — top dia rows should show `[N dup records]` inline
     for any partition group with duplicates (the v3.2 annotation)
   - Suggested action (one-line summary)
   - Value estimate (NOI ÷ cap_rate from v3)
4. Click any row → the unified property detail panel opens for that record.
5. Toggle the **All / Dialysis / Government** switch in the widget title.
   Refresh occurs automatically. The chosen view persists across reloads.
6. Click the ↻ button → reload completes inside ~1 second.
7. Reopen the app a few minutes later → auto-refresh should have run on
   visibilitychange (check the console for `[NextBestAction]` debug if needed).

## Endpoint

```
GET /api/admin?_route=next-best-action&domain={both|dia|gov}&limit=15

Response:
{
  ok:           true,
  total_merged: <int>,   // total rows across both domains
  returned:     <int>,   // rows in this response
  limit, offset,
  severity, gap_type,    // applied filters (if any)
  by_domain:    { dialysis: {ok, fetched}, government: {ok, fetched} },
  items: [
    {
      rank, gap_type, gap_severity, gap_pk, entity_pk, property_id,
      gap_label, suggested_action, gap_value, first_seen_at,
      source_domain: 'dialysis' | 'government'
    },
    ...
  ]
}
```

## Edge cases handled

- **Domain failure:** If one domain fan-out fails, the rail still renders the
  successful domain's rows and shows a "⚠ partial" indicator with the failed
  domain in the tooltip.
- **Empty queue:** Shows "No outstanding gaps. Queue is clear." (unlikely but
  graceful).
- **Network error:** Retry button via standard `.widget-error` pattern.
- **Missing property_id:** Row renders but isn't clickable (no `onclick`).
- **localStorage unavailable:** Falls back to 'both' silently.
- **openUnifiedDetail not loaded yet:** Falls back to `navTo('pageDia')` or
  `navTo('pageGov')` so the user lands on the right page.

## What's next (deferred to follow-ups)

- Phase B-3: LCC Opps view for provenance conflicts + inbox triage + health
  alerts (the LCC-Opps half of B-1 — still pending).
- "See all" footer link → routes to a dedicated page with full pagination,
  filter UI, and bulk-resolution actions.
- Per-row "Resolve" inline action (e.g. consolidate, mark resolved).
