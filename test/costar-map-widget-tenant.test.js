import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// costar.js is a content-script IIFE that touches window/chrome/document at
// load, so it can't be imported in Node. Mirror the costar-street-regex test:
// pull the MAP_WIDGET_REJECT literal straight out of the source and exercise
// it. Guards the 2026-07-30 fix for CoStar's redesigned For-Sale Summary page,
// where the Google Maps embed chrome ("Keyboard shortcuts", "Map data ©2026
// Google", "Terms", "Report a map error") leaked into the sidebar Tenants list
// (live capture: 8925 N Highway 6, Houston TX — Fresenius Medical Care and
// Heffernan Bbq were real; the four map-widget lines were not).
const costarSrc = readFileSync(
  fileURLToPath(new URL('../extension/content/costar.js', import.meta.url)),
  'utf8',
);
const sidebarSrc = readFileSync(
  fileURLToPath(new URL('../api/_handlers/sidebar-pipeline.js', import.meta.url)),
  'utf8',
);

function extractNamedRegex(text, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\/(.+?)\\/([a-z]*);`);
  const m = re.exec(text);
  assert.ok(m, `expected a \`const ${name} = /.../;\` literal in source`);
  return new RegExp(m[1], m[2]);
}

// The Google Maps embed chrome that leaked into the tenant list.
const MAP_JUNK = [
  'Keyboard shortcuts',
  'Map data ©2026 Google',
  'Map Data ©2026 Google, INEGI',
  '©2026 Google',
  'Terms',
  'Terms of Use',
  'Report a map error',
  'Imagery ©2026 TerraMetrics',
  '1000 ft',
  '500 m',
  '2 km',
];

// Real tenant / owner names that must NOT be dropped — including the deliberate
// near-misses the anchored patterns are designed to preserve:
//   - "Satellite Healthcare" is a real dialysis operator (MEDICAL_TENANT_PRIORITY)
//   - "Google" can be a legitimate office tenant
//   - names that merely CONTAIN a map word ("Terms", "map", km/mi units)
const LEGIT = [
  'Fresenius Medical Care',
  'Heffernan Bbq',
  'Satellite Healthcare',
  'Google',
  'DaVita',
  'Terms Brothers Seed Co',
  'Mapleton Terrace Dental',
  'Kilometers Consulting',
  'US Bank',
];

for (const [label, src] of [
  ['extension MAP_WIDGET_REJECT (costar.js)', extractNamedRegex(costarSrc, 'MAP_WIDGET_REJECT')],
  ['server MAP_WIDGET_RE (sidebar-pipeline.js)', extractNamedRegex(sidebarSrc, 'MAP_WIDGET_RE')],
]) {
  describe(label, () => {
    for (const junk of MAP_JUNK) {
      it(`drops map-widget chrome: ${JSON.stringify(junk)}`, () => {
        assert.equal(src.test(junk), true, `expected ${JSON.stringify(junk)} to be rejected`);
      });
    }
    for (const name of LEGIT) {
      it(`keeps real tenant: ${JSON.stringify(name)}`, () => {
        assert.equal(src.test(name), false, `expected ${JSON.stringify(name)} to be kept`);
      });
    }
  });
}
