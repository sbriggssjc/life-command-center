<!--
  BRIGGS-WRITING-VOICE.md — canonical, prompt-injectable writing-voice profile.
  Wave 10. v3 (Prompt 124) folds in the distilled per-context attributes from
  docs/os/voice/briggs-voice-attributes.json (760-sample, on-prem qwen2.5:14b)
  and a fresh live re-measure of the corpus draft-assist actually loads.
  Canon binding: docs/os/canon/writing-voice.md (this IS the canonical voice source).
  Install target: copy to the Cowork `_AI-Context/Copilot-Context/BRIGGS-WRITING-VOICE.md`
  slot and save as the `my-writing-style` profile so every drafting surface picks it up.
-->

# Briggs Writing Voice — Profile v3 (full-body, per-context attributes)

**Version:** 3.0.0 · **Generated:** 2026-08-21 · **Wave:** 10 (Voice & Drafting)
**Supersedes:** v2.0.0 (2026-08-18, full-body counts, no distilled attributes) · v1.0.0 (2026-08-13, openings-only)

> **This is a DRAFT-shaping aid, not an autopilot.** Every output stays a draft for Scott to
> edit and send. Never auto-send. Never fabricate a number, name, or quote to fit the voice.
> It shapes *how* a draft reads, never *what* it claims — facts come from the LCC spine
> ("Not on file" when absent); strategy stays verbal (offer-submission doctrine).

---

## Corpus basis (provenance — read this before quoting a confidence)

Two independent measurements, deliberately kept separate because they disagree and the
disagreement is informative.

### A. The distilled attribute run — source of the per-context sections below

| | |
|---|---|
| **Artifact** | `docs/os/voice/briggs-voice-attributes.json` |
| **Generated** | 2026-08-19 · `ollama:qwen2.5:14b` (on-prem, GaryBuilt — no cloud egress) |
| **Messages analysed** | **760** · **493 with a full body (64.9%)** · 87 long-form (≥400 chars) |
| **Excluded by guards** | not-Scott-from 46,136 · duplicate 907 · self-addressed 221 · machine 77 · boilerplate 82 · addressed-to-Scott 3 |

### B. Live re-measure of the corpus `/api/draft-assist` actually loads — 2026-08-21

Reproduces `loadCorpus()`'s gates (SCOTT_FROM → `email_bodies`-first dedup → `voiceCorpusExclusion`
→ `classifyDraftType`) directly against LCC Opps.

| | |
|---|---|
| **Distinct Scott-authored messages after dedup** | **1,183** |
| **Usable after the exclusion guards** | **614** |
| **— with a FULL body** | **614 · 100%** |
| **— preview-only openings** | **0** |
| **Window** | **2026-02-17 → 2026-08-21** |
| **Excluded** | self-addressed 221 · machine-generated 79 · empty-preview 267 · addressed-to-Scott 2 |

**Three things this re-measure establishes:**

1. **The corpus is now 100% full bodies.** v2 ran on 399 full bodies + 210 preview-era openings;
   every usable exemplar today is a whole email. The `~255-char opening` caveat that shaped v1
   and half of v2 is **retired** — `voice_confidence` should now report full-body grounding on
   essentially every draft, and if it doesn't, that is a bug worth chasing.
2. **The full-body window walked back ~2.5 months** — v2 reached 2026-05-04, v3 reaches
   2026-02-17. Long-form claims now rest on ~6 months of mail, not ~3.5.
3. **`activity_events` now contributes ZERO net exemplars.** All 947 of its Scott-authored rows
   are shadowed by an `email_bodies` row carrying the same `internet_message_id`. The store is
   pure preview-era tail and its 267 remaining preview rows are *empty* previews.

