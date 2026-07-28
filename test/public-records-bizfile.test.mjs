// CA bizfile SOS parser (extension/content/public-records.js) — anchored to the
// real detail-modal DOM (table.details-list / td.label / td.value). Parses the
// committed captured fixture (results grid + detail modal) through the ACTUAL
// production parser and asserts: name via title (fallback path too), exact-label
// mapping, Standing-* exclusion (no field is "Good"), the 1505-agent block, the
// 5 authorized employees, address splitting, and that NO field is read from the
// search-results grid.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Load the production content script ────────────────────────────────────────
// The file is a classic content script (uses `module.exports`, guarded) and this
// repo is ESM, so wrap it in a CJS-shaped factory and run it IN THIS REALM (so
// returned objects/arrays share this realm's prototypes → deepStrictEqual works).
// No `document`/`window`/`chrome` exist here, so the browser-run IIFE early-returns.
function loadParser() {
  const code = readFileSync(path.join(here, '../extension/content/public-records.js'), 'utf8');
  const mod = { exports: {} };
  const factory = vm.runInThisContext('(function (module, console) {\n' + code + '\n})', {
    filename: 'public-records.js',
  });
  factory(mod, console);
  return mod.exports;
}
const PR = loadParser();

// ── Minimal HTML → DOM (querySelector/querySelectorAll for single compound
// selectors: tag, .class, [class*="x"], #id). Preserves text newlines; <br> → \n.
class El {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
  }

  get className() {
    return this.attrs.get('class') || '';
  }

  get classList() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  get textContent() {
    let out = '';
    for (const ch of this.children) {
      if (typeof ch === 'string') out += ch;
      else if (ch.tag === 'br') out += '\n';
      else out += ch.textContent;
    }
    return out;
  }

  _descendants() {
    const acc = [];
    const walk = (el) => {
      for (const ch of el.children) {
        if (typeof ch !== 'string') {
          acc.push(ch);
          walk(ch);
        }
      }
    };
    walk(this);
    return acc;
  }

  matches(sel) {
    const p = parseSimpleSelector(sel);
    if (p.tag && p.tag !== this.tag) return false;
    for (const c of p.classes) if (!this.classList.includes(c)) return false;
    for (const s of p.contains) if (!this.className.includes(s)) return false;
    if (p.id && this.attrs.get('id') !== p.id) return false;
    return true;
  }

  querySelectorAll(sel) {
    return this._descendants().filter((el) => el.matches(sel));
  }

  querySelector(sel) {
    return this._descendants().find((el) => el.matches(sel)) || null;
  }
}

function parseSimpleSelector(sel) {
  const s = String(sel || '').trim();
  const out = { tag: '', classes: [], contains: [], id: null };
  const tagM = s.match(/^[a-zA-Z][a-zA-Z0-9]*/);
  let rest = s;
  if (tagM) {
    out.tag = tagM[0].toLowerCase();
    rest = s.slice(tagM[0].length);
  }
  const re = /\.([-a-zA-Z0-9_]+)|#([-a-zA-Z0-9_]+)|\[class\*=["']([^"']+)["']\]/g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1]) out.classes.push(m[1]);
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.contains.push(m[3]);
  }
  return out;
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

function parseHtml(html) {
  const root = new El('#root');
  const stack = [root];
  let cur = root;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (i < n) cur.children.push(html.slice(i));
      break;
    }
    if (lt > i) cur.children.push(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      cur.children.push(html.slice(lt));
      break;
    }
    let inner = html.slice(lt + 1, gt).trim();
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          cur = stack[s - 1];
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClose = inner.endsWith('/');
    if (selfClose) inner = inner.slice(0, -1).trim();
    const sp = inner.search(/\s/);
    const tag = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
    const attrStr = sp === -1 ? '' : inner.slice(sp + 1);
    const el = new El(tag);
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(attrStr))) {
      el.attrs.set(am[1].toLowerCase(), am[3] !== undefined ? am[3] : am[4]);
    }
    el.parent = cur;
    cur.children.push(el);
    if (!selfClose && !VOID_TAGS.has(tag)) {
      stack.push(el);
      cur = el;
    }
    i = gt + 1;
  }
  return root;
}

function loadFixture(name) {
  return parseHtml(readFileSync(path.join(here, 'fixtures/sos', name), 'utf8'));
}

// ── Sanity: the mini-DOM itself finds the right containers ─────────────────────
describe('bizfile fixture — mini-DOM sanity', () => {
  it('selects the details-list table (not the results grid)', () => {
    const root = loadFixture('ca-bizfile-626-l-street.html');
    assert.equal(root.querySelectorAll('table.details-list').length, 1);
    assert.equal(root.querySelector('table.details-list').querySelectorAll('tr.detail').length, 13);
    // the grid is a different class → never selected by the parser
    assert.equal(root.querySelectorAll('table.search-results').length, 1);
  });
});

