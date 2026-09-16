# MCP1 — `get_property_context` throws on an address lookup, and cannot see a dia property that is not an LCC entity

**Filed:** 2026-09-16 (Cowork) while running OWNERGAP2's gate #6 live. Two defects, one measured
design boundary. **Owner:** LCC (`mcp/`, the standalone MCP service; redeploy both Railway services).

## What happened

Gate #6 of OWNERGAP2 asks for `get_property_context` on a newly-resolved property, expecting the
ownership block to name the owner. Against the deployed MCP (SHA `0235c31a`):

1. `get_property_context({property_id: "28398", domain: "dia"})` → `status: not_on_file, error:
   "Property not found"`; same with `domain: "dialysis"`. Cause, measured on LCC Opps:
   `external_identities` has **1,784** dia assets mirrored as entities; property 28398 (and the other
   OWNERGAP2 properties checked) is not one of them. The tool resolves identity through
   `external_identities`, so any dia property outside the minted eligible set (C2e's value-floor mint)
   is invisible by id — even though `lcc_property_owner_facts` **does** carry its owner (2 of 2 checked).
2. `get_property_context({address: "100 E. Lehigh Ave., Philadelphia, PA"})` → **throws**:
   `(rows || []).filter is not a function` (1,008 ms). A code path is treating a PostgREST response
   object (or error body) as an array.

## What to build

1. **Fix the throw.** Find the address-resolution path in the MCP handler; the value that is not an
   array is almost certainly an error envelope (`{code, message}`) or a single object from a
   `.single()`/`Accept: vnd.pgrst.object` call. Handle both; return `not_on_file` with the upstream
   message, never a stack. Test with a mocked error envelope and a mocked single object.
3. **Decide the by-id boundary, don't paper over it.** When the id is not in `external_identities`
   but the domain's facts mirror has the property, return a **facts-only** context: address, recorded
   owner (from `lcc_property_owner_facts`), operator flag, and `resolved_via: 'domain_facts'` with
   `entity_id: null` — clearly labelled as not an LCC entity. Do **not** mint an entity from the tool.
   Test: 28398 returns the facts-only shape naming `EPISCOPAL HOSPITAL`; a random id returns
   `not_on_file`.
4. Re-run OWNERGAP2's gate #6 on 28398 and paste the ownership block — with the operator still
   correctly flagged (PDR2's invariant).

## Prohibitions

- ⛔ No entity minting from a read tool.
- ⛔ Do not widen the C2e asset mint to "fix" this.
- ⛔ Redeploy both Railway services and confirm `/version` before calling it fixed.