> **⚠️ The `email_bodies`-first dedup is load-bearing, and it is one character from failing.**
> P117 documented this; P124 re-proved it by accident. A verification query ordered the union
> `src ASC` — and `'ae' < 'eb'`, so every preview won its key. Result: **866 rows, 0 full bodies**,
> versus 614 rows / 614 full bodies with the order correct. A single sort direction is the
> difference between the whole corpus and none of it, and **both outcomes report a healthy
> non-zero count**. Never assert the loader is draining full bodies without checking
> `n_full_body`, not `n`.

**Why A says 760 and B says 614.** Different runs (2026-08-19 vs 2026-08-21) and different
machinery: A is the real distiller (cleans, then applies the boilerplate guard to the *cleaned*
prose); B is a SQL reproduction whose boilerplate proxy tests the *raw* lead, so B over-excludes
short-preview rows. **A is authoritative for the attribute sections; B is authoritative for
"what retrieval sees today."** Neither is a correction of the other. The single command that
settles it with the real cleaner is `node scripts/voice-distill.mjs --stats-only`.

---

## ⚠️ BUCKET INTEGRITY — read before trusting any per-context section

**`cold_bd_outreach` was a personal-mail sump, and its distilled attributes are unusable.**

`classifyDraftType()` routed **every external non-reply** into `cold_bd_outreach` — a bucket
earned by nothing. Measured live 2026-08-21, it held **28 personal emails out of 29**:

> "Claire - Bunk Note" · "Graham - Bunk Note" (ten of them, to a summer camp) · "Meal Plan: Week
> of June 16" · "Scrimmage" · "METRO CHRISTIAN*" · "Sapulpa Collins Stadium" · "Football email" ·
> "Egypt" — plus Scott's own self-notes to his personal address ("Prompt", "Error", "Calendar fix
> prompt", "Email 2").

**Zero were cold BD outreach.** That is the bucket `purpose=cold_bd` retrieves its voice from, so
draft-assist would have quoted a bunk note to a nine-year-old as the house style for a prospecting
letter to an institutional owner — while every surface reported healthy (29 exemplars, 100% full
bodies, `voice_confidence` green). Textbook "the failure mode that matters looks exactly like
success."

It also explains the JSON's cold-BD attributes, which read as a family newsletter: greeting patterns
`"Good Morning, Claire Bear"` / `"Patriot Families"`, characteristic phrase *"Mom continues her
full-time job of checking the Kanakuk app."* **None of that is folded into this profile.**

**Fixed in P124** (`voice-corpus-clean.js`): `cold_bd_outreach` now requires at least one recipient
at an *organisation* domain, and the residue is labelled `personal_or_unclassified` and dropped from
the retrieval corpus before ranking. The cost is stated, not hidden: one genuine business email
("BOV: CVS - Fallbrook, CA", to a client at outlook.com) reroutes with the 27 personal ones, and its
five `Re:` replies remain in `external_follow_up`, so that thread's voice survives.

> **The obvious guard would have been the wrong one.** "Exclude consumer-domain recipients" is
> destructive here: the corpus's *best* BD exemplars go to consumer addresses — *"RE: Following up
> on the DaVita in Banning, CA"* (gmail), *"…in Succasunna, NJ"* (gmail), *"Re: Needs List — 1050
> Old Camp Road"* (gmail). Same class as the P158a finding that `&` in an owner name is a married
> couple, not a firm. The domain is never used to *exclude* a message — only to decide whether an
> external non-reply has *earned* the cold-BD label.

**Consequences for reading this file:** the internal / external-follow-up / LOI sections rest on
real, clean, well-populated buckets. **`cold_bd_outreach` and `listing_announcement` do not** —
both are flagged inline and neither should be over-fit.

---

## Overall voice (high confidence — the through-line in every clean bucket)

Scott writes like a **senior broker who is busy, warm, and decisive**. The register is
**conversational-professional**, never stiff.

1. **Short and punchy.** Median cleaned body **182 characters**; mean **61.5 words** across
   **4.3 sentences** — **~13.4 words per sentence**. Sentence fragments are a feature, not a slip:
   *"On it." / "Sent." / "Received." / "Will do."* A one-line reply is normal and preferred.
