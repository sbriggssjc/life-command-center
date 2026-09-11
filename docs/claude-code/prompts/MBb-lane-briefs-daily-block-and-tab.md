# MB-b — First visible brief: "Lane Briefs" block in the morning email + homepage Market Briefs tab (dialysis), after three producer cleanups

**Repo: `life-command-center`.** First user-facing P18 surface. Renders from `v_market_brief_live` only — never
recomputes a number. New surfaces ship flag-gated (`MARKET_BRIEF_RENDER`), flipped after §5.

**Read first:** `docs/architecture/EXEC-BRIEFS-SPEC.md` §1, §3, §4, §9 (all addenda, especially "MB-a3 reconcile")
· `docs/architecture/market_brief_payload_contract.md` (daily short block shape) ·
`api/_handlers/briefing-email-handler.js` (§8 Sector Watch, `renderSectorWatch` ~L905) ·
`docs/architecture/daily_briefing_home_panel_note.md` (`#dailyBriefingWidget`, `renderDailyBriefingPanel()`) ·
`api/_shared/market-brief-facts.js` · `docs/os/PLANNED-BACKLOG.md` §P18 MB1, MB1e, MB2, MB3, MB4 · `CLAUDE.md` ·
`.github/AI_INSTRUCTIONS.md`.

## Why this, why now

The producers are live. Cowork ran a read-only dry run on 2026-09-11 against the deployed build (`/version` =
`78082f46`, the MB-a3 merge) via pg_net:

- **P-SQL:** `gaps: []`, 17 candidates. The TTM dialysis cap band has a median of 7.00%, IQR 5.69–8.03%, n=169.
  211 properties are on market, at a 6.00% median ask. The CMS feed gate works: 8 operators have `cms_census_gap`
  facts, and no stale counts are written.
- **P-RSS:** Ollama was reachable (6 articles judged, 0 model failures), but **0 facts**. The healthcare stream
  carried no dialysis content that day.

Scott wants brokers to see and recall this daily. Three producer defects would show up the moment the brief
renders, so they're fixed first.

## 0. Producer cleanups (MB1e, MB2)

1. **Operator names are split.** The per-operator bands come out as separate facts for `Fresenius` (n=63) and
   `Fresenius Medical Care` (n=12), and for `DaVita` (n=67) and `DaVita Dialysis` (n=10). Canonicalize through
   Dialysis_DB `operators` (`operator_id`, `normalized_name`, `dba_names`) or the comps engine's canonical operator,
   whichever `query_comps` uses. Supersede the fragment facts. Test: no two live band facts map to one `operator_id`.
2. **The trades fact has no window.** It reads "No dialysis sales recorded." with `since = null`, and its
   `fact_key` includes the date, so a new zero-fact accumulates every day. Make it state its window ("No dialysis
   sales recorded in the trailing 7 days as of …"), key it stably (`trades_trailing_7d`), and supersede it.
3. **P-RSS has no dialysis signal.** Add 2–4 verified public feeds for dialysis / kidney care / ESRD policy to the
   snapshot edge fn's healthcare stream (or a new `dialysis` stream). Verify that each one yields items. Keep the
   verbatim-number check.

## 1. Daily "Lane Briefs" block (MB3)

A new section in `briefing-email-handler.js` that upgrades §8 Sector Watch; keep the news list beneath it. For
each lane that has live facts (dialysis today):

- **What changed since yesterday:** the fact-set diff (new or superseded facts since the prior issue).
- **The 2–3 most material live facts,** with as-of dates.
- **Freshness badges.** Named gaps render plainly, e.g. "CMS census stale since 2026-01-22 — counts withheld."
- **"Read the full brief →"** linking to the tab.

Numbers come verbatim from facts; nothing is computed in the renderer. Each render freezes a
`market_brief_issues` row (variant `daily_short`). Lanes with no live facts are omitted, not shown as empty.

## 2. Homepage Market Briefs tab (MB4)

`#/briefs/dialysis`, reachable from the homepage next to `#dailyBriefingWidget`. It shows:

- Live facts by section (exemplar order: operators, policy, capital markets, trades, implications).
- Citations and as-of dates, with stale or conflict states styled.
- The issue archive (list of `market_brief_issues`), with changed-since highlighting against the prior issue.

Read-only, and shares the renderer's data path.

## 3. What NOT to do

No weekly long-form email yet (MB6). No synthesizer prose (MB6). No cloud-model calls (EB1b). No gov/NL lanes
until their producers exist. The seeded `web_research` facts render with their real dates and go stale on
schedule. Don't refresh them by hand.

## 4. Guard + ship

Tests:

- Operator canonicalization.
- Trades fact key stability.
- A renderer snapshot for the email block, covering diff, gaps, and the omitted empty lane.
- An issue freeze, which must be idempotent per day.
- A tripwire that no number appears in the rendered block unless it's in a fact.

Full suite green. Branch → PR → CI → merge → **redeploy BOTH Railway services**, then confirm `/version` equals the
merge SHA for each.

## 5. Verify live, then flip

After deploy:

1. Run the P-SQL tick once via POST with the flag on, and confirm the supersede chain clears the fragments.
2. Render the email with `?preview=1` or the equivalent. Screenshot or paste the Lane Briefs block, and load
   `#/briefs/dialysis`.
3. Flip `MARKET_BRIEF_RENDER` on. Confirm the next 10:00 UTC snapshot email carries the block.

## Ship + record

Update `PLANNED-BACKLOG.md` §P18 (MB1e, MB2, MB3, MB4), `STATUS.md`, `CURRENT-STATE.md` §2, and a spec §9 addendum.
Your reply should include the cleanup results, the rendered block, tab screenshots or description, flag states,
and the `/version` for both services.
