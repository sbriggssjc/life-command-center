# Claude Code queue — STATUS  (updated 2026-08-01, session 2d)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 16 | Live-apply & config (migrations + CENSUS_API_KEY) | P0/P1 | open — several fixes code-done, not live |
| 10 | PA flow failures (SF Opp Sync = the Option-B fill path; LCC Get Artifact) | P0 | open |
| 09 | field_source_priority #710 | P0 | **code done; live apply in 16** |
| 13 | Property & Contact tab connectivity | P1 | open |
| 14 | government-lease CI Test & Lint (68b293a) | P1 | open |
| 17 | Data-integrity (is_northmarq flag + sale_brokers constraint) | P1 | open |
| 11 | Comps: connector reach + bounded output | P1 | open |
| 12 | LCC Health surface (observability) | P1 | open |
| 07 | Data-backlog index (0-6 closed; 7-8 in prompt 16) | mixed | index |

## Done (in `done/`)
01 cap-rate (#1551) · 02 connect deal spine + 06 schema (#1552) · 03 broker role · 04 loan propagation (fleet:
124 loans + 204 mortgage rows) · 05 resolver-by-property-id · 08 Deal-tab UI · followups 2/3/4/5/6 · trade-area
map+Places (f8 partial). 15 RETIRED (Option B).

## Recommended sequence
1) **16** (apply the code-done migrations + CENSUS key; get #710 audit green + relocation/demographics live).
2) **10** (fix PA flows — SF Opportunity Sync is now the fill path; many HTTP flows may already have recovered
   post-deploy of 1aae4e20). 3) **13** (property/contact connectivity) + **17** (data-integrity). 4) **14** (gov
   CI), **11** (comps reach), **12** (health surface).

## Notes / needs Scott or creds
- **Env keys:** CENSUS_API_KEY (radius demographics); SUPABASE_ACCESS_TOKEN / migration creds (apply #710 +
  relocation migrations live).
- **35724 is a Northmarq deal but is_northmarq=false in the data** — prompt 17 traces + fixes the flag.
- Deal-tab UI + deal spine are live in code; confirm on a redeploy with Supabase env.

## Process: see `README.md`.