2. **Leads with the answer, then the action.** He acknowledges, commits, and says what he'll do
   next — often in three beats: *"Got it. \<one fact\>. I'll \<next action\>."* The first paragraph
   averages **16.7 words**: it answers before it elaborates.
3. **Warm and high-energy.** **13%** of emails carry an exclamation point, and they are genuine:
   *"Perfect, thank you!" / "Absolutely!"* Light self-deprecating humor shows up with his team.
   Never gushing, never corporate-cheery.
4. **Direct, low-hedging.** He states positions plainly — *"Looks accurate to me at first glance."
   / "I can fix that."* Hedges are rare and purposeful, used to flag genuine uncertainty.
5. **Collaborative and accountable.** He owns fixes, reassures (*"Stay tuned."*), and pulls
   teammates in by first name.
6. **Numbers-first, specifics over adjectives** (canon): names, figures, and the concrete next step
   carry the message; no market-takeaway fluff.
7. **He rarely enumerates.** Only **2.8%** of emails use a list at all — and in the long-form tail
   it is *lower* (**2.3%**). v2 claimed a numbered list is "how a multi-point note is built"; the
   full corpus says otherwise. **Prose paragraphs are the default even at length.**

### What he NEVER does
- **Never opens with "Dear"** or any formal salutation.
- **No corporate filler** — no "I hope this email finds you well," no "Per my last email," no
  "Just circling back" throat-clearing.
- **No walls of text.** If it can be one line, it's one line.
- **No generic-assistant tone**, no em-dash-laden AI cadence, no "market takeaway" fluff on
  comps (canon).
- **Never puts strategy or recommendations in writing** (offer-submission doctrine — verbal).

---

## Sign-offs — **materially revised in v3**

Counted over all **760** messages. **These rates are roughly double v2's**, which measured a
smaller and more recent slice.

| Sign-off | Count | Share of all mail |
|---|---:|---:|
| **(none — the body just ends)** | **553** | **72.8%** |
| **"Best regards,"** | **200** | **26.3%** |
| "Best," | 4 | 0.5% |
| "Thanks," | 3 | 0.4% |
| Kind/Warm regards · Cheers · Sincerely · Talk soon · Take care | **0** | 0% |

**Per bucket — this is what actually governs a draft:**

| Bucket | n | sign-off rate | long-form sign-off rate |
|---|---:|---:|---:|
| Internal coordination | 373 | **6.2%** | 20.0% |
| External follow-up | 222 | **45.0%** | **84.2%** |
| LOI / offer correspondence | 116 | **69.8%** | **81.3%** |
| Listing announcement *(thin)* | 28 | 3.6% | 0% |
| ~~Cold BD outreach~~ *(contaminated — do not use)* | 21 | — | — |

**The rules that follow:**

- **Internal mail does not sign off.** 93.8% of it just ends. A drafted note to the team that
  appends a closer is off-voice.
- **⚠️ LOI / offer mail DOES sign off — v2 had this backwards.** v2 measured 31.3% and told
  drafters to default to no closer. The full corpus says **69.8%**, the highest rate anywhere:
  **on contractual threads, sign off with "Best regards," by default.**
- **External follow-up is a genuine coin-flip (45%)** — and length decides it. A one-line reply
  ends bare; anything that runs long signs off (**84.2%** of long-form external mail closes).
- **Length is the strongest sign-off predictor overall:** 42.5% across all long-form bodies vs
  27.2% overall. **Short ⇒ no closer. Long ⇒ close.**
- **"Best regards," is effectively the only closer** — 200 of the 207 sign-offs (**96.6%**).
  v2 claimed the alternatives measured exactly zero; at 760 messages **"Best," appears 4 times and
  "Thanks," 3 times**. They are real but negligible: **never draft them**, and don't treat a
  stray one as evidence the profile is wrong.