// ── The headline: parse the captured DOM through the production parser ─────────
describe('scanBizfileFromRoot — parses the captured 626 L Street DOM', () => {
  const root = loadFixture('ca-bizfile-626-l-street.html');
  const out = PR.scanBizfileFromRoot(root, null);

  it('entity name + number from the modal title (never the grid)', () => {
    assert.equal(out.name, '626 L STREET LLC');
    assert.equal(out.filing_number, '201911310222');
  });

  it('exact-label scalar fields', () => {
    assert.equal(out.formation_date, '04/18/2019');
    assert.equal(out.status, 'Active');
    assert.equal(out.state_of_formation, 'CALIFORNIA');
    assert.equal(out.entity_type_detail, 'Limited Liability Company - CA');
    assert.equal(out.entity_type, 'organization');
  });

  it('addresses split \\n → "street, city, state zip"', () => {
    assert.equal(out.principal_address, '626 L STREET, CHULA VISTA, CA 91910');
    assert.equal(out.mailing_address, '740 BAY BLVD, CHULA VISTA,CA91910');
    assert.deepEqual(out.principal_address_parts, {
      street: '626 L STREET',
      city: 'CHULA VISTA',
      state: 'CA',
      zip: '91910',
    });
  });

  it('registered agent = the full 1505 Agent block (never "Good")', () => {
    assert.equal(out.registered_agent, '1505 Corporation / LEGALZOOM.COM, INC.');
    // a commercial-service agent block carries no address of its own in the modal
    assert.equal(out.agent_address, '');
  });

  it('officers = the 5 authorized employees (name + address each)', () => {
    assert.equal(out.agent_authorized_employees.length, 5);
    assert.deepEqual(
      out.agent_authorized_employees.map((e) => e.name),
      ['SANDRA MENJIVAR', 'Jesse Camarena', 'Maria Lopez', 'Robert Chen', 'David Kim'],
    );
    for (const e of out.agent_authorized_employees) {
      assert.equal(e.address, '500 N BRAND BLVD, SUITE 890, GLENDALE, CA');
    }
    assert.ok(out.officers.includes('SANDRA MENJIVAR'));
    assert.ok(out.officers.includes('David Kim'));
  });

  it('NO field equals "Good" and NO field contains results-grid text', () => {
    const values = Object.values(out).filter((v) => typeof v === 'string');
    for (const v of values) assert.notEqual(v.trim(), 'Good');
    const blob = JSON.stringify(out);
    assert.ok(!blob.includes('Good'), 'a Standing-* "Good" leaked into a field');
    assert.ok(!blob.includes('16TH STREET'), 'results-grid entity leaked into a field');
    assert.ok(!blob.includes('Click to expand'), 'results-grid cell text leaked into a field');
    assert.ok(!blob.includes('BROADWAY HOLDINGS'), 'results-grid entity leaked into a field');
  });
});

// ── Fallback: no title element → use the worklist active owner name; blank number
describe('scanBizfileFromRoot — title fallback', () => {
  it('falls back to the worklist name when the title is absent; number stays blank', () => {
    const html = `<div class="modal"><table class="details-list"><tbody>
      <tr class="detail"><td class="label">Status</td><td class="value">Active</td></tr>
      <tr class="detail"><td class="label">Formed In</td><td class="value">CALIFORNIA</td></tr>
    </tbody></table></div>`;
    const out = PR.scanBizfileFromRoot(parseHtml(html), 'Linchao LLC');
    assert.equal(out.name, 'Linchao LLC');
    assert.equal(out.filing_number, '');
    assert.equal(out.status, 'Active');
  });
});

// ── Individual-agent entity (Linchao LLC style, agent = a person + address) ────
describe('mapBizfileFields — individual agent', () => {
  it('splits a person agent into name + address', () => {
    const rows = [
      { label: 'Initial Filing Date', value: '02/03/2021' },
      { label: 'Standing - SOS', value: 'Good' },
      { label: 'Agent', value: 'KAI HUNG LIN\n1234 MAIN ST, SUITE 5\nLOS ANGELES, CA 90012' },
    ];
    const out = PR.mapBizfileFields(rows, { name: 'LINCHAO LLC', number: '202100510099' }, '');
    assert.equal(out.registered_agent, 'KAI HUNG LIN');
    assert.equal(out.agent_address, '1234 MAIN ST, SUITE 5, LOS ANGELES, CA 90012');
    assert.equal(out.status, ''); // Standing-* never becomes a real field
    assert.equal(out.name, 'LINCHAO LLC');
  });
});

// ── The global Standing-* guard + helpers ─────────────────────────────────────
describe('bizfile guards + helpers', () => {
  it('isStandingLabel catches every Standing-* variant', () => {
    assert.ok(PR.isStandingLabel('Standing - Agent'));
    assert.ok(PR.isStandingLabel('Standing - SOS'));
    assert.ok(PR.isStandingLabel('standing – FTB'));
    assert.ok(!PR.isStandingLabel('Status'));
    assert.ok(!PR.isStandingLabel('Agent'));
  });

  it('looksLikeAddressLine: a firm/name line is NOT an address', () => {
    assert.ok(!PR.looksLikeAddressLine('1505 Corporation'));
    assert.ok(!PR.looksLikeAddressLine('LEGALZOOM.COM, INC.'));
    assert.ok(!PR.looksLikeAddressLine('SANDRA MENJIVAR'));
    assert.ok(PR.looksLikeAddressLine('500 N BRAND BLVD, SUITE 890, GLENDALE, CA'));
    assert.ok(PR.looksLikeAddressLine('CHULA VISTA, CA 91910'));
  });

  it('isBizfileHost matches only bizfileonline.sos.ca.gov', () => {
    assert.ok(PR.isBizfileHost('bizfileonline.sos.ca.gov'));
    assert.ok(PR.isBizfileHost('www.bizfileonline.sos.ca.gov'));
    assert.ok(!PR.isBizfileHost('search.sunbiz.org'));
    assert.ok(!PR.isBizfileHost('evil-bizfileonline.sos.ca.gov.example.com'));
  });
});
