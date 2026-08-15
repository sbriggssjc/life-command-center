# Property + Owner Panel Redesign — page-by-page target state (2026-08-15)

**Supersedes the open items in** [`property-tab-ux-review.md`](property-tab-ux-review.md) §P1.5/P3.3 and
[`contact-owner-sidebar-design.md`](contact-owner-sidebar-design.md) §P1.1/P1.6. Those docs stay the
*why*; this file is the **normative target state** — what renders where, in what order, and which
surface owns each field and CTA.

**Trigger:** Scott's 2026-08-15 walkthrough — opening a true owner (Rem Management) from a dialysis
comp (Fresenius Medical Care – Oak Forest, IL). Three panels on screen; owner-CRM content on the
property tab; the same owner name rendered four times on one tab; the tab bar wrapping to two rows;
no way to widen, move, or park a panel.

---

## 0. The one rule that resolves every placement argument

> **The property panel answers "what is this asset and what is it worth."**
> **The owner panel answers "who controls it and what do I do about them."**

A field or CTA belongs to the panel whose question it answers. When both want it, the **owning panel
renders the interactive version** and the other renders a **read-only one-liner that links across**.

| Concern | Owner | Other panel gets |
|---|---|---|
| Address, SF, year built, chairs/agency, lease terms, rent schedule, cap rate, comps, listings, docs | **Property** | Owner panel: a Property Reference strip + "Open full property →" |
| Contact methods, calls, emails, cadence, touchpoints, prospecting tier, ROE, SF account/contact linkage, relationship graph | **Owner** | Property panel: a read-only Prospecting **status** line + "Work this owner →" |
| Ownership chain (who owned this asset when) | **Property** (it is an attribute of the asset) | Owner panel: the same edges rolled up *per party* on History |
| Portfolio (what else this party owns) | **Owner** | Property panel: the one-line "Owns N properties · M active deals" on the owner card |
| Deal economics (price, cap, commission, milestones) | **Property** → Deal History | Owner panel Deal tab: parties + commission + correspondence only |

**Corollary — never render the same name more than once per screen.** The 2026-08-15 screenshot shows
"Rem Management" as the header Owner, the Current Owner card, the Recorded Owner card, and the True
Owner card. When recorded == true == resolved, collapse to **one** card with a
"Recorded and true owner agree" note.

---

## 1. Panel shell contract

### 1.1 Geometry

| Token | Was | Now | Notes |
|---|---|---|---|
| `--panel-primary-w` | 520px (hard-coded 3×) | **720px** | user-resizable 420–1100 |
| `--panel-companion-w` | `42vw` / max 480px | **620px** | user-resizable 360–900 |
| dual-dock min viewport | 980px | **1180px** | two panels at the new widths need the room |

Both are **CSS custom properties on `:root`**. `.companion-panel` and `.companion-min` offset from
`right: var(--panel-primary-w)` so the companion tracks the primary automatically — the old
hard-coded `right:520px` in three places was the reason widening the primary was never attempted.

### 1.2 Behaviors (the "wider / movable / minimize-one-open-another" ask)

1. **Resize** — a 6px grab strip on the **left edge** of each panel. Drag sets the CSS var live;
   released width persists in `localStorage` (`lcc.panelw.primary` / `lcc.panelw.companion`) so the
   layout is sticky per workstation. Double-click the strip resets to default.
2. **Swap (⇄)** — in both headers. Makes the companion the primary and vice versa, preserving each
   subject (property ↔ owner). This is the "move the tabs around" ask: rather than free-dragging
   windows, you promote the panel you're working in to the wide slot.
3. **Minimize tray** — replaces the single vertical "Property" restore tab. A tray docks bottom-right
   holding **any number of parked panels**, each a chip labelled with its subject and kind
   (🏢 property / 👤 owner). Click a chip to restore. This is "minimize one while opening another":
   park the property, open a second owner, restore the property when done.
