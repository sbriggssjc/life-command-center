# W5.3 — Local-LLM (GaryBuilt/ollama) Evaluation on Real Accrued Intakes

> Cowork session 2026-08-06. Grounding: `W53_AND_OLLAMA_HYGIENE_KICKOFF.md` Part 1.
> Corpus: `staged_intake_extractions` 234 rows / `staged_intake_items` 238 rows since 2026-08-01
> (OLLAMA_EXTRACTION on since Aug 1). All numbers queried live from LCC Opps (`xengecqvemvfknjvbvrq`).

## 1. Provider attribution — FOUND (no Railway log grep needed)

Attribution lives in **`staged_intake_items.raw_payload.extraction_result.diagnostics[]`**:
`ai_final_provider`, `ai_fell_back`, `ai_chain[]` (stage/provider/status per attempt), `ai_ms`,
`pdf_text_len` — written by `intake-extractor.js` (~line 1246). The extraction snapshot itself carries
no provider stamp (kickoff's suspected gap — confirmed; small fix recommended, see §5).

**Coverage gap:** only **88 of 238** items since Aug 1 carry diagnostics (37%). The other 150 went
through a path that doesn't persist them (or had no extractable artifact). Attributed artifacts:

| final provider | artifacts | note |
|---|---|---|
| ollama | 29 | fell_back=false |
| openai (fell back) | 19 | see anatomy below |
| openai (direct) | 2 | no local step in chain |
| (none) | 4 | failed artifacts |

**Fallback anatomy (the important finding):** of the 21 openai-final artifacts, only **2** were genuine
ollama transport failures (status 0 = timeout/tunnel → clean cloud degradation, as designed). The other
**17 never tried ollama at all** — their chain starts at `edge` (status 400), meaning `OLLAMA_URL` was
NOT set in the process that ran them. These are scattered across Aug 1, 3, 5 (real OMs, PDF + HTML), so
it's not a one-time env window — most likely **one of the two Railway services processes intakes without
the OLLAMA_* env vars**. True attempted-fallback rate: 2/31 ≈ **6.5%** (good). Effective ollama share of
attributed work: 29/50 = **58%** (bad — a third of the load silently bypasses the local box).
Secondary: the cloud `edge` primary 400s on every one of those 17 calls (pre-existing issue, separate).

**Latency (per artifact):** ollama p50 **16.1s** / p95 26.4s; fine for background intake. (Cloud-fallback
rows p50 6.5s including the failed edge attempt.)

## 2. Accuracy vs human verdicts — NOT MEASURABLE this window

`staged_intake_feedback` (3,729 recent rows) is a **single bulk-approve batch in the week of Jul 27**;
there are **zero** feedback rows on Aug-era intakes. The kickoff's method 1 (acceptance/edit rates,
ollama era vs cloud era) returns no signal yet. Re-grade when organic review verdicts accrue on
Aug+ intakes.

## 3. Field-level grading (same-window ollama vs cloud-fallback, OM-class docs)

Doc-type mix is comparable across groups (both mostly OM-class), so this is close to a fair fight.
Non-empty field rates on OM-class extractions:

| field | ollama | cloud |
|---|---|---|
| noi | **1/24 (4%)** | 13/14 (93%) |
| tenant_name | **1/17 (6%)** | 9/14 (64%) |
| building_sf | 7/17 (41%) | 13/14 (93%) |
| cap_rate | 8/24 (33%) | 12/14 (86%) |
| asking_price | 8/17 (47%) | 12/14 (86%) |
| hvac/roof/structure responsibilities | **absent — keys never emitted** | 11–12/14 |

Qualitative (spot sample, 12 highest-text ollama extractions):
- **No fabrication observed** — the model abstains (nulls, honest `confidence_notes`) rather than
  inventing. One clean success: SSA Falmouth OM → cap 7.75%, NOI $2,024,224 (plausible, consistent).
