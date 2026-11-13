#!/usr/bin/env node
// Recomputes every figure in RECONCILIATION-AGENTNEXUS.md from the dated artifact.
// Zero dependencies. Same contract as tools/denominator_frames.mjs: the document is
// not allowed to carry a number this file cannot reproduce.
//
//   node tools/reconcile_agentnexus.mjs            # print the table
//   node tools/reconcile_agentnexus.mjs selftest   # known-answer checks
import { readFileSync } from 'node:fs';

const SRC = new URL('../reconciliation/agentnexus-2026-10-12.json', import.meta.url);
const doc = JSON.parse(readFileSync(SRC, 'utf8'));
const rows = doc.rows;

export function counts(rs = rows) {
  const c = {};
  for (const r of rs) c[r.stillos_state] = (c[r.stillos_state] || 0) + 1;
  return c;
}
export function silentChanges(rs = rows) {
  const hit = rs.filter((r) => r.silent_changes > 0);
  return { endpoints: hit.length, total: hit.reduce((a, r) => a + r.silent_changes, 0), rows: hit };
}
// A row where their column says healthy and ours says nothing answered. Not an
// accusation of error on either side — it is the disagreement that is the product.
export function disagreements(rs = rows) {
  return rs.filter((r) => r.their_health_ok === true
    && (r.stillos_state === 'DEAD' || r.stillos_state === 'WAF'));
}
// The class neither side can produce alone: a local stdio entry has no HTTP surface,
// so their health_ok is a package-availability fact and our column must stay silent.
export function notRemotelyObservable(rs = rows) {
  return rs.filter((r) => r.stillos_state === 'NOT_REMOTELY_OBSERVABLE');
}

function main() {
  const c = counts();
  const s = silentChanges();
  console.log(`subject      ${doc.subject}`);
  console.log(`measured_at  ${doc.measured_at_utc}  (dated observation, is_current_state=${doc.is_current_state})`);
  console.log(`rows         ${rows.length}`);
  console.log('\nStillOS column:');
  for (const k of Object.keys(c).sort()) console.log(`  ${String(c[k]).padStart(3)}  ${k}`);
  console.log(`\nsilent surface changes: ${s.total} across ${s.endpoints} endpoints`);
  for (const r of s.rows) console.log(`  ${String(r.silent_changes).padStart(2)}  ${r.slug}  (last ${r.last_change})`);
  console.log(`\nrows where their health_ok=true and ours did not answer: ${disagreements().length}`);
  for (const r of disagreements()) console.log(`  ${r.slug}  theirs=${r.their_status}  ours=${r.stillos_state}`);
  console.log(`\nnot remotely observable (local stdio entries): ${notRemotelyObservable().length}`);
}

function selftest() {
  let pass = 0; let fail = 0;
  const t = (name, got, want) => {
    JSON.stringify(got) === JSON.stringify(want)
      ? pass++
      : (fail++, console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`));
  };
  const c = counts();
  t('row count', rows.length, 114);
  t('every row carries a join key', rows.every((r) => typeof r.slug === 'string' && r.slug.length > 0), true);
  t('classes partition the population', Object.values(c).reduce((a, b) => a + b, 0), 114);
  t('LIVE', c.LIVE, 37);
  t('WAF', c.WAF, 22);
  t('AUTH', c.AUTH, 14);
  t('TOOLS_DENIED', c.TOOLS_DENIED, 9);
  // 4, not 3. The 2026-10-13 thread comment said "3 DEAD"; the artifact says 4.
  // The artifact is the measurement and the comment was the transcription error.
  t('DEAD is 4 (the thread comment said 3 — corrected here)', c.DEAD, 4);
  t('NOT_REMOTELY_OBSERVABLE', c.NOT_REMOTELY_OBSERVABLE, 28);
  const s = silentChanges();
  t('silent changes total', s.total, 17);
  t('silent changes endpoint count', s.endpoints, 6);
  // A dated column that claims to be current state is the one thing this file exists
  // to prevent — the whole asset is that it was taken on a specific day.
  t('artifact does not claim to be current state', doc.is_current_state, false);
  t('artifact carries a measurement timestamp', /^\d{4}-\d{2}-\d{2}T/.test(doc.measured_at_utc), true);
  t('every class used is defined', Object.keys(c).every((k) => k in doc.definitions), true);
  t('no local stdio row is given an HTTP verdict',
    notRemotelyObservable().every((r) => r.surface_events === 0 || r.stillos_first_seen === null), true);
  console.log(`selftest: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

process.argv[2] === 'selftest' ? selftest() : main();