4. **Kind-correct labels** — the restore chip reads the actual subject name, not the hard-coded
   string `'Property'` (a real bug: an owner docked in the companion restored from a tab that said
   "Property").

**Deliberately NOT doing free-floating windows this pass.** Docked-with-resize keeps hash routing
(`#/<slug>?d=<token>`), the `_detailStack` zoom model, and the overlay/z-index model untouched.
Free-float is spec'd as the follow-on once this layout is validated in use.

> ### ⚠️ SUPERSEDED IN PART — companion must be a FULL panel, not a summary (Scott, 2026-08-15)
> The 2026-08-15 manual run rejected the placeholder model:
> *"I think we want to see the full detail side-by-side instead of a placeholder that you can swap over to
> the primary."*
>
> So **behaviour 2 (swap) is demoted** — it exists in this spec because the companion is a placeholder you
> must promote to read. With two full panels it becomes a convenience, not the route to detail.
>
> The blocking work is **not** layout: `openUnifiedDetail` / `openEntityDetail` and every tab renderer write
> into the singleton ids `#detailBody` / `#detailTabs` / `#detailHeader`. A real side-by-side needs those
> renderers parameterised by a mount root. Also unresolved: the dual-dock width floor (720 + 620 + chrome
> > the current 1180), the tab bar at 620px, and the fact that `?d=` encodes exactly one detail subject.
> Full consequence list + the manual-run results: [`panel-redesign-verification.md`](panel-redesign-verification.md) §4.2.
>
> Also from that run: **the resize, swap and dock interactions did not work in the browser** (UI-1/2/3) and
> an **uncaught JS error** fires on the Ownership tab (UI-0). The IA changes — width, one-row tabs, 4-chip
> rail, CRM removal, collapsed ladder, `Work this owner →` — all verified working.

### 1.3 Tab bar

At 720px the seven property tabs fit **one row** — the `flex-wrap` from QA#10 (2026-06-03) stays as
the narrow-window fallback but no longer fires at default width. That reclaims ~34px of vertical
space above the fold, which is where the next-step card lives.

---

## 2. Property panel — page by page

Tab order is unchanged and intentional: **identity → tenancy → operation → market/value → ownership →
evidence → lineage**.

`Overview · Rent Roll · Operations · Deal History · Ownership · Documents · Activity Log`

> **Rename:** `Ownership & CRM` → **`Ownership`**. The "& CRM" was the licence under which the whole
> contact stack colonised a property tab.

### 2.1 Header + always-visible chrome

| Element | Target |
|---|---|
| Title | Pipeline name (`Operator – City, ST`) — shipped P3.1 |
| Subtitle | Legal/facility name |
| Key fields | Address · Lease/Operator/Agency · **Owner** (chip → owner panel; italic *Unresolved* when the resolver flagged the operator) · Est. Value · Grade |
| Completeness rail | **Cap at 4 chips + "+N more"** (was 6 + "+1 more" over two rows). Ranked by point value. |
| Next-step card | Stays. Property-resolution ladder only (owner → link → lead → cadence). |
| Prospecting feed (bottom bar) | **Property-scoped only.** `Create lead` / `Add to cadence` stay — they act on *this asset's* BD state, not on the owner's CRM record. |

### 2.2 Overview

Order: **Pipeline pill → Property Information → Investment Summary → [Government Agency] → Site Risk →
Actions → Research Quick Links → Marketing Collateral → Data Resolution Status → Loan/Debt →
Cash Flow/Valuation → AI Research**.

Changes:
- **Actions** — drop **Log Touchpoint**. A touchpoint is logged against a *party*, not a building;
  logging it here produced touchpoints attributed to whatever string the owner field happened to
  hold. Remaining: `Mark as Lead` (dia) · `Add to Pipeline` · `Create Task`.
- **AI Research** collapsible absorbs **Research Notes** (relocated off the Ownership tab). Property
  research notes are property evidence; they were only on Ownership for historical reasons.
