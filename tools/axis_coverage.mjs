#!/usr/bin/env node
// axis_coverage.mjs — THE GATE THAT EXISTS BECAUSE WE PUBLISHED A WRONG NEGATIVE.
//
// 2026-10-22: a reconciliation column for the rugsnare corpus was joined on the HOSTED
// axis only (endpoint URL -> wall-clock observation), found 1 of 22 reachable, and was
// published to the counterparty as "zero silent changes, we have no silent drift to
// contribute." Every hosted fact in it was correct. The conclusion was wrong: their
// corpus is npm PACKAGES, and a package-keyed series with 154,142 rows was sitting on
// the same box, unjoined. The real answer was 9 of 22 covered, 65 version-pair rows,
// 17 capability changes — including the exact Supabase window their own scanner had
// failed on and reported as "manual fix queued" in the same thread.
//
// The failure mode is specific and it is NOT "forgot to look": a reconciliation was
// built by reusing the axis of the PREVIOUS reconciliation instead of asking which axis
// the counterparty measures. So the gate is:
//
//   1. An artifact MUST declare every axis it considered, each naming its real series
//      files, its join key, and whether that axis matches the counterparty's vantage.
//   2. At least one declared axis MUST have matches_their_vantage: true. If none does,
//      the artifact is answering a question nobody asked.
//   3. An artifact MAY NOT claim a negative result on an axis it did not join.
//
// Prose asking the author to remember this is a caption. This is a function, called
// from the reconcilers' selftests, so a wrong-axis artifact fails the build.
//
//   node tools/axis_coverage.mjs <artifact.json>   # check one artifact
//   node tools/axis_coverage.mjs selftest          # known-answer checks
import { readFileSync } from 'node:fs';

// Phrases that assert "we found nothing". If one of these is in a document, the
// artifact behind it has to have joined the counterparty's own axis to say it.
export const NEGATIVE_CLAIM = /nothing to contribute|no .{0,20}drift to contribute|zero .{0,20}to contribute|not in our (data|series)|we have nothing/i;

export function checkArtifact(doc) {
  const problems = [];
  const axes = doc.axes_declared;
  if (!axes || typeof axes !== 'object' || !Object.keys(axes).length) {
    problems.push('no axes_declared: the artifact does not say which axes it considered');
    return problems;
  }
  for (const [name, a] of Object.entries(axes)) {
    if (!Array.isArray(a.series) || !a.series.length) problems.push(`axis "${name}" names no series files`);
    if (!a.key) problems.push(`axis "${name}" declares no join key`);
    if (!a.indexed_by) problems.push(`axis "${name}" does not say what it is indexed by`);
    if (typeof a.matches_their_vantage !== 'boolean') problems.push(`axis "${name}" does not state whether it matches the counterparty's vantage`);
  }
  const matching = Object.entries(axes).filter(([, a]) => a.matches_their_vantage === true);
  if (!matching.length) {
    problems.push('NO declared axis matches the counterparty\'s vantage — this artifact answers a question nobody asked');
  }
  return problems;
}

// Guards the document, not just the data: a negative claim in prose must be backed by
// a joined matching axis that actually returned nothing.
export function checkNegativeClaim(doc, documentText) {
  const problems = [];
  if (!NEGATIVE_CLAIM.test(documentText || '')) return problems;
  const axes = Object.entries(doc.axes_declared || {});
  const matching = axes.filter(([, a]) => a.matches_their_vantage === true).map(([n]) => n);
  if (!matching.length) {
    problems.push('document asserts a negative result but no declared axis matches the counterparty\'s vantage');
    return problems;
  }
  for (const name of matching) {
    const t = doc.totals && doc.totals[`${name}_axis`];
    if (t && typeof t.covered === 'number' && t.covered > 0) {
      problems.push(`document asserts a negative result while the matching "${name}" axis covers ${t.covered} of the corpus — that is the 2026-10-22 defect verbatim`);
    }
  }
  return problems;
}

function selftest() {
  let pass = 0; let fail = 0;
  const t = (name, got, want) => {
    JSON.stringify(got) === JSON.stringify(want)
      ? pass++
      : (fail++, console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`));
  };
  const good = {
    axes_declared: {
      package: { series: ['a.jsonl'], key: 'exact npm package name', indexed_by: 'version pair', matches_their_vantage: true },
      hosted: { series: ['b.json'], key: 'exact endpoint URL', indexed_by: 'wall clock', matches_their_vantage: false },
    },
    totals: { package_axis: { covered: 9 }, hosted_axis: { covered: 1 } },
  };
  t('a two-axis artifact with a matching axis passes', checkArtifact(good), []);
  t('an artifact with no axes_declared fails', checkArtifact({}).length, 1);
  // THE EXACT 2026-10-22 ARTIFACT: hosted axis only, which does not match their vantage.
  const wrongAxis = { axes_declared: { hosted: { series: ['b.json'], key: 'url', indexed_by: 'wall clock', matches_their_vantage: false } } };
  t('the hosted-only artifact that caused this gate FAILS',
    checkArtifact(wrongAxis).some((p) => /answers a question nobody asked/.test(p)), true);
  t('an axis missing its series list fails',
    checkArtifact({ axes_declared: { x: { key: 'k', indexed_by: 'i', matches_their_vantage: true } } }).some((p) => /names no series/.test(p)), true);
  t('an axis not stating vantage fails',
    checkArtifact({ axes_declared: { x: { series: ['s'], key: 'k', indexed_by: 'i' } } }).length >= 1, true);
  // Negative-claim guard.
  t('the exact published sentence is recognised as a negative claim',
    NEGATIVE_CLAIM.test('we have no silent drift to contribute on your corpus'), true);
  t('"nothing to contribute" is recognised', NEGATIVE_CLAIM.test('We have nothing to contribute here.'), true);
  t('an ordinary sentence is not a negative claim',
    NEGATIVE_CLAIM.test('Our column is clock-indexed and dated.'), false);
  t('a negative claim backed by a covered matching axis FAILS',
    checkNegativeClaim(good, 'we have no silent drift to contribute').length, 1);
  t('a negative claim with zero coverage on the matching axis passes',
    checkNegativeClaim({ ...good, totals: { package_axis: { covered: 0 } } }, 'we have nothing to contribute'), []);
  t('a document with no negative claim is never blocked',
    checkNegativeClaim(good, 'Here are 17 capability changes.'), []);
  t('a negative claim with no matching axis at all FAILS',
    checkNegativeClaim(wrongAxis, 'nothing to contribute').length, 1);
  console.log(`axis_coverage selftest: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

// IS-MAIN GUARD. Without it, `import`ing this module runs the CLI dispatch below, so
// `node tools/reconcile_rugsnare.mjs` with no args printed this file's usage and exited
// 2 — a module that hijacks its importer's process. Caught immediately after writing
// the gate, by running the thing the gate is wired into.
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
const arg = isMain ? process.argv[2] : undefined;
if (!isMain) { /* imported: define only, never execute */ }
else if (arg === 'selftest') selftest();
else if (arg) {
  const doc = JSON.parse(readFileSync(arg, 'utf8'));
  const p = checkArtifact(doc);
  console.log(p.length ? 'FAIL\n  ' + p.join('\n  ') : 'ok — axis coverage declared and a matching axis is present');
  if (p.length) process.exit(1);
} else { console.log('usage: axis_coverage.mjs <artifact.json> | selftest'); process.exit(2); }
