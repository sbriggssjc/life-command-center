// HOME1/§C — the "Government Highlights" / "Dialysis Highlights" sections on
// Home rendered a DaVita (dialysis) deal item under Government Highlights.
// Root cause: action_items.domain (and every other domain-tagged producer
// the daily-briefing edge function reads) stores the CANONICAL SHORT FORM
// ("dia"/"gov"), per this repo's documented convention, but the old
// `inferDomain`'s exact-match check only recognised the LONG forms
// ("government"/"dialysis") — so a short-form-tagged row always fell
// through to a fragile keyword regex.
//
// The routing logic was extracted to
// supabase/functions/_shared/domain-routing.ts (no Deno-remote imports) so
// it is importable from Node here; daily-briefing/index.ts itself pulls in
// `https://deno.land/...` imports via its sibling _shared modules, which
// Node's ESM loader cannot resolve.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeDomainTag,
  inferDomain,
} from '../supabase/functions/_shared/domain-routing.ts';

describe('daily-briefing domain routing (HOME1 §C)', () => {
  it('canonicalizeDomainTag maps short forms to their canonical long form', () => {
    assert.equal(canonicalizeDomainTag('gov'), 'government');
    assert.equal(canonicalizeDomainTag('government'), 'government');
    assert.equal(canonicalizeDomainTag('dia'), 'dialysis');
    assert.equal(canonicalizeDomainTag('dialysis'), 'dialysis');
    assert.equal(canonicalizeDomainTag('GOV'), 'government');
    assert.equal(canonicalizeDomainTag('Dia'), 'dialysis');
    assert.equal(canonicalizeDomainTag(null), null);
    assert.equal(canonicalizeDomainTag(''), null);
    assert.equal(canonicalizeDomainTag('lcc'), null);
  });

  it('inferDomain trusts a short-form domain tag without falling through to text', () => {
    // Title text is deliberately gov-flavored ("lease"/"agency") to prove the
    // tag wins over the regex fallback.
    const item = {
      domain: 'dia',
      title: 'Review lease and agency correspondence',
    };
    assert.equal(inferDomain(item), 'dialysis');
  });

  it('the DaVita / Villages / FL deal routes to dialysis, never government (tagged)', () => {
    const item = {
      domain: 'dia',
      title: 'Schedule a call with counterparty — DaVita Dialysis – The Villages – FL',
    };
    assert.equal(inferDomain(item), 'dialysis');
  });

  it('a title-only item (no domain tag) still classifies DaVita as dialysis, not government', () => {
    const item = {
      domain: null,
      title: 'Schedule a call with counterparty — DaVita Dialysis – The Villages – FL',
    };
    assert.equal(inferDomain(item), 'dialysis');
  });

  it('a genuine government item (GSA lease) still routes to government', () => {
    const item = {
      domain: 'gov',
      title: 'Follow up on GSA lease renewal — Agency HQ',
    };
    assert.equal(inferDomain(item), 'government');
  });

  it('an untagged item with only generic gov-flavored words and no dialysis token routes government', () => {
    const item = {
      domain: null,
      title: 'Review lease and tenant agency correspondence',
    };
    assert.equal(inferDomain(item), 'government');
  });
});