- **Data Resolution Status** — the SF Account/Opportunity chips stay (they are *asset*-level CRM
  plumbing: does this property have an opportunity), but the **owner-contact** gap chips move to §2.5.

### 2.3 Rent Roll

No structural change this pass. Standing defects tracked in `property-tab-ux-review.md` Finding B
(duplicate lease from OM-estimate vs actual lease) and Finding C (cap off the estimate branch) remain
**data-layer** work, not IA work.

### 2.4 Operations

No structural change. Domain-branched (gov agency/workforce/FRPP vs dia CMS/census/quality) as built.

### 2.5 Ownership  *(the tab this redesign is mostly about)*

**Before:** 12 sections, ~470 lines, of which 7 sections were owner-CRM: Ownership Assistant,
contact fields, Recent Touchpoints, Salesforce Activity Feed, Log Call/Activity form, Draft Email
engine, per-owner "Sync & Begin Prospecting", plus a CRM-coverage bar on every history row.

**After — five sections, all asset-scoped:**

1. **Current Owner** — the resolved owner as a chip, provenance + confidence + "verified ‹date›",
   the portfolio one-liner ("Owns 223 properties · 2 active deals"), and a **read-only prospecting
   status line** (Active/Stale/Unsubscribed/Not yet prospected + tier + last/next touch). Ends in the
   single hand-off CTA:

   > **`Work this owner →`**  *(opens the owner panel in the companion dock)*
   > *Calls, emails, cadence and contact records live on the owner panel.*

2. **Ownership ladder** — Recorded Owner (deed) → True Owner / Decision Maker, with LLC manager,
   registered agent, filing state, SF link, CRM-link status. **Collapses to a single card when the
   recorded and true owner resolve to the same party** (kills the 4×-same-name problem).

3. **Resolve Data Gaps** — asset-ownership gaps only: ownership record · owner name · true owner ·
   true-owner state · ownership history. **Contact email / contact phone / contact name / Salesforce
   link chips move to the owner panel** — they are gaps in the *party* record, and resolving them on
   a property page wrote contact data keyed to a property.

4. **Resolve Ownership** (the write form) — Recorded Owner · True Owner/Developer · Owner Type ·
   State of Incorporation · Notes. **Contact Name / Phone / Email inputs removed** — those fields
   belong to `unified_contacts` on the party, and editing them from a property is how one owner's
   phone number ended up stamped on a building.

5. **Ownership History** — the chain, newest first, each party a chip → owner panel. Keeps the
   per-transfer economics (sale price, cap, brokers, buyer/seller) and the **Current** + prospecting
   status badges. **Drops** the per-row CRM-coverage bar and the "Sync & Begin Prospecting" button —
   both are owner-record actions; the row's owner chip is the route to them.

**Removed from this tab entirely** (all now on the owner panel): Ownership Assistant · Recent
Touchpoints · Salesforce Activity Feed · Log Call/Activity form · Draft Email engine + templates ·
Begin Prospecting.

### 2.6 Documents

No structural change: Dossiers (n) then Documents (n) grouped by section.

### 2.7 Activity Log

Confirmed as **data-lineage only** — ingestion / propagation / reconciliation events for this asset.
Subtitle already redirects calls and contact activity; with §2.5 done that redirect is now true.

---

## 3. Owner / contact panel — page by page

Role-driven tab sets stay. Canonical order for an **owner**:

`Overview · Ownership · History · Relationships · Activity · Engagement · ROE · [Contacts]`

with `Property` and `Deal` spliced in at positions 1–2 **only when a deal packet exists**.

### 3.1 Fixes

| # | Defect | Fix |
|---|---|---|
| O-1 | Completeness rail chip links to `switchEntityTab('Portfolio')` — a tab name no longer in any role set, so the click bounces to tab 0 | point it at `Ownership` |
| O-2 | Companion restore tab hard-codes `content:'Property'` | tray chip renders the real subject + kind |
| O-3 | Companion entity dock has no swap; the owner is stuck in the narrow slot | add ⇄ to both headers |
| O-4 | Dock header badge reads `Contact` for an organization owner | use the role meta label (Owner/Broker/Buyer/Contact) already computed by `_entityRoleMeta` |
| O-5 | `Deal` tab **Property Reference** duplicates the `Property` tab's snapshot (tenant · guarantor · term · SF) | Deal keeps a one-line reference + "Open Property tab"; the snapshot lives once, on Property |

