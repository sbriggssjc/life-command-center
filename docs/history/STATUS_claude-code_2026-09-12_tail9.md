# STATUS archive — Claude Code queue, 2026-09-12 (seventeenth span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-15 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`, which is the canonical open-work list.

---

## 2026-09-12 — FEED1 scoped: five replacement feeds fetched live for the three dead ones (Cowork)

Verified via pg_net, with newest-pubDate recorded per feed because MB2a proved 200-with-items is not the
same as contributing: `government` → Federal Register GSA-agency feed (**200, 14**, newest 09-11);
`healthcare` → STAT News (**200, 20**, 09-12) + Healthcare Dive (**200, 10**, 09-11); `net_lease` →
Connect CRE (**200, 10**) + REBusinessOnline (**200, 20**), both 09-11. Measured and rejected: Modern
Healthcare **403**, The Real Deal **403**. Government Executive re-verified (**200, 23**) — the only
reason that lane is not at zero. **All five publish daily, so all five clear the 72h cutoff as-is**,
which keeps FEED1 a clean URL swap and leaves MB2b out of it. Sharper read on the ESRD feed while here:
its problem is a narrow query returning 3 items spanning weeks, **not** Federal Register — the GSA
agency feed on the same service is high-volume and behaves normally. Prompt carries the deploy step
explicitly (`--project-ref` required; merged is not running).

## 2026-09-12 — MB2a deployed: the dialysis stream is live, and its first run found 3 OTHER dead feeds (Cowork)

Scott deployed `briefing-intel-snapshot` (CLI, `--project-ref xengecqvemvfknjvbvrq`). Verified live via
pg_net dry-run: **`sector_news.dialysis` = 6 items**, where the key did not exist at all before.
🚨 **The monitor's first run found three long-silent dead feeds in OTHER streams**, each confirmed
independently: **GSA News 404**, **Health Affairs 410 Gone**, **GlobeSt 403**. The government lane is
running on ONE feed, net_lease on two of three, healthcare on two of three — and the daily email's
Sector Watch has been quietly built on that. → **FEED1**.
**PRSS stays OFF, now on evidence:** of the 6 dialysis items, **0 are market signal** — local EMS
coverage, a Canadian wildfire item, a $4,100 clinic refund, a PFAS suit, a supplier award, and a DaVita
one-day stock move we already read straight off the DVA ticker. → **MB2b**.
**Federal Register is healthy and contributes nothing:** 3 items parsed, 0 survive the shared **72h
cutoff** — its documents are weeks old by design, which is exactly what the policy section wants. So
`item_count` measures PARSING, not CONTRIBUTION, and a feed can look green while adding zero.
**Publisher parser bug:** the suffix regex forbids hyphens in the outlet name, so
"… - Honolulu Star-Advertiser" yields `publisher=null` AND leaves the suffix in the headline.

## 2026-09-12 — MB2a reconciled live: feeds confirmed, migration applied, and the code is NOT DEPLOYED (Cowork)

**Both replacement feeds re-verified independently** via pg_net (the check CC's sandbox could not run —
zero egress): Federal Register ESRD **200, 3 items**; Google News operator query **200, 100 items**.
**Migration applied live to LCC Opps** — `market_brief_feed_health`, `v_market_brief_feed_health_stale`,
`lcc_check_market_brief_feed_health` (runs clean, 0 opened / 0 resolved), both `market_brief_facts`
citation columns, cron `lcc-market-brief-feed-health` at 11:15 UTC.
🚨 **The blocker is a deploy, not the feeds.** Deployed `briefing-intel-snapshot` is **v21 and has NO
`dialysis` stream at all** — MB-b's three dead URLs were never deployed either, so nothing MB-b or MB2a
wrote to `RSS_FEEDS` has ever run. **This repo has no workflow that deploys edge functions** (checked
`.github/workflows/`), so merging one changes nothing by itself. New **I16** instance; DRIFT1's census
called this function "committed, not in scope" on 2026-09-07 — true then, stale now. → **MB2a-deploy**.
`MARKET_BRIEF_PRSS` stays OFF, correctly: relevance survival cannot be measured until the deploy lands.
Verified separately that CC handled the bucket hazard — `fetchSectorNews()` derives its result keys from
`RSS_FEEDS` in both the initializer and the catch fallback, so a new stream cannot throw.

## 2026-09-12 — MB2a: dead dialysis RSS feeds replaced, feed-health monitor added, PRSS stays off

