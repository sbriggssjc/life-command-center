-- ===========================================================================
-- P129 -- land the Salesforce note records as PROPERTY ASSERTIONS (staging)
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- Loader: scripts/load-sf-note-assertions.mjs
-- ===========================================================================
-- Scott's legacy practice, in his words: one note per property, titled
-- "Tenant - City, State", body carrying address / tenant / prior sales / lease
-- term / cap rates, "tagged to any current or prior owner, developer and
-- sometimes brokers in the sale of the property but most often is just the notes
-- on the contact's specific ownership of specific properties."
--
-- Two exports, hand-built by the team over years:
--   Note Records - Contact  19,565 rows / 12,201 SF Contact ids / 10,934 titles
--   Note Records - Company  14,436 rows /  9,165 SF Account ids /  9,231 titles
-- Authors: Scott 6,143 - David Read 5,432 - Nate 4,614 - Kelly 2,024 - Jake 1,352.
-- A 600-id random sample: ~69% of the contacts are UNKNOWN to LCC, i.e. roughly
-- 8,400 parties -- more than the 9,877 SF contacts LCC holds today, and unlike
-- those, every one is tied to a named property by someone who knew the deal.
--
-- WHY A STAGING TABLE AND NOT DIRECT OWNERSHIP EVIDENCE:
-- The export carries the note TITLE only, never the body. A row therefore
-- asserts "this party is connected to this property" and NOT which role. Scott
-- says the base rate is ownership, but current owner, PRIOR owner, developer and
-- broker are all in there -- and at least one title ends "- Seller", proving
-- role sometimes hides in the text. Writing these straight into
-- lcc_property_owner_evidence would assert "owns" for brokered and former-owner
-- rows: the P116 brokerage-as-owner trap and the P113 prior-vs-current problem,
-- at 19,565-row scale.
--
-- So this table is deliberately DUMB. It records what the export says,
-- losslessly, with no interpretation. Resolution (title -> property,
-- party -> role) happens in later passes that can be reviewed and reversed
-- independently.
--
-- TITLE PARSING is best-effort and allowed to fail. 86.8% (29,522 of 34,001)
-- match "Tenant - City, ST" after stripping trailing status suffixes ("- SOLD",
-- "- Under Contract") and accepting the "Tenant, City, ST" comma variant. The
-- remaining 4,479 are genuinely varied -- portfolios ("State of California -
-- Portfolio"), multi-property ("MT - Aspen/T Mobile/PNC Bank"), address-only,
-- "Untitled Note" -- and are left NULL rather than forced into a shape they do
-- not have.
--
-- REVERSAL: DELETE FROM lcc_sf_note_property_assertion WHERE batch_tag = 'notes_2024';
-- ===========================================================================

CREATE TABLE IF NOT EXISTS lcc_sf_note_property_assertion (
  id                bigserial PRIMARY KEY,
  party_kind        text NOT NULL CHECK (party_kind IN ('contact','company')),
  sf_party_id       text NOT NULL,
  party_name        text,
  note_id           text NOT NULL,
  note_title        text,
  note_author       text,
  note_created_at   date,
  note_modified_at  date,
  parsed_tenant     text,
  parsed_city       text,
  parsed_state      text,
  entity_id         uuid REFERENCES entities(id) ON DELETE SET NULL,
  resolved_domain   text,
  resolved_property_id text,
  resolve_status    text NOT NULL DEFAULT 'unresolved',
  batch_tag         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The note is unique per party; the SAME note can be tagged to several parties,
-- which is the point (owner + developer + broker on one property).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sf_note_assertion
  ON lcc_sf_note_property_assertion (sf_party_id, note_id);
CREATE INDEX IF NOT EXISTS ix_sf_note_assertion_party
  ON lcc_sf_note_property_assertion (sf_party_id);
CREATE INDEX IF NOT EXISTS ix_sf_note_assertion_title
  ON lcc_sf_note_property_assertion (note_title);
CREATE INDEX IF NOT EXISTS ix_sf_note_assertion_unresolved
  ON lcc_sf_note_property_assertion (resolve_status) WHERE resolve_status = 'unresolved';

COMMENT ON TABLE lcc_sf_note_property_assertion IS
  'P129: Salesforce note records staged losslessly. A row asserts "this SF party is connected to this property" and NOT which role -- current owner, prior owner, developer and broker are all present and the export carries no role column. NEVER promote to lcc_property_owner_evidence without a role determination; doing so would assert ownership for brokered/former-owner rows (the P116 / P113 traps).';

COMMENT ON COLUMN lcc_sf_note_property_assertion.parsed_tenant IS
  'Best-effort split of the "Tenant - City, ST" title. Derived, never truth; ~13% of titles are not parseable and are left NULL rather than forced.';

GRANT SELECT ON lcc_sf_note_property_assertion TO anon, authenticated, service_role;
