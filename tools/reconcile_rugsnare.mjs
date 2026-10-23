#!/usr/bin/env node
// Recomputes every figure in RECONCILIATION-RUGSNARE.md from the dated artifact.
// Zero dependencies.
//
// v2 (2026-10-22, same day as v1). v1 joined the HOSTED axis only and concluded we had
// nothing to contribute. The hosted facts were right; the conclusion was wrong, because
// the counterparty's corpus is npm PACKAGES and the package-keyed series was never
// joined. v2 declares BOTH axes and is gated by tools/axis_coverage.mjs, which fails the
// build if an artifact has no axis matching the counterparty's vantage.
//
//   node tools/reconcile_rugsnare.mjs            # print both columns
//   node tools/reconcile_rugsnare.mjs selftest   # known-answer checks + the axis gate
import { readFileSync } from 'node:fs';
import { checkArtifact, checkNegativeClaim } from './axis_coverage.mjs';

const SRC = new URL('../reconciliation/rugsnare-2026-10-22.json', import.meta.url);
const DOC = new URL('../RECONCILIATION-RUGSNARE.md', import.meta.url);
const doc = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = doc.rows;

export const pkgRows = () => rows.filter((r) => r.package_axis.in_our_series);
export const windows = () => rows.flatMap((r) => r.package_axis.windows.map((w) => ({ ...w, pkg: r.npm_package, slug: r.slug })));
export const byClass = (c) => windows().filter((w) => w.classification === c);
export const hostedEndpoints = () => rows.flatMap((r) => r.hosted_axis.endpoints);
export function hostedStates() {
  const s = {};
  for (const e of hostedEndpoints()) s[e.stillos_state] = (s[e.stillos_state] || 0) + 1;
  return s;
}
// Rows where a new network host appears in a version window — the finding class a
// package-pin scanner is built to surface.
export const newHostWindows = () => byClass('CAPABILITY_CHANGE').filter((w) => (w.categories.new_hosts || []).length);

function main() {
  console.log(`subject      ${doc.subject}`);
  console.log(`measured_at  ${doc.measured_at_utc}  (is_current_state=${doc.is_current_state})`);
  console.log(`schema       ${doc.schema}`);
  console.log('\naxes declared:');
  for (const [n, a] of Object.entries(doc.axes_declared)) {
    console.log(`  ${n.padEnd(8)} key=${a.key.padEnd(26)} indexed_by=${a.indexed_by.padEnd(22)} matches_their_vantage=${a.matches_their_vantage}`);
  }
  const t = doc.totals;
  console.log(`\nPACKAGE AXIS (matches their vantage) — ${t.package_axis.covered} of ${t.their_corpus} covered`);
  console.log(`  version-pair rows ${t.package_axis.version_pair_rows} | CAPABILITY_CHANGE ${t.package_axis.capability_changes} | BUNDLE_NOISE ${t.package_axis.bundle_noise} | HASH_ONLY ${t.package_axis.hash_only}`);
  for (const r of pkgRows()) {
    const p = r.package_axis;
    console.log(`  ${r.npm_package.padEnd(36)} rows=${String(p.version_pair_rows).padEnd(3)} changed=${p.changed_windows} noise=${p.bundle_noise_windows} hashonly=${p.hash_only_windows}`);
  }
  console.log(`\nwindows introducing a new network host: ${newHostWindows().length}`);
  for (const w of newHostWindows()) console.log(`  ${w.pkg} ${w.from}->${w.to}  ${JSON.stringify(w.categories.new_hosts).slice(0, 96)}`);
  console.log(`\nHOSTED AXIS (does NOT match their vantage) — ${t.hosted_axis.declaring_endpoint} of ${t.their_corpus} declare an endpoint`);
  console.log(`  states ${JSON.stringify(t.hosted_axis.states)} | surface events ${t.hosted_axis.surface_events} | silent ${t.hosted_axis.silent_changes}`);
}

