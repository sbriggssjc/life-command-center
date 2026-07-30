# Offer-Context Data-Capture & Connectivity

_2026-07-30. Why the offer-context packet comes back sparse, where the data actually lives, and the end-to-end
plan to connect it — the "right context, assembled from scattered-but-present data" thesis, made concrete on the
Snellville probe (entity `c6777c73…`, dia asset `44179`, SF opp `006Vs00000b7nDCIAY`)._

## The probe
Live `POST /api/pipeline/offer-context {deal:"DaVita Snellville"}` returns `ok:true` but
`gaps:[economics_missing, seller_on_deal_missing, documents_missing]`, with `seller`/`economics`/`documents`
null — yet six **correspondents resolve live** (incl. `frankm@rcgventures.com`, the RCG seller). The assembler
works; the packet is sparse because the **resolution/connection layer is incomplete**, not because data is absent.

## Where each field is read vs. where the data lives

| Packet field | `lcc_offer_context` reads | Reality for Snellville | Gap |
|---|---|---|---|
| `economics` | `bd_opportunities.metadata->'listing'`, else `lcc_cre_properties`+`lcc_cre_bov_extraction` | metadata = `{owner_sf_user_id}` only; no CRE row. dia `properties.44179` has tenant + **imputed rent $159,088** only (ask/NOI/cap absent everywhere) | OM economics never written to any canonical store; RPC never bridges to the **domain DB** |
| `seller` / `seller_owner` | `metadata->'seller'`, else `lcc_cre_properties.owner_entity_id` | none set. Owner (RCG Ventures / Frank Meyrath) exists as **4+ fragmented duplicate entities**; asset has **zero ownership edges**; `frankm@rcgventures.com` not linked to the Frank Meyrath person | ownership edge (asset→owner→contact) **never resolved**; owner-enrichment adapters are **dormant/blocked** |
| `documents` | `sharepoint_documents(property_entity_id)` ∪ `lcc_cre_property_documents` | none linked | folder-feed (`SHAREPOINT_LIST_URL`, just enabled) hasn't crawled/linked the OM yet |
| `correspondents` | live regex over `activity_events` | 6 resolved ✓ | working — proves the raw signal is present |

## Root causes
1. **Ownership never resolved.** The seller is present three ways — correspondence (`activity_events`), fragmented
   entities (`RCG Ventures`×3, `Rcg-Brywood Owner LLC`×2, `RCG LLC`, `Frank Meyrath`), and public record (deed/SOS)
   — but no edge ties any of them to asset `44179`. The public-records chain that would resolve it
   (`OWNER_ENRICH_DEED_URL`, `OWNER_ENRICH_SOS_URL`, `OWNER_ENRICH_ADDRESS_URL`, cross-reference) is **dormant/blocked**
   (see the dormant-capabilities review), and no correspondence-derived resolution runs in its place.
2. **OM economics don't close the loop.** The OM arrived by email (correspondent `russell.malayery…`, subj "full OM
   for the DaVita in Snellville") but its ask/NOI/cap never landed on the deal or the domain property. dia `44179`
   carries only an imputed rent.
3. **`metadata` clobber.** `opportunity-sync` overwrites `bd_opportunities.metadata` wholesale on each SF sync, wiping
   any hand-seed of `listing`/`seller`. Curated context must not live where the sync replaces it.
4. **No domain bridge.** `lcc_offer_context` reads only LCC-local stores; it never reads the domain DB (`dia`/`gov`)
   where the property's tenant/rent/owner facts live, even though the asset is linked via
   `external_identities (dia:asset:44179)`.

## The connectivity + self-learning design (end-to-end)

**Principle:** produce the packet from *canonical, self-resolving* sources — never a fragile hand-seed. Close each
loop so the next similar deal fills automatically (self-learning).

1. **Seller resolution layer (correspondence-first ORE).** When no owner edge exists, resolve a **candidate seller**
   from the correspondence graph: rank owner-side correspondents (exclude us/tenant/buyer-broker/vendor domains),
   map the top email's domain → the owner org, dedupe the fragmented RCG entities to one canonical, link
   Frank Meyrath + `frankm@rcgventures.com`, and write the **asset→owner (`owner_of_record`) + owner→contact** edges
   (provenance `correspondence_inferred`, confidence-scored, reversible). Public-records enrichment, when un-blocked,
   upgrades/confirms the same edge rather than competing with it.
2. **OM economics → canonical write (fill-blanks).** On OM extraction for a listing, write ask price / in-place NOI /
   ask cap / lease structure to a durable store the packet reads — the domain property (fill-blanks, provenance
   `om_extraction`) and/or a dedicated `lcc_listing_economics` row keyed by entity — **never** clobbered `metadata`.
3. **offer-context domain bridge.** Extend `lcc_offer_context`: when local economics/owner are absent, read the linked
   domain property (`external_identities dia|gov:asset:<id>`) for tenant/rent/owner facts, and surface the resolved
   seller from §1. Downgrade a gap to a *typed, sourced* value (e.g. `economics.source:'domain_imputed'`) so the skill
   knows confidence, not just presence.
4. **De-clobber `opportunity-sync`.** Change the metadata write to a **fill-blanks merge** (never drop curated keys);
   move curated `listing`/`seller` out of SF-synced `metadata` into stores the sync doesn't touch.
5. **Documents.** Run the folder-feed enrich crawl (now that `SHAREPOINT_LIST_URL` is live) so the OM/lease link to
   the entity via `sharepoint_documents.property_entity_id`, closing `documents_missing` the *known* way.

## Build order (highest leverage first)
1. **offer-context resolver upgrade** (RPC, reversible): domain-DB bridge + correspondence-seller resolution +
   typed/sourced economics. *Immediate* — makes the packet less sparse with zero new pipelines. ← next.
2. **De-clobber opportunity-sync** metadata merge (protects any curated context).
3. **OM-economics canonical write** on extraction (fill-blanks to domain property / `lcc_listing_economics`).
4. **Owner-edge persistence + RCG dedup** (promote the resolved candidate to durable edges; merge the duplicates).
5. **Folder-feed enrich crawl** for the PROPERTIES tree (documents).
6. **Un-block owner-enrichment** where feasible (dormant review) to upgrade inferred → public-record-confirmed owners.

## Invariants (carry into every step)
- **Fill-blanks, never clobber; provenance-tagged, reversible, confidence-scored** (matches the field-provenance /
  ORE doctrine). A correspondence-inferred seller is labeled as such and is superseded, not overwritten, by a
  higher-authority source.
- **Resolve-or-refuse** stays: a low-confidence seller is surfaced as a *candidate to confirm*, never asserted.
- **Same packet on every surface** — the resolution lives in the engine (`lcc_offer_context` / domain views), so all
  surfaces get the identical enriched packet.