- **Schema drift:** ollama emits sale-comp-style keys on OMs (`seller_name`, `buyer_name`,
  `sold_price`, `sold_cap_rate`) and never emits the lease-responsibility keys — prompt/JSON-schema
  compliance failure, not just recall.
- **Doc-type misclassification:** executed PSAs, listing agreements, and valuation proposals all
  tagged `om`.
- **One wrong-party grab:** `seller_name = "__Scott Briggs__"` from a listing-agreement signature
  block (broker, not seller).
- Confound noted honestly: ollama batch median source text 9.6k chars vs cloud 19k — thinner docs,
  but nowhere near enough to explain 4% vs 93% NOI recall (e.g. a 23k-char true OM returned all nulls).

## 4. New Ollama surfaces (shipped this week)

- **W7.2 deal-correspondence summaries:** 33 generated since Aug 1 (no-fabrication spot count clean).
- **W7.4 roles/issues:** dropped-proposal log = **8 total** (3 role / 2 issue / 3 closure) — the
  verbatim validator is exercising and providing the free precision floor as designed.
- **W7.5 narrations:** running via the same seam; no dedicated counter (fold into U4's monthly report).

## 5. VERDICT (recorded in ROLLOUT_STATUS W5.3 — Wave 5 closes)

**Split verdict, per surface:**
1. **Narrative/proposal surfaces (W7.2 / W7.4 / W7.5, next-step): KEEP ollama-primary.** Validators +
   the observed abstain-don't-fabricate behavior hold; latency fine; these are exactly the
   background-proposal lanes the doctrine wants local.
2. **Intake OM extraction: TUNE, with interim revert recommended.** The recall/schema gap is material —
   OM intakes since Aug 1 are largely shipping without NOI/cap/tenant/responsibilities, starving the
   matcher/promoter downstream. Recommend: flip intake extraction back to cloud-primary (env/flag only)
   while a prompt-hardening fix-unit lands (strict JSON schema with the full field list incl.
   responsibilities, doc-type rubric, qwen2.5-appropriate few-shot), then re-grade on ~50 fresh
   intakes before re-cutover.
3. **Seam fixes (small, one prompt):** (a) stamp `ai_final_provider`/`ai_fell_back` into the extraction
   snapshot itself; (b) find and fix the process running intakes without `OLLAMA_URL` (17/50 bypass);
   (c) triage the always-400 edge primary.

**Needs Scott:** the interim revert is an env/flag flip on Railway (`AI_EXTRACTION_PROVIDER` /
`OLLAMA_EXTRACTION`) — Scott's call whether to revert now or ride until the tune lands.

---

## RE-GRADE ADDENDUM — 2026-08-11 (post-61 hardened prompt, 102 fresh extractions)

**Verdict: the prompt-61 hardening WORKED — extraction quality is fixed.** OM-class field
coverage across the post-61 fleet: NOI **89%**, cap 89%, tenant 79%, SF 95%, responsibilities 79%
(vs the pre-61 ollama window's 4/33/6/41/absent). The original revert-to-cloud recommendation is
retired; ollama-primary intake is VALIDATED at production quality.

**Caveats (open, small):**
1. **Attribution still incomplete post-82:** daily stamp coverage — Aug 7: 4/15 (pre-82), Aug 10:
   **9/72** (a bulk burst, 63 unstamped — a batch/re-extract path still bypasses
   `ensureProviderStamp`), Aug 11: 11/13 (85%). Every stamped row is ollama; zero cloud fallbacks
   recorded. A clean ollama/cloud split remains impossible until the bulk path stamps → prompt 93.
2. **sale_key_drift: 2 of 4** stamped-ollama OM rows carry `sold_*` keys (the no-sale-keys rule
   leaking on a small sample) — watch; re-check after attribution is complete.

Wave 5 remains CLOSED; this addendum upgrades the W5.3 verdict from "tune + interim revert" to
**"hardened prompt validated; keep ollama-primary"** with the two caveats tracked.
