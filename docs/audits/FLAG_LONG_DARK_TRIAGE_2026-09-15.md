# The 15 "long dark" flags are ~5 decisions, not 15 — triage 2026-09-15 (Cowork)

> `flag_long_dark` is **15 of the build brief's 24 findings (62%)**. This file exists so that share of
> the brief becomes a short list of decisions Scott can actually make, rather than fifteen rows that
> each look like separate unfinished work.

## The reframe: "off" here mostly means *never configured*, not *switched off*

Measured in the code, not inferred from the registry:

```js
// api/_shared/address-reverse.js:82
return !!process.env.OWNER_ENRICH_ADDRESS_URL;

// api/_shared/sos-lookup.js:108
if (!process.env.OWNER_ENRICH_SOS_URL || typeof fetcher !== 'function')
  return { ok: false, reason: 'unconfigured' };
```

For most of these the **flag IS the presence of an env var**. Nothing was disabled; an endpoint or key
was simply never set, and the code degrades honestly (`reason: 'unconfigured'`).

**Every surface file still exists and every flag is still referenced in live code** — checked for all 15.
So **none of this is dead code**, and "delete it" is not on the table for any of them. That corrects an
earlier Cowork note which framed these as "either work to finish or code to delete."

## The decisions

| # | decision | flags | dark since | what it costs to say yes |
|---|---|---|---|---|
| **1** | **Do we stand up owner-enrichment adapters at all?** | **9** — `OWNER_ENRICH_ADDRESS_URL`, `OWNER_ENRICH_DEED_URL`, `OWNER_ENRICH_SOS_URL`, `SOS_STATE_ADAPTERS.CA/TX/FL`, `OWNER_ENRICH_WEBSEARCH_URL`, `OPENCORPORATES_API_KEY`, `W9_1_SOS_DIRECT` | 2026-06-27 → 08-12 | External endpoints + an OpenCorporates key. **This is one question wearing nine hats** — the adapters share a shape and mostly a single URL family. |
| **2** | **Do we want the Salesforce list import?** | 2 — `SF_LIST_IMPORT_URL`, `SF_LIST_SEED_INSTITUTION` | **2026-05-30 (108 days)** | A PA flow endpoint. Oldest dark pair in the registry. |
| **3** | **Do we want save-not-send Outlook drafting?** | 1 — `PA_OUTLOOK_DRAFT_FLOW` | 2026-08-21 | A Power Automate endpoint. Described as the **org-sanctioned** outbound path, so it interacts with Northmarq IT constraints. |
| **4** | **Deed-wins owner override in the Decision Center** | 1 — `DECISION_OWNER_DEED_WINS` | 2026-06-27 | ⭐ **The only true feature toggle in the set** — not URL-shaped, no external dependency. It is a policy call about whether a recorded deed overrides other owner sources, and it sits directly on the OWNERGAP / true-owner thread. |
| **5** | **CM treasury pre-refresh webhook** | 1 — `CM_TREASURY_REFRESH_URL` | 2026-08-07 | Optional; the export works without it. Lowest stakes here. |
| — | `ENABLE_OWNERSHIP_RESEARCH_QUEUE` | 1 | 2026-07-30 | **Not this repo's call.** Zero references in `life-command-center`; its surface is the `government-lease` pipeline. Per the repo-ownership doctrine it should be decided there. |

## ⚠️ CORRECTION 2026-09-15 (Cowork) — decision #4 is not the cheap first move

The "Recommended order" below says **#4 first**, on the reasoning that it needs no purchase, no
endpoint and no IT conversation. That reasoning was right about its *cost* and wrong about its
*effect*, and the difference was one query away.

Measured live, `v_owner_source_conflict`:

| domain | auto_fixable = true | auto_fixable = false |
|---|---|---|
| government | **0** | 941 |
| dialysis | **8** | 415 |

`DECISION_OWNER_DEED_WINS=on` would write **8 rows out of 1,363 conflicts**, none of them in
government. And the 8 do not survive a hand-check: `Sumitomo Bank Leasing And Finance Inc` → **SMFG**
appears twice as a genuine owner change (the rebrand guard compares shared tokens, and an initialism
shares none with the words it abbreviates), and a leasing-and-finance entity takes title on rows that
read as financing instruments rather than sales.

**The decision the flag was standing in front of is the 2-year deed-recency window** — 234 dialysis
rows are blocked by nothing else — and on the government side it is not a decision at all but a data
gap: 389 conflicting rows have a NULL `latest_deed_date`.

Split into **DEED1** (dia window + the two guard holes) and **GOVDEED1** (gov date gap), both
prompted 2026-09-15. Decisions **#1, #2, #3 and #5 below are unaffected** — re-read them as written.

⭐ The lesson for this file: "costs nothing to say yes" is not the same as "worth saying yes to," and
this triage ranked on cost without sizing the effect. Size the population before recommending an
order.

## Recommended order

**#4 first.** It is the only one that needs no purchase, no endpoint and no IT conversation — just a
decision — and it bears on the true-owner question the OWNERGAP thread has been circling. **#2 next**,
purely because 108 days dark means nobody has missed it, which is itself an answer worth making explicit.

## What this says about the XB2 rule

`flag_long_dark` treats *"adapter never configured"* and *"feature deliberately disabled"* as the same
signal. They are not: one is a capability not yet purchased, the other is work left unfinished. **This is
the third instance of the same rule-design flaw** — after `producer_stall_not_flag_gated` conflating an
event counter with a scheduled producer, and `market_brief_lane_stale_or_missing` conflating one gap with
five. The pattern to watch for: *a rule reading one signal that carries two different meanings.*

Suggested refinement: split into `flag_unconfigured_adapter` (env-var-presence shaped) and
`flag_disabled_feature` (true state toggle), and group by family so the nine owner-enrichment flags
report as one finding with nine subjects. That would take `flag_long_dark` from 15 findings to ~5.