function selftest() {
  let pass = 0; let fail = 0;
  const t = (name, got, want) => {
    JSON.stringify(got) === JSON.stringify(want)
      ? pass++
      : (fail++, console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`));
  };
  // ── THE GATE. This is the whole reason v2 exists.
  t('artifact passes the axis-coverage gate', checkArtifact(doc), []);
  t('a package axis is declared and matches their vantage', doc.axes_declared.package.matches_their_vantage, true);
  t('the hosted axis is declared as NOT matching their vantage', doc.axes_declared.hosted.matches_their_vantage, false);
  t('the artifact names what it supersedes and why', /joined ONLY the hosted axis/.test(doc.supersedes), true);
  t('the document makes no unbacked negative claim',
    checkNegativeClaim(doc, readFileSync(DOC, 'utf8')), []);

  const tt = doc.totals;
  t('their corpus', tt.their_corpus, 22);
  t('rows match the corpus', rows.length, 22);
  t('package axis covers 9', tt.package_axis.covered, 9);
  t('65 version-pair rows', tt.package_axis.version_pair_rows, 65);
  t('17 capability changes', tt.package_axis.capability_changes, 17);
  t('1 bundle-noise window', tt.package_axis.bundle_noise, 1);
  t('4 hash-only windows', tt.package_axis.hash_only, 4);
  t('classes partition the changed windows',
    tt.package_axis.capability_changes + tt.package_axis.bundle_noise + tt.package_axis.hash_only, windows().length);

  // The bundle-noise call must be the ui5 patch, and must NOT be counted as a finding.
  const noise = byClass('BUNDLE_NOISE');
  t('the bundle-noise window is @ui5/mcp-server 0.3.0->0.3.1',
    noise.map((w) => `${w.pkg} ${w.from}->${w.to}`), ['@ui5/mcp-server 0.3.0->0.3.1']);
  t('the bundle-noise window carries its reason', /un-vendored/.test(noise[0].note), true);
  t('hash-only windows carry their reason',
    byClass('HASH_ONLY').every((w) => /no tracked category did/.test(w.note || '')), true);

  // The two rows that make this a contribution rather than a correction.
  const sup = rows.find((r) => r.slug === 'supabase');
  t('we hold the supabase windows their scanner failed on', sup.package_axis.version_pair_rows, 2);
  t('the supabase window introduces new hosts',
    sup.package_axis.windows.some((w) => (w.categories.new_hosts || []).includes('supabase.green')), true);
  const sen = rows.find((r) => r.slug === 'sentry');
  t('we hold a sentry window', sen.package_axis.version_pair_rows, 3);

  // EXACT MATCH. The substring pass put a NOAA tides server under `currents`.
  t('currents is the exact @currents/mcp package', rows.find((r) => r.slug === 'currents').npm_package, '@currents/mcp');
  t('bybit is the exact trading-mcp package', rows.find((r) => r.slug === 'bybit').npm_package, 'trading-mcp');
  t('no noaa or bitbybit lookalike reached the artifact',
    rows.every((r) => !/noaa|bitbybit/.test(r.npm_package)), true);
  t('exact-match law is recorded', /never by substring/.test(doc.exact_match_law), true);
  t('classification law is recorded', /never counted as capability findings/.test(doc.classification_law), true);

  // Hosted axis still correct — v1's facts were never the problem.
  t('hosted states unchanged from v1', hostedStates(), { WAF: 2, TOOLS_DENIED: 1, NOT_UNDER_CLOCK: 1, LIVE: 1 });
  t('hosted silent changes still zero', tt.hosted_axis.silent_changes, 0);
  t('5 of 22 declare a hosted endpoint', tt.hosted_axis.declaring_endpoint, 5);

  t('dated, not current', doc.is_current_state, false);
  t('carries a measurement timestamp', /^\d{4}-\d{2}-\d{2}T/.test(doc.measured_at_utc), true);
  console.log(`selftest: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

process.argv[2] === 'selftest' ? selftest() : main();