`RSS_FEEDS.dialysis` now points at Federal Register (ESRD) + Google News (operator query) in place of
the three dead URLs (403/404/404). No third feed added — this sandbox has zero verified egress and a
spoofed UA was refused, per the task. Handled Google News's redirect-URL + broad-noise caveats
(`source_publisher`/`source_url_is_redirect` columns; a title-suffix parser). Shipped
`scripts/verify-rss-feeds.mjs` (opt-in, parses feeds from source so it can't drift) and
`market_brief_feed_health` + `lcc_check_market_brief_feed_health` (I11: alerts on 3+ zero-item days,
auto-resolves on a real item). `MARKET_BRIEF_PRSS` left OFF — no live egress this session to confirm
facts actually flow; Cowork's prior fetch predates this code. Suite 6,130/0/6-skipped. Backlog
`docs/os/PLANNED-BACKLOG.md` §P18 MB2a; spec addendum in `EXEC-BRIEFS-SPEC.md`.

## 2026-09-12 — MB9: collapsed the redundant net-lease lane, redesigned the homepage Market Briefs widget (Cowork)

Scott, after seeing the live Market Briefs tab for the first time (3 screenshots): the homepage widget
looked wrong ("two dialysis briefs" with no government brief), asked for a short-snapshot-then-detail
redesign, and called `net_lease`/`broad_net_lease` redundant — one lane is enough.

**Verified before touching anything:** `select lane, count(*) from market_brief_facts group by lane` and
the same for `market_brief_issues` — both returned only `dialysis` (31 facts, 1 issue). Zero rows existed
under `net_lease` or `broad_net_lease`, so the collapse is a pure schema/UI narrowing, no data migration.

**What "two dialysis briefs, no government brief" actually was:** not a bug — `renderMarketBriefsWidget()`
only ever fetched the `dialysis` lane and printed its top-2 raw fact bullets with no lane label, which reads
like two unrelated blurbs. Government/net-lease show nothing because **no producer has ever written a fact
for them** — MB1/MB2's P-SQL/P-RSS producers are dialysis-only by original scope (spec §3: "no new gov/NL
lanes here"). That gap is real and unscoped — filed as part of MB9 in `PLANNED-BACKLOG.md`, not silently
built here.

**Changed:**
- `api/_shared/market-brief-render.js` — `KNOWN_LANES`/`LANE_LABELS` narrowed to `dialysis`/`government`/`net_lease`.
- `app.js` — new shared `MARKET_BRIEF_LANES`/`MARKET_BRIEF_LANE_LABELS` consts (replacing the old inline
  `laneTabs`/`laneLabels` literals in `renderMarketBriefsPage`, so frontend/backend can't drift again).
  `renderMarketBriefsWidget()` rewritten: one snapshot line per lane with the flag on (`<Lane> — N live
  facts`, the single freshest claim, "Open full brief →"), plus a muted "no live facts yet (producer not
  built)" line for an enabled-but-empty lane instead of silent omission.
- `index.html` — dropped the widget's static "Open Dialysis brief →" header link (now redundant with each
  lane's own link inside the widget body).
- `docs/architecture/EXEC-BRIEFS-SPEC.md` — §0 swimlane row + weekly-email lane count updated to 3.
- New migration `supabase/migrations/20261101200000_lcc_mbb2_lane_collapse_net_lease.sql` — narrows
  `chk_mbf_lane`/`chk_mbi_lane`/`v_market_brief_staleness`'s lane set to 3. **Applied live** to project
  `xengecqvemvfknjvbvrq`, verified via `pg_get_constraintdef`.
- `docs/os/PLANNED-BACKLOG.md` — MB8 marked superseded, new MB9 row, EB0 corrected in place.

**Guards:** new `test/mbb2-lane-collapse.test.mjs` (4 tests, comment-stripped-SQL structural guard
mirroring `eb1-market-brief-foundation.test.mjs`'s own pattern), `test/market-brief-render.test.mjs` +
`test/market-brief-tick-handlers.test.mjs` updated to assert 3 lanes. Targeted suite: 53/53 pass, 0 fail.
**Full 423-file suite not run to completion this session** — the device shell's per-call timeout can't
cover it and a backgrounded run didn't survive between calls; every `KNOWN_LANES`/`broad_net_lease` call
site was grepped repo-wide first and confirmed covered by the targeted tests instead. Stated plainly
rather than claiming a full-suite number I didn't actually observe.

**Not done, deliberately:** no government or net-lease producer built (a real, separate, unscoped decision
— GSA lease-event source for gov, the general-NL on-market store gap shared with BUY0/UX-T4 for net-lease);
`docs/claude-code/prompts/done/EB1-exec-briefs-foundation.md`'s historical 4-lane note left untouched (it
accurately describes what that original migration did, not current state).