### 3.2 Property-shaped content that legitimately stays

The spliced-in **Property** tab is the *deal-context* asset reference and is correct to exist — it is
how a broker reads "the party I'm looking at, on the asset I'm looking at." It stays scoped to a
snapshot (address, tenant, guarantor, SF, current rent, term remaining, est. value) plus parties by
role, and always offers **`Open full property`**. It must not grow rent schedules, comps, CMS data, or
lease term history — those are property-panel depth.

**Diligence & Vendors** (survey/PCA/Phase I/appraisal) on the Deal tab is asset diligence, not party
data; flagged for relocation to the property Documents tab in a follow-on.

### 3.3 What lands here from the property panel

Receiving surfaces for everything §2.5 removed:

| Moved off property Ownership | Lands on owner panel |
|---|---|
| Log Call / Activity form | **Activity** tab (header `☎ Log call` already exists) |
| Draft Email + templates | **Activity** tab cadence cockpit — `✍️ Draft touchpoint email` (`_entityDraftAndLog`, the closed loop) |
| Recent Touchpoints | **Activity** tab timeline |
| Salesforce Activity Feed | **Activity** tab timeline (SF-badged rows already merged by `buildContact360`) |
| Begin Prospecting | **Overview** hero next-action ladder |
| Contact email/phone/name gaps | **Contacts** tab — `+ Add / acquire contact` |
| Ownership Assistant | **Overview** — party research, not asset research |

No new owner-panel construction is required for the move: every destination already exists and is
wired. This is a **deletion on one side plus a hand-off CTA**, which is why it is safe to ship in one
pass.

---

## 4. Priority / call-to-action ladder (what the layout is driving toward)

Both panels resolve to exactly **one hero action** each, so the two never compete:

**Property panel** (`_udRenderNextStep`) — *make this asset workable*:
`Pull the recorded owner → Confirm owner→contact link → Resolve the true owner → Resolve ownership &
control → Create the lead → Add to cadence → On cadence ✓`

**Owner panel** (`_nextActionForContact`) — *make this party contactable and touched*:
`Do not contact (suppressed) → Find a contact → Connect in Salesforce → Log the overdue touch →
Reply to unanswered inbound → Next scheduled touch → Log a touchpoint`

They chain: the property ladder ends at "on cadence," which is exactly where the owner ladder starts
doing work. The **`Work this owner →`** CTA added in §2.5.1 is the physical seam between them.

---

## 4b. Proof

Every claim in this document has a re-runnable check in
**[`panel-redesign-verification.md`](panel-redesign-verification.md)** — 47 automated assertions
(`node --test test/panel-redesign.test.mjs`), the live SQL that measures each leg of the
asset → owner → contact → cadence chain, and the 12 manual browser steps.

**Measured 2026-08-15, and the honest headline:** the UI chain is correct, but only **15.1%** of owner
entities (104 of 690) have any contact method, so the new `Work this owner →` hand-off resolves to
*"Find a contact"* for ~85% of owners — and that enrichment chain is paused. The redesign did not create
that gap; it **stopped hiding it** (the old property-tab Log Call form let you log activity against an owner
you had no way to reach). Full numbers + the cadence-consumption finding in §3 of the verification doc.

## 5. Out of scope / follow-ons

1. Free-floating draggable windows with a full window manager (validate docked-resize first).
2. Lease dedupe + cap-rate recompute (Findings B/C) — data layer.
3. `Diligence & Vendors` relocation to property Documents.
4. Owner-panel correspondence privacy filter (participant stamp).
5. Property Dossier generation (Phase 2 of the original review).
