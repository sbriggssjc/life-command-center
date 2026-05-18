# Item #2 Phase B — LLC Research Queue UI

Manual surface for the LLC research queue. Phase A's cron drainer
keeps running in the background via the AI pipeline; this UI lets
Scott power through the cases the AI can't resolve (ambiguous names,
multi-state filings, judgment calls).

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/02B-llc-research-queue-ui
node audit/patches/02B-llc-research-queue-ui/apply.mjs --dry
node audit/patches/02B-llc-research-queue-ui/apply.mjs --apply
git add -A
git commit -F audit/patches/02B-llc-research-queue-ui/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/02B-llc-research-queue-ui -m "Merge audit/02B-llc-research-queue-ui: LLC research queue UI"
git push origin main
```

No SQL migration. No Studio step.

## Smoke test (post-Railway redeploy)

1. Open the LCC app → More drawer → **Research**.
2. The new **LLC Research Queue** widget should appear at the top
   of the page, showing the top 15 LLC entries ordered by deal value.
   Each row shows:
   - Rank #1 – #15
   - Search name (e.g. "PINEHURST PROPERTIES LLC") + state code
   - Property address + tenant context
   - Value chip (e.g. $42.5M)
   - Completeness band chip (green/blue/yellow/red)
   - Attempts count
3. Click **"Open SoS →"** on a row. A new tab opens to that state's
   Secretary of State search portal. For CA / DE / NY / FL / TX etc.,
   it goes to the actual SoS portal; for unmapped states, it falls
   through to a Google search query that biases toward LLC filings.
4. Click **"Mark found"**. A prompt asks for the filing ID. Enter
   anything and submit. A toast confirms "Marked resolved" and the
   row disappears.
5. On a different row, click **"No match"**. Confirm the dialog.
   The row disappears.
6. Click the ↻ refresh button. The widget re-loads with the next
   highest-value rows filling the slots you cleared.

## SQL verification

```sql
-- On dialysis DB:
SELECT status, count(*)
  FROM public.llc_research_queue
 GROUP BY 1
 ORDER BY 2 DESC;
-- After working through a few rows, expect 'completed' or 'no_match'
-- counts to grow.

-- Look at the most recently resolved:
SELECT queue_id, search_name, guessed_state, status, resolved_at,
       found_filing_id, found_filing_state
  FROM public.llc_research_queue
 WHERE status IN ('completed', 'no_match')
 ORDER BY resolved_at DESC NULLS LAST
 LIMIT 10;
```

## SoS portal map

Mapped states (26): AL, AZ, CA, CO, DE, FL, GA, IL, IN, KY, MA, MD,
MI, MN, MO, NC, NJ, NV, NY, OH, OR, PA, TN, TX, VA, WA, WI.

Unmapped states fall through to a Google search query like
`"PINEHURST PROPERTIES LLC" NC secretary of state LLC filing`.

## Phase C follow-ups

- **Bulk mode**: select multiple rows + bulk "Mark all no_match" or
  "Open all in new tabs".
- **Inline result capture**: replace the async-prompt with an
  inline form on the card (filing_id input + state dropdown + Save).
- **Per-row history**: show previous attempts + AI's `last_error` +
  retry button.
- **Expand the SoS portal map** to all 50 states + DC + territories.
- **Telemetry**: route widget errors through `lccReportError` so they
  feed into `client_errors` (Item #10 Phase B).
