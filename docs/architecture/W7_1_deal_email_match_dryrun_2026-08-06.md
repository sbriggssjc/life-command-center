# W7.1 — Deal-email matcher: full-corpus dry-run report (2026-08-06)

> **Approval gate.** Scott reviews this before the matcher goes on a live recurring
> cadence. The matcher writes NOTHING in dry-run; the numbers below are what a live
> run *would* attribute. Approve → set `DEAL_EMAIL_MATCH_ENABLED` in Railway (flips the
> `DEAL_EMAIL_MATCH_CRON` feature flag on); the hourly `lcc-deal-email-match` cron then
> runs the matcher for real. Idempotent by `(entity_id, external_id)` — re-runs never
> double-attribute.

## Method
Reproduces `mcp/deal-email-matcher.js` v2.1 exactly against live LCC Opps
(`xengecqvemvfknjvbvrq`): in-scope = open Team-Briggs deals (owned OR `sf_opp_team`
asset OR `team_briggs_include`). For each, `core_tenant` (generic descriptors stripped)
+ `city` are matched **word-boundary** against `activity_events` of `source_type='outlook'`,
requiring **BOTH** tenant AND city present; the self-referential pipeline digest is excluded.
City stays **required** (the v2 tenant-alone recall mode was refuted — see the matcher header).

## Scope
- **37 in-scope open deals** (all 37 carry a city).
- **16 deals** would attribute ≥1 email; **21** would attribute 0 (mostly address-named deals
  whose mail doesn't carry the tenant+city shape — these are the v2 email-search recall target,
  not a precision miss).
- **~306 candidate attributions** total (before idempotency; the ~90 already deal-tagged from
  the prior ran-once pass dedupe out on the live run).

## Per-deal distribution (would_attribute, top → down)

| Deal | core_tenant | city | would_attribute | sample title |
|---|---|---|---:|---|
| DaVita Dialysis - Queens - NY | DaVita | Queens | 51 | "Here is the full OM for the DaVita in Queens, NY" |
| DaVita Dialysis - Banning - CA | DaVita | Banning | 50 | "6050 W Ramsey St Banning, CA — DaVita Building" |
| DaVita Dialysis - The Villages - FL | DaVita | The Villages | 49 | "Closing Checklist - DaVita Dialysis - The Villages, FL" |
| DaVita Dialysis - Omaha - NE | DaVita | Omaha | 35 | "Here is the full OM for the DaVita in Omaha, NE" |
| DaVita Dialysis - Tucson - AZ | DaVita | Tucson | 34 | "Deal - DVA - Tucson AZ" |
| ECU Physicians MOB - Greenville - NC | ECU Physicians | Greenville | 27 | "Requesting OM: ECU Physicians MOB - Greenville, NC" |
| DaVita Dialysis - Succasunna - NJ | DaVita | Succasunna | 17 | "Reg: Davita, 175 Righter Rd, Succasunna, NJ" |
| Fresenius - Rome - GA | Fresenius | Rome | 15 | "LOI - Rome, GA Fresenius" |
| Essentia Health - Hinckley - MN | Essentia | Hinckley | 8 | "ROFR on Hinckley, MN" |
| Concentra Urgent Care - Livonia - MI | Concentra | Livonia | 7 | "Concentra Urgent Care in Livonia, MI" |
| DaVita Portfolio 4 - Realty Income - May 2026 | DaVita | Realty Income | 5 | "DaVita 4pk - Realty Income PSA" |
| Pops Mart Fuels - Barnwell - SC | Pops Mart Fuels | Barnwell | 3 | "Absolute NNN Pops Mart Fuels … Barnwell, SC" |
| Fremont Plaza - Canon City - CO | Fremont Plaza | Canon City | 2 | "Fremont Plaza, 3245 E Highway 50, Canon City, CO" |
| 2155 Main Street East, Snellville, GA | (address) | Snellville | 1 | "LOI: DaVita - Snellville, Georgia" |
| 519 North Main St | (address) | New Ellenton | 1 | "Pops Mart Fuels 519 North Main St. New Ellenton SC" |
| Archbold Medical Center - Thomasville - GA | Archbold | Thomasville | 1 | "New Listing Alert" (body: Archbold + Thomasville) |

**0-match deals (21):** 100 Midland Ave (Glenwood Springs), 121 Park N Store (Van Alstyne),
2112 Lincoln Way E (Massillon), 2860 S US Hwy 83 (Zapata), 301 Alcide Dominique (Lafayette),
4775 N Green Bay Ave (Milwaukee), Action Behavior (Duncanville ×2), ATEK (Brainerd),
Community Bank & Trust (LaGrange ×2), CRC Health Group (Beaver), DaVita-Anchored (Springfield),
Fast Pace (Mount Washington), First Harvest CU (Deptford), Fresenius Portfolio 2 (Rome Summerville),
GSA-MSHA (Oakwood), HFH Greenfield (Bloomfield Hills), Pops Mart Portfolio 2, T-Mobile (Rancho Cucamonga).

## Precision read
Every sampled title is on-topic for its deal. The loosest cases are the three
address-named deals (core_tenant becomes the street) — all at `would_attribute = 1`
with an on-topic sample, so the blast radius is negligible. The city guard held: no
same-operator/different-city bleed (DaVita Tucson mail did NOT land on the Queens deal,
etc.). **Recommendation: approve the live run.** The 0-match deals are the recall gap the
v2 email-based search (design doc §v2) closes later — not a reason to loosen precision now.
