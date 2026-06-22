# Capital Markets session status — consolidated (2026-06-22)

> Single source of truth for everything built/verified/pending across this session. Status legend:
> **✅ LIVE** = applied + verified live · **📦 SHIPS** = committed, lands on next Railway/pipeline
> deploy · **⏳ OP** = needs a Scott operational step · **🔎 OPEN** = surfaced, not yet built.

## 1 — Part 2: underwriting data-quality (UW#1–7)
| # | What | Status | Note |
|---|---|---|---|
| UW#1 | County digest (assessed/tax → properties) | ✅ LIVE | Honest result: county data ~99% zero-sentinels; only 64 real gov assessed values digested. Bulk lever dead; assessed = per-deal CoStar grab. ≤0-guard + forward hook committed. |
| UW#2 | Lease-document extractor activation | ✅ LIVE | Drain ran (50 docs); 0 clobbers; 96 conflicts→Decision Center. Coverage barely moved — folder feed only covers the deal book; per-deal tool, not bulk. |
| UW#2b | Lease extractor fixes (rent units / conflict noise / dedupe) | ✅ LIVE | Re-drain verified: rent reconciled to annual, cosmetic conflicts gone, material conflicts remain, 0 clobbers. |
| UW#3 | Cap-rate derivation | ✅ LIVE | Honest 8 dia caps (gov ~0 — gov cap gap is price, not derivation). |
| UW#4/4b | Lease OCR (free-first tiered) + cost optimization | 📦 SHIPS | Free OSS (Surya/Paddle) workhorse; cheap-cloud escalation; gpt-4o last-resort. |
| UW#4c | Google Document AI cheap-cloud OCR | 📦 SHIPS / ⏳ OP | Wrapper built; needs GCP provisioning (Scott) + the OCR_CLOUD_* envs. Decision: Document AI primary (≈$0 on $300 credit), gpt-4o fallback. |
| UW#5 | Federal demand-signal digest | ✅ LIVE | The real lever was a bug (hiring_signal 0% from a location-format mismatch) → 2,549 real per-metro hiring aggregates; FRPP/OPM already digested. |
| UW#6 | Document deep-parse (deeds/leases/OM) | ✅ LIVE (foundation) / 📦📦 | ARCHITECTURE PROVEN: byte-captured deeds parse `via:'storage'`. Blocker was CoStar CDN session-gated URLs → fixed with sidebar byte-capture (UW#6-REV). Defects fixed (reliability/OCR/threshold/status/doctype). PAYOFF gated on (a) a fresh capture, (b) deed OCR (deeds are scans). |
| UW#6c | Press-release→other doctype backfill | ✅ LIVE | 41 gov + 16 dia re-typed; 0 remaining; reversible log. |
| UW#7 / 7b | Developer resolution from ownership chain | ✅ LIVE | Bounded view applied; dry-run 200/~2s; person-name + financier origins rejected (15 person rejects); ~37 real-org developers resolvable. Cron writes them. |

## 2 — Work products + comps
| What | Status | Note |
|---|---|---|
| Work-Product Framework (E1–W2) | 📦 SHIPS | Single brand layer + shared grammar; 5 types. PRs merged. |
| Canonical lease-comps merge (26-col, Calibri) | ✅ LIVE | Aligned to the deployed dialysis export; one canonical template; protected columns intact. (#26 — verify samples visually.) |

## 3 — Deed/loan ingestion answer (your 6 questions)
Capture ✅, ownership_history updates ✅ (15.7k rows, 11k/90d), reconciliation ✅ (R51, 882 conflicts),
prospects + sale alerts ✅ (9.5k linked leads, R53 826 suspected sales). **Gaps:** developer ID (UW#7,
now live) + deed deep-parse (UW#6, foundation live, payoff OCR-gated). Deed *index* grantor/price is
source-limited (not fixable); real grantor/price = the deed PDFs via byte-capture + OCR.

## 4 — Gov post-deploy incident + hotfix
- **Incident:** gov DB connection-pooler saturation, caused by my repeated dry-run probes against the
  pre-fix unbounded resolver (each held a connection to statement-timeout). Contained; DB restarted;
  recovered. Lesson logged: never repeatedly probe an unbounded/slow endpoint.
- **Hotfix:** Issue 1 (bounded view) ✅ LIVE + cron 143 re-enabled. Issues 2 (lead_source — corrected
  diagnosis: score-sync upsert, NOT the propagate functions; minor impact, leads creating fine), 3
  (bls area→area_name), 4 (bid_ask validate-writer) 📦 SHIP on next gov Python pipeline run.

## 5 — Audits delivered (findings)
| Audit | Verdict |
|---|---|
| #34 OM/BOV assembly readiness | gov ~60% core-ready (escalations the gap); dia ~19% (lease economics 32% — per-deal, not bulk). Generator should assemble-what-exists + flag-missing, deal-book first. |
| #35 Comps quality | Accurate, not a coverage problem: 0 dup-leaks both DBs; caps sound (fraction-stored — render ×100); exclusion working. Coverage thin on gov price (R53). |
| #36 SF/pipeline | Data clean (SF sync 61.6k/7d, 0.02% errors; deduped graph). Pipeline thin: 7 opps (R5/R6 gating by design), 4 cadences ever touched — activation gap, not data. |

## 6 — Your operational TODO
1. **Merge the PR stack** across the three repos (UW#2b/4/4b/4c/6-REV/6-fix/6c/7b + hotfix #303 + lease-comps + framework) and redeploy.
2. **Provision GCP Document AI** (UW#4c) + set `OCR_CLOUD_*` envs → enables the broad deed/lease OCR drain (≈$0 on the $300 credit). I can walk you through the console.
3. **Capture a fresh CoStar deal** with the v1.0.20 extension → I run the UW#6 OCR re-gate (byte-capture → deep-parse → OCR → grantor → R51).
4. **Visually eyeball** the work-product samples (#26) — drop any into D:\ for my independent check.

## 7 — Surfaced, not yet built (🔎 OPEN follow-ups)
- Broken gov queries (correction prompt issued): `sales_transactions.document_number`,
  `sf_comps_staging.id`.
- 430 gov out-of-band caps (R7 implausible lane); confirm comp/BOV templates render cap ×100.
- dia developer resolution (UW#7 deferred for dia — thin signal).
- Outreach activation (the #36 finding) — the cadence/contact-acquisition levers (R16/R20/OUTREACH#1).