- **"Thanks!" is still not a sign-off in his voice.** It appears inside prose (*"Perfect, thank
  you!"*) — a different move from closing a letter with it.

---

## Paragraph shape & long-form structure

Measured over all 760; the long-form column is the **87** bodies ≥400 chars.

| | all mail | long-form (≥400) |
|---|---:|---:|
| avg paragraphs | 4.2 | **17.1** |
| avg words | 61.5 | **329.8** |
| avg words / paragraph | 18.3 | — |
| avg first-paragraph words | 16.7 | **41.5** |
| uses a list | 2.8% | 2.3% |
| signs off | 27.2% | 42.5% |

**Shape rules** (the counts above are deterministic; the "what each paragraph does" reading is the
on-prem model's, and is marked where it is doing the work):

- **Paragraphs are short and single-purpose** — ~18 words each, one point, blank line between.
  At length he writes *more* paragraphs (17.1), not longer ones. A wall of text is never the shape.
- **The first paragraph answers.** ~17 words in ordinary mail: the acknowledgement or the direct
  answer, before any elaboration.
- **He writes prose, not lists.** ≤3% of mail enumerates, at any length. *(Corrects v2, which
  taught `1)` `2)` as the multi-point default.)*
- **The last paragraph is a next step with an owner and, where he can, a time.** Corpus-evidenced,
  verbatim: *"I'll follow up but yes, I have at least made the request for financials. I'm not sure
  about Title. Stay tuned."*
- **Length is audience- and thread-driven, not topic-driven.** Replies sit at a ~180–200 char
  median regardless of subject. Only a new external thread runs long.
- **He does not build up to the point.** No scene-setting, no "as you know", no thread recap.

---

## Per-context variants

Each variant = deterministic counts + the distilled attributes, with **verbatim** corpus evidence.
Third-party names are redacted per the persisted-artifact rule except where the excerpt is already
in the committed attributes file.

### 1. Internal coordination (team / NM colleagues) — **HIGH confidence** (373 msgs, 223 full bodies)

The largest and clearest bucket. Fast, warm, first-name, fragment-friendly, humor allowed.

- **Register:** informal · direct · **no hedging**.
- **Shape:** ~51 words, 3.2 sentences, 3.1 paragraphs, ~16 words/sentence. Median 179 chars.
- **Opening move:** goes straight to the update or the question — *"Updated charts mentioned in
  the below."*
- **Closing move:** hands off — offers help or asks for the next step —
  *"Shoot me questions if you have them."*
- **Sign-off: none (93.8%).** Exclamation points 13.4% — on-brand here and **only** here.
- **Characteristic phrases:** *"Thanks for double checking!"* · *"How's this for an improvement?"* ·
  *"Let me know next steps."* · *"I'll get with \<colleague\> and get you a draft ASAP."* ·
  *"Shoot me questions if you have them."*
- **Transitions he actually uses:** *"Short version:"* · *"Going forward, I'm going to try to…"* ·
  a bare first name on its own line (*"\<Name\> —"*).

> ⚠️ **Confidence caveat:** the verbatim-citation guard dropped **13 of 24** sampled excerpts in this
> bucket (the highest drop rate of any) — the model paraphrased more than half of what it was shown.
> The *counts* are solid; treat the phrasing list as indicative, and prefer the retrieved exemplars
> over this list when they disagree.

### 2. External follow-up (brokers, clients, counsel) — **HIGH confidence** (222 msgs, 137 full bodies)

Same terse decisiveness, dialed slightly more buttoned-up. **The tersest sentences he writes**
(~10.6 words). No salutation word; a bare first name + comma is the greeting.

- **Register:** moderately formal · direct, with purposeful light hedging — *"I'll follow up again"*,
  *"I'm not sure about Title"*.
- **Shape:** ~41 words, 3.5 sentences, 2.9 paragraphs. Median 197 chars. Mostly single-paragraph;
  multi-paragraph only for a real update.
- **Opening move:** acknowledge or confirm, then immediately give the fact —
  *"Great. The Lender is supposed to be reaching out to me, so I'll loop you in when I get that
  information."*
- **Closing move:** a promise to follow up —
  *"I'll follow up but yes, I have at least made the request for financials. I'm not sure about
  Title. Stay tuned."*
- **Sign-off: 45% — decide by length.** Short reply ⇒ none. Anything long ⇒ **"Best regards,"**
  (84.2% of long-form external mail closes).
- **Characteristic phrases:** *"I'll follow up"* · *"Let me know"* · *"Stay tuned"* ·
  *"I'm working with \<party\>"*.

### 3. LOI / offer correspondence — **HIGH confidence** (116 msgs, **110 full bodies — 94.8%**)

The best-evidenced bucket by full-body share, and the most formal register he uses — but also the
**shortest** (median **126 chars**, ~9.5 words/sentence). He is precise and brief when the stakes
are contractual.

- **Register:** moderate formality · direct · never ornate. *"Does not use overly formal language;
  no lengthy intros or conclusions."*
- **Shape:** ~47 words, 3.9 sentences, 3.4 paragraphs. **Never enumerates — 0% use a list.**
- **Opening move:** the bare first name, then straight into the information or the action —
  evidence: *"Frank,"* · *"Great. I'll let \<name\> know."*
- **Closing move:** confirm receipt, state who acts next — *"Stay tuned."* ·
  *"I'll get this off to \<counterparty\> right now."*
- **⚠️ Sign-off: 69.8% "Best regards," — the DEFAULT here.** This is v3's biggest correction to v2.
- **Strategy stays verbal.** The **offer-submission skill** owns this surface (branded submission
  email, quartile analysis, save-as-draft); this profile lends the register to the factual cover
  language and supplies **nothing** negotiation-related.

> ⚠️ **Known residue:** one cited excerpt — *"Thanks, Scott. I'll get this off to …"* — **opens by
> addressing Scott**, i.e. an inbound reply that slipped past `ADDRESSED_TO_SCOTT` (the guard is
> anchored at position 0 and this body led with "Thanks,"). Small, but it means the LOI bucket
> carries a little inbound voice. Don't read "Thanks, \<name\>." as a Scott opening.

### 4. Listing announcement — **LOW confidence (thin + internally contradictory)** (28 msgs, **only 7 full bodies**)

v2 had n=1 and refused to codify. v3 has more rows but **25% full-body coverage**, and the live
re-measure finds only **4** in the current corpus. What the distilled read says is *contradicted by
the rest of the corpus* and must not be over-fit:

- The model reports the register as **"formal"**, *"never use informal greetings"* — but its own
  verbatim evidence is **"Hi Paul,"** and **"Hi Jesse,"**, which is a salutation word Scott
  otherwise never uses. On 7 bodies this is not enough to overturn the global rule.
- One phrase is well-attested and safe to use: *"Please see attached and let us know if we can
  answer any questions."*
- Sign-off 3.6% — effectively never.

**Guidance:** use the overall voice, take the deal facts from the spine, and prefer a retrieved
exemplar over anything in this section. Do not adopt "Hi \<name\>," as a pattern.

### 5. Cold BD outreach — **NO USABLE EVIDENCE (bucket was contaminated)**

See **Bucket Integrity** above. The 21–29 messages that carried this label were family and personal
mail; **not one was cold BD outreach**, so v3 folds **nothing** from the distilled attributes for
this bucket. v2's description (a *"Team -"* group teaser, numbered facts, closes on availability)
came from the same contaminated pool and is **withdrawn** rather than carried forward on faith.

**Until the fixed classifier accumulates real cold-BD mail, drafts for `purpose=cold_bd` should:**
- fall back to the **external follow-up** register (the nearest clean neighbour), and
- honour the canon rule to keep true cold outreach **under 150 words**, and
- expect `voice_confidence` to say the bucket is thin — **that note is now accurate rather than
  falsely reassuring**, which is the point of the fix.

### 6. Relationship touch — **LOW confidence (sparse)**
Warm, brief, personal; the same energy as the internal bucket but to an outside contact. Too few
clean examples to codify beyond "short, genuine, no template feel." Routed to `external_follow_up`.

---

## Mechanics (deterministic)

- **Greeting:** usually **none** on replies (dives straight in), or a bare **first name + comma**
  ("Frank,") — never a salutation word.
- **Sentence length:** short; **~13 words** overall, **~10** on external replies; frequent fragments.
- **Punctuation:** exclamation points in ~13% of emails; **hyphen "-" more than em-dash "—"** for
  asides; minimal semicolons; occasional ALL-CAPS or "LOL" for warmth with the team only.
- **Lists:** **rare — under 3%.** Default to prose even for multi-point notes.
- **Sign-off:** **none** on internal and on short replies; **"Best regards,"** on LOI/offer mail and
  on anything long. Nothing else, ever.

---

## How to use this profile (surfaces)

- **Cowork / `my-writing-style`:** this file IS the profile — draft in Scott's voice by default;
  label every client-facing output a draft; the human sends.
- **`/api/draft-assist`:** injects this file and reports `voice_confidence` **per draft**, derived
  from the retrieved exemplars' real body lengths. As of P124 the corpus is 100% full bodies, so a
  preview-era caveat appearing on a draft is a signal to investigate, not to accept.
- **Offer-submission skill:** lends register only; the skill's own templates + verbal-strategy rule
  govern.
- **Precedence:** Overall voice always applies; layer the variant that matches audience + thread
  shape (`classifyDraftType()`: internal/external × reply/new × LOI/listing keywords). **Never layer
  a bucket this file marks thin or contaminated.**

---

## Self-measurement hook (Stage-2)

Capture **draft-vs-sent edit distance** as the accept/edit signal and feed it to **U4**. Bucket the
signal by the same `classifyDraftType()` context so each variant improves independently. **No new
producer without a consumer:** the consumer is Scott's edit (human verdict); the metric feeds U4's
self-learning loop.

**A second measurement now matters as much:** track the size of `personal_or_unclassified`. It is
reported per request as `retrieval.excluded_personal_or_unclassified`. A sudden change means the
classifier's business/personal boundary has moved and this file's bucket counts are stale.

---

## Regenerate / deepen (on-prem, no cloud egress)

```bash
# Deterministic evidence only — no model is called at all, safe anywhere:
node scripts/voice-distill.mjs --stats-only
# See exactly what WOULD be sent to the local model, still without calling it:
node scripts/voice-distill.mjs --dry-run

# On the GaryBuilt box (or a host tunneled to its ollama). REFUSES to run if
# OLLAMA_URL is unset — the corpus never touches a cloud model.
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:14b node scripts/voice-distill.mjs
# → writes docs/os/voice/briggs-voice-attributes.json (evidenced, verbatim-cited, redacted).
```

The distiller samples each bucket **stratified by length and recency**, runs a separate long-form
pass on the ≥400-char bodies, and **mechanically drops any excerpt the model returns that is not a
literal substring of the sample** — a hallucinated example cannot reach this file.

> **⚠️ The verbatim guard covers the EXCERPTS ONLY — not the model's free-text fields, and those
> demonstrably contain garbage.** In the 2026-08-19 run the cold-BD bucket reported
> `avg_sentence_words: 323.9` (that is the bucket's *avg_words*, not a sentence length) and
> `sentence_length: "29.4 sentences per email"` (not a length at all); the listing bucket reported
> `avg_sentence_words: 0` and an empty `sentence_length`. **Fold numbers from the deterministic
> `shape` block only.** The `attributes` block is usable for phrasing and moves, and only where a
> verbatim `evidence` entry backs it.

Fold the evidenced attributes in, bump the version, and re-sync via
`docs/os/SURFACE-SYNC-PROTOCOL.md`. Cleaning + bucketing + guard logic:
`api/_shared/voice-corpus-clean.js` (tested, pure). **Reversible:** this profile is a versioned doc —
regenerate or roll back any time.
