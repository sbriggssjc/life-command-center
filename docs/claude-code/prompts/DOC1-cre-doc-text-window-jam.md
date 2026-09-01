# DOC1 — the CRE doc-text drain has a fixed window and no cursor: 695 documents unreachable

**Read first:** `docs/architecture/document-capture-ocr-and-deeds.md` — **§0 in full**, it carries
the measurement and the refuted alternative · Dead-End playbook **Class 12** (a worker whose window
never advances — this is its **third** instance) · `CLAUDE.md` Consumption-Layer doctrine.

**One function in `api/_shared/cre-property-doc-text.js`.** No migration, no new cron, no new table.

---

## 1. The defect

`fetchEligibleCreDocs` (`api/_shared/cre-property-doc-text.js:265-290`):

```js
const reg = await q('GET', `lcc_cre_property_documents?...&order=id.desc&limit=${cap * 4}`);  // newest 60
const side = ...;                                    // which of THOSE 60 already have a sidecar
const rows = reg.data.filter((r) => !done.has(r.id)).slice(0, cap);
```

**It only ever looks at the newest 60 registry rows.** Measured live 2026-09-01:

| | |
|---|---:|
| lease/dd/om registry documents | **771** |
| …drained (have a sidecar row) | **76** |
| …**undrained** | **695** |
| **of the newest 60, already done** | **60 of 60** |
| id range of the population | **2 → 2317** |
| `max(document_id)` in the sidecar | **2317** |

**The window is saturated, so the diff is empty and `eligible` is 0 — permanently.** Cron 167 and
169 have been returning HTTP **200** every 30 minutes over 695 waiting documents:

```
{"mode":"eligible","doctype":"lease,dd,om","limit":15,"scanned":0,"eligible":0,"items":[]}
```

⚠️ **This lane has a live consumer** — `bov-extract.js:192-224` reads the sidecar
(`needs_ocr=is.false&raw_text=not.is.null`), groups into `{leases, dd, om}` and feeds
`extractTenantFromLease` and the DD/OM joins. **446 leases, 256 DDs, 69 OMs are not reaching BOV
extract.**

## 2. What to build

**Make the candidate scan advance.** The shape is yours, but it must satisfy:

- **It must reach id 2.** Assert this directly: after the change, `eligible` on a fresh tick must be
  **> 0**, and the ids it returns must include rows well below 2250.
- **It must terminate** — no unbounded page walk. Give it a page budget and report when the budget
  stopped it (`scan_capped: true`), so a capped scan is never mistaken for an empty queue.
- **Failures must keep self-excluding.** ⚠️ **Verify this before relying on it:** the sidecar
  currently holds `ocr_non_ok` (7), `over_ocr_cap` (3), `thin_ocr_result` (4) — i.e. **failed
  extractions DO write a sidecar row**, which is what makes oldest-first safe from a poison pill.
  **Confirm that on the code path, not from this table.** If any failure mode returns without
  writing a row, oldest-first will jam on it and you need the negative marker instead (P136).

**Oldest-first (`order=id.asc`) is the obvious candidate** and self-advances given the above. A
keyset cursor also works. **Do not simply raise `cap * 4` to a bigger constant** — that moves the
jam to row N+1 and makes it more expensive to see (P136's explicit finding).

## 3. ⚠️ What this must NOT do

- ⚠️ **Do NOT widen cron 160 (`doctype=deed` → `all`).** It is one `UPDATE cron.job` away and it is
  **refuted** — see §0 of the canonical page. `property_documents.raw_text` has **exactly one
  consumer and it is deed-only** (`document-text.js:235-243`); the other 732 rows would cost OCR
  spend to fill a column nothing reads. **Deeds are 325/325 and that lane is correct.**
- **Do not touch the `mode=jobs` lane's claim semantics.** `claimPendingJobs` is a different path
  with its own locking; this is the `mode=eligible` scan only.
- **Do not raise `limit` past the existing cap of 50**, and do not remove the 22 s tick budget.
  ⚠️ **There is no spend guard that halts a tick** — the budget and the batch cap are the only
  brakes, and this change is about to make the queue non-empty for the first time in a month.
- **Do not add per-doctype tier logic.** Tier selection is env-driven and uniform by design.
- **Do not backfill by hand in one pass.** 695 documents against a per-tick cap is ~a day of normal
  cron operation. A manual bulk run is a Class 8 chore and skips the budget.

## 4. ⚠️ Watch the spend on the first real run

This queue has been effectively empty since roughly 2026-07-18 — **every sidecar row since then is
`pdf_text` (free digital layer)**. The 695 have never been sampled, so their scanned/digital mix is
**unknown**. Of what ran before the jam: **12 rows went to gpt-4o** (`tier:'cloud'`,
`no_page_anchors_gpt4o`) against **3 to `cloud_cheap`** — the documented 6–14× escalation shape,
predating the 2026-08-12 DocAI fix.

**Report `ocr_by_engine` and `ocr_pages_total` from the first few real ticks before letting it run
unattended**, and confirm `cloud_cheap` (DocAI) is winning over `cloud` (gpt-4o). ⚠️ **If
`ocr_tier:'cloud'` dominates, stop** — that is the Custom-Extractor-instead-of-OCR-processor
footgun, and it bills 6–14×.

## 5. Predicted result — assert against these

| | before | after |
|---|---:|---:|
| `eligible` on a fresh tick | **0** | **> 0** |
| lease/dd/om undrained | **695** | **falling every 30 min** |
| sidecar rows | 76 | rising |
| ids reached | ≥ 2258 only | **down toward 2** |
| deeds (`property_documents`) | **325/325** | **325/325 — UNCHANGED** |
| cron 160's command | `doctype=deed` | **`doctype=deed` — UNCHANGED** |

⚠️ **If cron 160 or the deed counts move, you changed the wrong lane — stop.**

## 6. Report back

- The first tick's `eligible`, `scanned`, `text_extracted`, and **the lowest document id reached**.
- **`ocr_by_engine` for the first real OCR rows** (§4) — and whether cheap tier is winning.
- Whether you confirmed failures write a sidecar row, and **on which code path** (§2).
- **Read 5 named extracted documents** and confirm the text is real lease/DD/OM content, not a
  cover page. ⚠️ A non-zero `char_len` is not evidence the extraction is useful.
- Whether anything reached BOV extract — `bov-extract.js` is the point of the lane, and a rising
  sidecar count is not the same as a rising consumer input.
