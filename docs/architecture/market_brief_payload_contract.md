# Market Brief Payload Contract (EB1 foundation slice)

> Mirrors the style of [`daily_briefing_payload_contract.md`](daily_briefing_payload_contract.md).
> Spec: [`EXEC-BRIEFS-SPEC.md`](EXEC-BRIEFS-SPEC.md) v0.2. This document describes the shape the
> schema laid in EB1 (`market_brief_facts` / `market_brief_issues` / `producer_runs`) is designed
> to serve. **No endpoint in this contract exists yet** — MB-a (producers), MB-b (daily block +
> homepage tab) and MB-c (weekly email + MCP tool) build the handlers this document describes.
> Recording the shape now so those prompts build to one contract instead of improvising three.

## Storage model (already live as of EB1)

- **`market_brief_facts`** — one row per sourced, dated claim. See the migration
  (`20260911165100_lcc_eb1_exec_briefs_foundation.sql`) for the full column list; the fields a
  consumer cares about are `lane`, `section`, `claim_text`, `value`/`unit`, `source_url` /
  `source_title` / `source_date`, `origin`, `fact_kind`, `stale_after`, `status`.
- **`market_brief_issues`** — a frozen render; `fact_ids` is the immutable set the render used.
- **`v_market_brief_live`** — live, non-expired facts per lane/section, with a computed `is_stale`.
- **`v_market_brief_staleness`** — per (lane, section): live/stale/superseded/expired/conflict
  counts, whether the cell has never had a fact (`is_missing`), and the last producer run.

## Daily short block (Lane Briefs, upgrades daily email §8 Sector Watch — MB-b)

Per lane, one line of *what changed* (a fact-set diff between today's and yesterday's daily issue)
plus the 2 most material live facts, plus a link to the full brief.

```json
{
  "lane": "dialysis",
  "as_of_date": "2026-09-11",
  "changed_since_yesterday": [
    { "fact_id": "uuid", "claim_text": "...", "action": "added" | "superseded" | "expired" }
  ],
  "top_facts": [
    { "fact_id": "uuid", "section": "operators", "claim_text": "...", "source_title": "...", "source_date": "2026-08-04" }
  ],
  "read_full_brief_url": "https://.../#/briefs/dialysis"
}
```

- `changed_since_yesterday` is a diff of `market_brief_issues.fact_ids` between the two most recent
  `issue_type='daily'` rows for the lane — **never an LLM guess** (spec §1: "a fact-set diff, not an
  LLM guess").
- `top_facts` is capped at 2, ranked by whatever MB-b's selection rule turns out to be (recency ×
  section weight is the obvious starting point; not decided here).
- A lane with `is_missing` on every section for the day renders nothing rather than a fabricated
  placeholder — the empty state is honest, matching the daily briefing's own degradation rule.

## Weekly long-form email (MB-c)

Rendered from a frozen `market_brief_issues` row (`issue_type='weekly'`), one email covering all
four lanes, structured per the exemplar
(`docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md`): exec summary (5 bullets) → operators
→ policy → capital markets → implications (opinion, `fact_kind='opinion'` only) → unverified
(facts that never resolved a citation, if any survive to the render — EB1's seed step never loads
an "unverified" item as a fact per the exemplar's own labelling) → sources (every distinct
`source_url` across the issue's `fact_ids`, deduplicated).

```json
{
  "issue_id": "uuid",
  "lane": "dialysis",
  "issue_type": "weekly",
  "issue_date": "2026-09-11",
  "summary": "...",
  "sections": {
    "operators": [ /* fact rows */ ],
    "policy": [ /* fact rows */ ],
    "capital_markets": [ /* fact rows */ ],
    "implications": [ /* fact rows, fact_kind=opinion only */ ]
  },
  "sources": [ { "source_url": "...", "source_title": "...", "source_date": "..." } ]
}
```

Each fact row inside a section carries its own `source_url`/`source_date`/`confidence`/`is_stale` —
the exemplar's numbered-citation style is a rendering choice over this same data, not a second
schema.

## MCP `get_market_brief(lane, section?, as_of?)` response shape (MB-c)

Broker recall is the point of building this at all (spec §4): a live, cited answer inside any
Claude/Copilot/ChatGPT surface, not a stale pinned document.

```json
{
  "lane": "dialysis",
  "section": null,
  "as_of": "2026-09-11T16:00:00Z",
  "facts": [
    {
      "claim_text": "...",
      "value": 4.94,
      "unit": "percent",
      "source_title": "...",
      "source_url": "...",
      "source_date": "2026-09-11",
      "fact_kind": "reported",
      "is_stale": false,
      "confidence": 0.9
    }
  ],
  "staleness": { "live": 12, "stale": 1, "missing_sections": ["trades"] }
}
```

- Omitting `section` returns every live fact for the lane, one array (not nested per section) —
  the tool is a conversational lookup, not a document renderer.
- `staleness` is a same-call summary drawn from `v_market_brief_staleness`, so a caller can decide
  whether to caveat an answer ("as of last week") without a second round trip.
- Never returns a fact whose `status` is `superseded`/`expired`/`conflict` — those exist for audit
  and diffing, not for an answer a broker will repeat verbatim.

## Producer run contract (`producer_runs`, live as of EB1)

Every MB producer (P-SQL, P-RSS, P-WEB, the synthesizer) opens a row at entry
(`status='started'`) and closes it on the way out. `status='skipped'` always carries a
`skip_reason` (spec §2's degradation rule: a missing `ANTHROPIC_API_KEY` or an exhausted budget is
a named skip, not a silent zero-fact night). Consumers read `facts_written`/`facts_superseded` —
the state delta — never the producer's own tally string.

## What NOT to build from this document yet

No endpoint above exists. This is the target shape for MB-a/MB-b/MB-c; each of those prompts should
confirm the shape still fits the data actually landing in `market_brief_facts` before wiring a
handler to it verbatim — per the standing rule, a spec drafted before the data exists is a
hypothesis, not a contract, until it is measured against real rows.
