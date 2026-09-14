# OCR1 — local OCR vs Google Document AI: the bake-off harness, and what could and could not be measured

> ✅ **UPDATE 2026-09-02 16:43 UTC — THE FIRST REAL RUN HAPPENED (Scott's workstation, tesseract only).**
> Findings and the artifact analysis live in `docs/claude-code/responses/done/OCR1-run.response.md`;
> this page is the harness design as delivered. ⚠️ Two of this page's own assumptions did not survive
> the run: surya 0.22 needs a Docker-hosted VLM server (GPU box, not the workstation), and
> `pip install paddleocr` does not install the engine (`paddlepaddle`). Also §6's `--self-test` needs
> Pillow on Windows.
>
> **Original status: HARNESS DELIVERED AND SELF-VERIFIED. THE BAKE-OFF ITSELF HAS NOT BEEN RUN, and no
> recommendation against OCR1 §5 is possible yet.** The sandbox cannot reach the documents
> (re-measured, not inherited: `http=000` to Supabase and Railway, `http=200` to GitHub). The
> harness runs on Scott's workstation or the GaryBuilt box; §6 below is the exact command sequence.
>
> **Nothing was wired.** `deps.freeOcr` still has no server-side producer. The live drain, the 42
> `over_docai_page_cap` markers and the DOC18 work are untouched.

> ✅ **UPDATE 2026-09-02 — OCR1c HARDENED THE HARNESS (§8 below). No real-document verdict changed:
> the sample on file is still 10 arm-A documents, tesseract only.** The 77% agreement rate that run
> produced remains **uninterpretable until `--control self` is run**, which is exactly what OCR1c
> added. **Re-run command in §8.6.**

**Deliverables:** `scripts/ocr-bakeoff.mjs` (harness, 20 self-test assertions green against a real
engine) · `test/ocr-bakeoff.test.mjs` (30 guards, **9/9 then 25/25 mutations RED**).

---

## 1. ⚠️ The cost case does not support this build, and this document does not make it

Re-stated because it is the most likely thing to be quoted wrongly later: across the whole CRE
sidecar, **185 of 362 documents (51%) already extract for free**, only 111 ever needed OCR, and
total DocAI spend to date is **574 billed pages ≈ $0.86**. Whole-corpus estimate: **$23–53**.

**Local OCR is worth building for the PAGE CAP and for CONFIDENTIALITY. It is not worth building to
save money, and any writeup arguing from savings is arguing from a number that refutes it.**

## 2. What was measured (and one thing I got wrong first)

### 2a. Engines available in the sandbox: **none**

Probed on arrival: `surya_ocr`, `paddleocr`, `ocrmypdf`, `tesseract`, `pdftoppm`, `pdftotext`,
`marker_single` — **all absent**. To prove the harness against a real engine rather than a stub I
installed **tesseract 5.3.4 + poppler-utils** (`apt-get update` first — the image's package index was
stale and poppler 404'd until it was refreshed). Surya/PaddleOCR were not installed: both pull
torch, and neither is the engine the decision rests on — that is the GPU box's job.

**So the sandbox can prove PLUMBING and cannot produce a QUALITY VERDICT.** Those are different
claims and this document keeps them apart.

### 2b. The arm A population reproduces §6a exactly

Live on LCC Opps, `extractor_version='unit1_v1'`, `method='ocr'`, `ocr_tier='cloud_cheap'`:

| doc | type | pages | chars |
|---:|---|---:|---:|
| 336 | lease | **30** | 95,981 |
| 431 | lease | 26 | 68,307 |
| 425 | lease | 26 | 51,671 |
| 327 | lease | 25 | 59,181 |
| 255 | lease | 25 | 43,693 |
| 386 | dd | 20 | 57,090 |
| 343 | dd | 16 | 44,031 |
| 299 | lease | 16 | 38,103 |
| 436 | lease | 16 | 18,633 |
| 228 | dd | 15 | 39,345 |

**The longest DocAI baseline in the entire corpus is exactly 30 pages** — the cap. §6a's structural
claim holds: "a lease over 30 pages WITH a baseline" cannot exist, because the cap is why it has none.

⚠️ **Doc 336 is 95,981 chars, over `LEASE_TEXT_SLICE_CHARS = 90,000`** — so even the largest arm-A
baseline is already truncated before the model sees it. Both sides are truncated identically, so the
comparison stays fair, but it is not a whole-document comparison. See §4.

### 2c. The arm B population is 42 documents, not the 4 §6a names

`reason='over_docai_page_cap'`: **42 docs · 37 leases + 5 DD · 2,200 pages · 31–141pp · mean 52.4 ·
24 of them over 50 pages.** §6a's four (319/141pp, 320/118pp, 200/63pp, and a 39pp lease) are a
sample of it, and the head of the list also holds 407 (59pp), 140 (59pp), 199/182 (58pp) and a long
tail at 56–57pp that the brief does not mention. Arm B should be drawn from the whole 42, not the 4.

### 2d. ⚠️ I misread chars-per-page first, and the correction matters

I first measured **2,195 chars/page** and was about to report that DOC18's window is sized on a wrong
constant. That figure is a **sum-weighted aggregate**, dominated by the largest documents — it
answers a different question. Per document:

| | min | p25 | **median** | p75 | p90 | max |
|---|---:|---:|---:|---:|---:|---:|
| chars/page (87 OCR'd docs) | 558 | 1,173 | **1,738** | 2,251 | 2,751 | 4,199 |

**DOC18's "~1,800 chars/page ⇒ ~50 pages" is correct at the median (52 pages).** The real finding is
narrower and still load-bearing: **at p90 density the 90,000-char slice holds only 33 pages.** For a
text-dense lease the binding constraint is already the extractor, not the OCR cap.

## 3. The harness

`scripts/ocr-bakeoff.mjs`. Two arms, because the sample §2 of the brief asks for cannot exist:

| arm | input | graded on |
|---|---|---|
| **A** | `bakeoff/<id>/source.pdf` + `docai.txt` | field agreement vs the DocAI baseline |
| **B** | `bakeoff/<id>/source.pdf` (no baseline) | consumer-field coherence + back-half clause legibility over the FULL local text |

Both arms drive the real consumer, `extractTenantFromLease`, through **one injected model** so the
comparison measures OCR and not the model (§6c). The model is recorded in the report, and a run made
with the offline stub prints a red banner refusing to be read as a bake-off result.

### 3a. ⚠️ The both-null trap is the whole metric design

If a document defeats both engines, every field is null on both sides and naive equality reports
**100% agreement over a total failure**. So:

- `both_null` is **its own verdict** and is never counted as agreement.
- `agreement_rate = agree / (agree + disagree + local_only + baseline_only)` — the denominator
  **excludes both-null by construction**.
- A document where every field is both-null returns `agreement_rate: null`, **not 1.0**.
- `both_null` is printed on every row, so a non-discriminating sample is visible rather than flattering.

`local_only` (local found a value DocAI missed — a local WIN) and `baseline_only` (local lost a value
DocAI had — a local LOSS) are kept distinct; neither is agreement.

### 3b. 🔴 That design immediately caught a real defect in the harness itself

The first run scored `agree 4/4, both_null 2` on a fixture that **states all six values**.

Cause: `extractTenantFromLease` **renames on the way out** (`bov-extract.js`) — `tenant_name → name`,
`leased_sf → sf`. The brief names the graded fields by the model's JSON keys, I coded them that way,
and those two keys **do not exist on the object being graded**. Reading `undefined` normalized to
null on both sides and scored `both_null` — *a field silently not measured, wearing the same label as
a field both engines genuinely failed on.*

**This is CLAUDE.md's C10 class exactly** (*a consumer can read columns its source has never had, and
nothing errors*), and it survived because the polite fallback rendered as plausible absence.

⚠️ **Had I counted both-null as agreement — the naive design — this would have rendered as 6/6, 100%,
for two fields the harness never read.** The rule that makes the metric honest is what exposed it.

Guard: `assertGradedFieldsReadable()` runs as a **positive control on every real run** and in the
self-test, and names any graded key the consumer does not emit.

### 3c. Verified on a synthetic fixture, with a real engine

Three tiers rendered as image-only PDFs (so OCR is genuinely exercised) from known text:

| fixture | chars | ocr_confidence | wordlike | clauses | agreement |
|---|---:|---:|---:|---:|---|
| clean | 518 | 96.0 | 0.738 | 4/4 | **6/6, both_null 0** |
| noisy (bad fax) | **575** | 48.3 | 0.532 | 4/4 | **4/6, 1 disagree, 1 miss** |
| degraded | — | — | — | — | OCR returned nothing |

⚠️ **The noisy tier produced MORE characters than the clean one (575 vs 518) and a WORSE answer.**
That is the brief's warning demonstrated on live output: `char_len` is not a quality metric, and here
it is actively anti-correlated. `ocr_confidence` (96 → 48) and `wordlike_ratio` (0.74 → 0.53) both
track quality correctly, which is why the report carries them and ranks on neither.

The named disagreements read exactly as intended:

- `tenant_name` — **disagree** — docai `Blackwood Medical Partners LLC` · local `Blackwood Medical Partners uc`
- `year1_rent` — **baseline_only** — docai `412500` · local `null`

⚠️ **Two of my own assertions were worthless before the mutation pass.** The first "degraded is worse"
check passed on a **1-character** difference — noise — because my first degradation was too gentle;
after strengthening it, the check then evaluated `undefined` when the engine failed outright and read
false, unable to express the *most* degraded outcome. Both fixed: a ≥10% margin, and engine failure
treated explicitly as worse.

### 3d. Guards

`test/ocr-bakeoff.test.mjs` — 11 tests, **9/9 mutations RED**: both-null counted as agree (3 red) ·
both-null in the denominator (2) · an empty document scoring 1.0 (1) · a local miss counted as agree
(1) · a graded key reverted to the model's JSON name (3) · the readability control stubbed clean (1) ·
a numeric tolerance smoothing digit errors (1) · empty text scoring 0 instead of "cannot be measured"
(1) · clauses always found (1).

## 4. 🔴 A finding that changes OCR1b's scope: removing the OCR cap does not give the consumer the whole lease

`LEASE_TEXT_SLICE_CHARS = 90,000` (`bov-extract.js`) caps what reaches the model, and
`OCR_WINDOW_TARGET_PAGES = 50` is derived from it — the two are deliberately bound by
`test/doc18-three-call-sync-extract.test.mjs`.

An uncapped local engine removes the **acquisition** ceiling: we would hold the text of all 141 pages.
It does **not** remove the **consumption** ceiling — the extractor still slices at 90k chars, which
is ~52 pages at median density and **~33 at p90**. So for the 24 over-cap documents above 50 pages,
"no page cap" delivers full text on disk and a partially-read lease at the consumer.

That is still a genuine and large win — the text becomes free, re-readable, and available to any
future consumer — but **OCR1b must state which ceiling it is moving**, and a claim that local OCR
"dissolves the page-cap class of problem" is only true of acquisition. Whether to raise
`LEASE_TEXT_SLICE_CHARS`, chunk the lease, or target the model at located clauses is a separate
decision with its own cost, and this document does not make it.

Arm B's **model-independent** clause scan exists for exactly this: it reports whether renewal,
early-termination, default-cure and holdover language is legible in the full local text and where it
sits, regardless of what the extractor's slice reaches.

## 5. Fail-soft detection (OCR1 §3) — "the box is down" vs "the document has no text"

The tier chain already falls through on `{ok:false}`, so a local miss reaches DocAI. What it cannot
currently do is **tell the two apart**, and conflating them is how a lane silently stalls.

Proposed for OCR1b, not built here:

| condition | signal | consequence |
|---|---|---|
| transport failed (tunnel/CF Access/service down/timeout) | `{ok:false, reason:'freeocr_unreachable:<detail>'}` | fall through to DocAI **and** open a deduped `lcc_health_alerts` row — an unreachable Tier 1 is an outage, not a document property |
| engine ran, produced nothing | `{ok:false, reason:'<engine>_empty'}` | fall through to DocAI, **no alert** — a genuinely unreadable page |
| engine ran, produced text below the confidence floor | existing `OCR_FREE_CONFIDENCE_MIN` path | existing escalation |

⚠️ **Assert on the state delta, never on the tier tally**: the number to read is DocAI billed pages
per week. If Tier 1 is working, that falls; if the box is quietly down, it does not move and every
receipt still reads healthy — which is the shape this repo has been caught by repeatedly.

⚠️ **Use a dedicated CF Access service token, never the ollama one** (SOS proxy precedent,
government-lease §25; the same warning is already inline at `contact-acquisition-engine.js:74`).

## 6. 👤 How to run it — Scott's workstation or the GaryBuilt box

The sandbox cannot: `http=000` to `*.supabase.co` and to Railway (re-measured 2026-09-02), and the
PDFs are SharePoint server-relative refs reachable only through the Power Automate flow.

```bash
# 0. engines. tesseract is the floor; surya/paddleocr are the ones worth grading on the GPU box.
pip install surya-ocr paddleocr          # optional but this is the point of the exercise
#   ubuntu: sudo apt-get update && sudo apt-get install -y tesseract-ocr poppler-utils

# 1. plumbing check — no network, no model, no real documents
node scripts/ocr-bakeoff.mjs --self-test

# 2. arm A baselines (needs OPS_SUPABASE_URL + OPS_SUPABASE_SERVICE_KEY in .env.local)
node scripts/ocr-bakeoff.mjs --fetch-baselines 336,431,425,327,255,386,343,299,436,228

# 3. drop each document's PDF in as bakeoff/<id>/source.pdf
#    arm B (no baseline, over-cap): 319 (141pp), 320 (118pp), 200 (63pp), 407 (59pp), 140 (59pp)

# 4. run it. --model real routes through invokeExtractionAI (the box's Ollama).
node scripts/ocr-bakeoff.mjs --run --model real

# read bakeoff/agreement.md
```

⚠️ `bakeoff/` is git-ignored — it holds client lease text and must never be committed.

**Sanity checks on the output before believing it:**

- **`both_null` per row.** A high share means the sample did not discriminate — not that local matched.
- **The model column.** A stub run prints a red banner; a real run must show the same model on both sides.
- **`agree` must be non-trivial.** If everything is `both_null` the rate reads `—`, by design.
- **State the sample size in every claim.** This arc has had three rates move materially when the
  sample grew.

## 7. What this does NOT conclude

**No row of OCR1 §5 is selected.** Selecting one requires arm A field agreement on real leases, and
that has not been run. What exists so far:

- The harness, self-verified against a real engine, with the metric trap closed and guarded.
- Confirmation that the two arms are the right shape, and that arm B's population is **42 documents /
  2,200 pages**, not 4.
- One scope correction for OCR1b (§4) that holds whichever way the bake-off lands.

The honest next step is Scott running §6. **If local loses badly, "DocAI stays the workhorse and this
is recorded so it is not re-proposed" is a legitimate outcome** — the harness is built to be able to
say that.


---

# 8. OCR1c — the model self-agreement control, and three things the first run could not report (2026-09-02)

**Harness-only. Nothing was wired, no real document was run** (the sandbox still cannot reach
Supabase or SharePoint). `tesseract 5.3.4 + poppler-utils` were re-installed here so the self-test
exercises a real engine rather than a stub; **Pillow had to be `pip install`ed, which is the same
gap §8.3 fixes on the operator side.**

## 8.1 Why the 77% had no meaning

The first real run scored **36 agree / 11 non-agree / 12 both-null over 47 graded fields**. Reading
the eleven — rather than counting them — found **at least 6 were harness or model artifacts**:
2 were `Kohl's` vs `Kohl’s`, 2 were `""` vs `null` scored `candidate_only`, 2 were the MODEL doing
different arithmetic on text both sides carried verbatim, and 4 date disagreements had **no
attributable cause at all** without knowing how much the model disagrees with itself.

**So the number that was missing is the FLOOR.** If the model, run twice on the identical DocAI
text, agrees with itself 80% of the time, then tesseract's 77% is a WIN. If it agrees 99%, 77% is a
loss. The harness could not tell those apart, and neither could any reader.

## 8.2 `--control self` — the floor, printed above every engine table

For each arm-A document the harness now runs `extractTenantFromLease` **a second time on the DocAI
text** and scores run 2 against run 1 with the **same `scoreDocument`**, the same both-null
exclusion, the same normalizer. `summarizeSelfControl` rolls it up per field; the report prints it
**above** the engine tables with the sentence *"an engine's rate is only meaningful relative to this
row"*, and the per-field engine table gained a **`rate − self`** column.

- **Two independent calls, deliberately NOT `temperature=0`.** Pinning a seed would measure a
  configuration nobody runs and report a 100% floor the pipeline never has. A guard fails on any
  `temperature`/seed pinning appearing in CODE.
- **`self_disagree` folds `disagree` + `candidate_only` + `baseline_only`.** Run 2 finding a value
  run 1 did not is the model failing to agree with itself, not a win for anybody; counting only
  `disagree` reads the floor higher than it is.
- **`both_null` is excluded from the denominator, on the SAME rule as the engines** — otherwise the
  two rates are not comparable and the subtraction is meaningless.
- **`deltaVsSelf` returns `null`, never 0, when either side has no decided field.** 0 reads as *at
  parity with the model*; the truth is *not measured* (P180).
- **A report generated WITHOUT the control says so in red**, rather than printing a bare rate a
  reader will take at face value.
- **Cost: 10 extra model calls per run**, on the box.

⚠️ **On the stub the floor is 100% by construction** (the offline extractor is deterministic). The
self-test asserts exactly that and labels it *plumbing only, NOT a model floor*.

## 8.3 The comparator artifacts, normalized — and the line that was NOT crossed

`normalizePunctuation` maps curly quotes/apostrophes, en/em dashes and NBSP to ASCII and collapses
whitespace. `isNullSentinel` treats `""`, `null`, `N/A` and a dash placeholder as "the source did
not state this", **before** the both-null / candidate-only decision. Numbers additionally strip a
trailing `sf` unit and round.

- ⚠️ **Rounding is not a tolerance.** `412500.4` and `412500` are one rent read two ways;
  **`412500` vs `412600` stays a DISAGREEMENT** — that digit error is the whole reason the bake-off
  exists. Guarded, and mutation-verified by turning the round into a 1,000-unit bucket.
- ⚠️ **The sentinel list is narrow ON PURPOSE.** `0` is a value. `Nullarbor Holdings LLC` and
  `N/A Property Group` are names. Widening it is how a genuine miss gets hidden as `both_null`, so a
  guard mutates `isNullSentinel` into a general "looks empty" test and goes red.
- **The RAW pair is still reported on every disagreement**, so a normalization can never hide a
  difference a human would call real.

## 8.4 Failure reporting — the 36 identical warnings

`stderrTail` shows the **last 300 characters**, because the first 160 were a
`RequestsDependencyWarning` on **all 36** first-run failures and hid **both** real causes. Every
engine failure reason was repointed at it; a guard greps for any `stderr…slice(0, N)` returning.

The probe now answers a question it previously could not:

| engine | before | after |
|---|---|---|
| `paddleocr` wrapper present, `paddle` runtime absent | `available: true` → 18 failures | **`available: false`** — *"wrapper only … pip install paddlepaddle"* |
| `paddleocr`, no python on PATH | — | `available: true`, note **UNVERIFIED** (tri-state: *cannot check* ≠ *missing*) |
| `surya` needing a VLM server, Docker down | `available: true` → 18 failures | **`available: false`** — *"runs a VLM server via Docker … intended for the GPU box"* |
| `surya`, Docker up | — | **`available: true`** — the GPU box must still be able to run it |

⚠️ **Positive-controlled live, not only in the pure classifier**: a fake `paddleocr` on PATH that
answers `--version` and has no runtime reproduces the workstation's exact state and the probe now
reports *"wrapper only … pip install paddlepaddle"* instead of running it 18 times.

`--self-test` names the fix (`FIX: pip install pillow`) rather than reporting the failure and
stopping — classified from the stderr, with a generic fallback and a distinct message when `python3`
itself is absent.

## 8.5 Arm B carries the VALUES, not only a count

`5/6 fields found` at OCR confidence 68 on a title/docs bundle is indistinguishable from 5/6 on a
clean lease **until somebody reads the values**. They already existed in memory; every candidate now
carries `graded_values` + `fields_found` into `agreement.json`, and the report renders a *"Field
values as read"* table stating plainly that nothing in it is verified. `fields_found` uses the
sentinel rule, so an `N/A` no longer counts as a field found.

*(`bakeoff/` is git-ignored — these are client lease values and never leave the box. This page and
the response file stay values-free.)*

## 8.6 The re-run, and what it will and will not settle

```
pip install paddlepaddle
node scripts/ocr-bakeoff.mjs --run --engines tesseract,paddleocr --control self
```

Read, in this order: the **self-agreement floor** table · then each engine's `rate − self` column ·
then the named disagreements. Surya still belongs on the GaryBuilt box (Linux + RTX), where the
probe will now say so instead of failing 18 times.

**⚠️ This changes no verdict about local OCR.** The sample on file is still **10 real arm-A
documents, tesseract only**, and no row of OCR1 §5 is selected. What changed is that the next run's
number will be readable.

## 8.7 Guards (`test/ocr-bakeoff.test.mjs`, 30 tests, 25/25 new mutations RED)

Comments are stripped before every source assertion — the fix's own prose names `.slice(0, 160)`,
the sentinel spellings and `works_at`-style banned tokens repeatedly while explaining them (A5c /
N18).

⚠️ **AND ONE ASSERTION NEEDED THE LITERALS BLANKED TOO, WHICH IS A NEW CASE.** The rendered report
says, in a pushed string, that the control is *"deliberately NOT `temperature=0`"* — so the
anti-seed-pinning grep matched the sentence explaining the rule and went RED over correct code on
its first run. **A detector for a CODE shape must blank string literals as well as comments.**

⚠️ **And the ORDER is load-bearing: comments FIRST, then literals.** A bare apostrophe in ordinary
prose (*"the engine's output"*) opens a string the blanker never closes correctly and swallows real
code behind it — which is exactly how the positive-control mutation for that assertion **survived
its first mutation run**. Found by the mutation pass, not by reading it.
