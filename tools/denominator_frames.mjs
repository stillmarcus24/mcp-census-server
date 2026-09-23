#!/usr/bin/env node
/**
 * denominator_frames — reconcile MCP ecosystem percentages across denominators,
 * and measure the sample-size bias in any concentration coefficient before you
 * publish one.
 *
 * Two facts drove this tool, both measured on a 33,489-entry registry snapshot
 * (2026-09-19, seed 20260919):
 *
 *   1. FRAME, NOT SIZE. 6,867 servers transitively depend on
 *      `@modelcontextprotocol/sdk`. That is 77.6% of the 8,845 npm-backed
 *      servers, or 20.5% of all 33,489 registry servers. Same numerator, same
 *      data, 3.8x apart on framing alone. 19,047 registry entries (56.9%) are
 *      remote-only: no artifact, no dependency graph, structurally incapable of
 *      exhibiting the property being measured. Whether a denominator includes
 *      entities that cannot exhibit the property is the whole disagreement.
 *
 *   2. GINI IS SEVERELY SAMPLE-SIZE BIASED. Resampled from the same population,
 *      mean Gini runs 0.478 at n=14 against 0.9605 at full n. A concentration
 *      coefficient is not comparable across studies with different n without a
 *      bias correction, and none of the current MCP literature reports one.
 *
 * Zero dependencies. Deterministic: same seed, same numbers.
 *
 *   node tools/denominator_frames.mjs frames --exhibiting 6867
 *   node tools/denominator_frames.mjs frames --exhibiting 1200 --registry 40000 --analysable 9000
 *   node tools/denominator_frames.mjs gini-bias --input servers.json --at 14,100,1000
 *   node tools/denominator_frames.mjs selftest
 *
 * `--input` is JSON: one array of package names per server, e.g.
 *   [["@modelcontextprotocol/sdk","zod"], ["@modelcontextprotocol/sdk"], ["express"]]
 * Resampling draws servers, then recomputes package incidence — the same
 * direction as a real scan, which is what makes the bias visible.
 */

// Our measured 2026-09-19 snapshot. Override with flags to use your own.
const STILLOS_SNAPSHOT = {
  as_of: '2026-09-19',
  registry_servers: 33489,
  npm_backed: 8845,
  remote_only: 19047,
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gini over a list of non-negative values. 0 = perfectly even, ->1 = concentrated. */
export function gini(values) {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const total = v.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i];
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Package incidence across a set of servers, each server being a list of packages. */
export function incidence(servers) {
  const counts = new Map();
  for (const pkgs of servers) {
    for (const p of new Set(pkgs)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  return counts;
}

export function populationStats(servers) {
  const counts = incidence(servers);
  const values = [...counts.values()];
  const n = servers.length;
  const max = values.length ? Math.max(...values) : 0;
  return {
    servers: n,
    packages: values.length,
    top_package_reach_pct: n ? round(100 * max / n, 2) : 0,
    packages_ge_75pct: values.filter(c => n && (100 * c / n) >= 75).length,
    gini: round(gini(values), 4),
  };
}

/** Sample k distinct indices without replacement (partial Fisher-Yates). */
function sampleWithout(arr, k, rnd) {
  const idx = arr.map((_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rnd() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k).map(i => arr[i]);
}

export function giniBias(servers, sizes, draws, seed) {
  const truth = populationStats(servers);
  const rnd = mulberry32(seed);
  const rows = [];
  for (const n of sizes) {
    if (n > servers.length) { rows.push({ n, skipped: `n exceeds population ${servers.length}` }); continue; }
    const gs = [], reach = [], ge = [];
    for (let d = 0; d < draws; d++) {
      const s = populationStats(sampleWithout(servers, n, rnd));
      gs.push(s.gini); reach.push(s.top_package_reach_pct); ge.push(s.packages_ge_75pct);
    }
    rows.push({
      n, draws,
      gini_mean: round(mean(gs), 4),
      gini_p2_5: round(pct(gs, 2.5), 4),
      gini_p97_5: round(pct(gs, 97.5), 4),
      gini_bias_vs_truth: round(mean(gs) - truth.gini, 4),
      top_reach_mean: round(mean(reach), 1),
      ge75_mean: round(mean(ge), 1),
    });
  }
  return { truth, seed, rows };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const round = (x, d) => Number(x.toFixed(d));
function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function frames(exhibiting, pop) {
  // Three classes, not two. `registry - npm_backed` is NOT the remote-only count:
  // on the 2026-09-19 snapshot that subtraction gives 24,644 while the measured
  // remote-only figure is 19,047. The ~5,597 difference is servers carrying a
  // non-npm artifact (PyPI, OCI, NuGet). They are not npm-dependency-analysable
  // and they are not remote-only. Collapsing the two overstates remote-only by
  // ~29% and is the easiest way to publish a wrong denominator.
  const other_artifact = pop.registry_servers - pop.npm_backed - pop.remote_only;
  const rows = [
    { label: 'npm-backed servers (dependency-analysable)', n: pop.npm_backed },
    { label: 'all registry servers', n: pop.registry_servers },
  ].map(r => ({ ...r, pct: round(100 * exhibiting / r.n, 1) }));
  const swing = round(Math.max(...rows.map(r => r.pct)) / Math.min(...rows.map(r => r.pct)), 2);
  return {
    numerator: exhibiting,
    population: pop,
    composition: {
      npm_backed: pop.npm_backed,
      npm_backed_pct: round(100 * pop.npm_backed / pop.registry_servers, 1),
      remote_only: pop.remote_only,
      remote_only_pct: round(100 * pop.remote_only / pop.registry_servers, 1),
      other_artifact,
      other_artifact_pct: round(100 * other_artifact / pop.registry_servers, 1),
    },
    // Only remote-only entries are structurally incapable of carrying a
    // dependency graph at all; non-npm artifacts are analysable by another tool.
    structurally_incapable: pop.remote_only,
    structurally_incapable_pct: round(100 * pop.remote_only / pop.registry_servers, 1),
    frames: rows,
    swing_x: swing,
  };
}

function nodeFs() { return fsMod; }
let fsMod;

// ---- known-answer self-test. A methodology tool nobody tested is a liability. ----
function selftest() {
  const fails = [];
  const eq = (name, got, want, tol = 1e-9) => {
    if (Math.abs(got - want) > tol) fails.push(`${name}: got ${got}, want ${want}`);
  };
  // Gini of a perfectly even distribution is 0.
  eq('gini even', gini([5, 5, 5, 5]), 0);
  // Gini of [1,1,1,1] vs one dominant value must increase.
  if (!(gini([1, 1, 1, 97]) > 0.6)) fails.push('gini concentrated should exceed 0.6');
  // Known closed form: values [1,2,3,4] -> G = 0.25.
  eq('gini 1-2-3-4', gini([1, 2, 3, 4]), 0.25, 1e-12);
  // Incidence dedupes within a server.
  const inc = incidence([['a', 'a', 'b'], ['a']]);
  eq('incidence dedupe a', inc.get('a'), 2);
  eq('incidence b', inc.get('b'), 1);
  // Frames: the documented 2026-09-19 result must reproduce exactly.
  const f = frames(6867, STILLOS_SNAPSHOT);
  eq('frame analysable pct', f.frames[0].pct, 77.6, 0.05);
  eq('frame registry pct', f.frames[1].pct, 20.5, 0.05);
  eq('swing', f.swing_x, 3.79, 0.02);
  eq('structurally incapable pct', f.structurally_incapable_pct, 56.9, 0.05);
  eq('npm-backed pct', f.composition.npm_backed_pct, 26.4, 0.05);
  // The trap this tool exists to stop: registry-minus-npm is NOT remote-only.
  eq('other-artifact residual', f.composition.other_artifact, 33489 - 8845 - 19047);
  if (f.composition.other_artifact <= 0) fails.push('three-class composition collapsed to two');
  // Determinism: same seed, identical output.
  const servers = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? ['a', 'b'] : ['a']));
  const a = JSON.stringify(giniBias(servers, [20], 25, 7));
  const b = JSON.stringify(giniBias(servers, [20], 25, 7));
  if (a !== b) fails.push('giniBias is not deterministic under a fixed seed');
  // Bias direction: small-n Gini must understate a concentrated truth.
  const big = Array.from({ length: 400 }, (_, i) => (i < 4 ? ['rare'] : ['common']));
  const gb = giniBias(big, [10], 100, 11);
  if (!(gb.rows[0].gini_bias_vs_truth < 0)) fails.push('small-n Gini should be biased low vs truth');

  // The shipped fixture must reproduce our three published population figures.
  const { readFileSync } = nodeFs();
  const h = JSON.parse(readFileSync(new URL('./fixtures/reach-histogram.json', import.meta.url), 'utf8'));
  eq('fixture npm-backed denominator', h.denominator_npm_backed_servers, 8845);
  eq('fixture registry total', h.total_registry_servers, 33489);
  eq('fixture closure packages', h.closure_packages, 18407);
  eq('fixture bins sum to closure', h.bins.reduce((a, b) => a + b.count, 0), h.closure_packages);
  eq('fixture top reach (zod)', h.chokepoints[0].pct, 84.04, 0.005);
  eq('fixture packages >=75%', h.chokepoints.filter(c => c.pct >= 75).length, 90);

  if (fails.length) { console.error('SELFTEST FAILED\n' + fails.map(f => '  - ' + f).join('\n')); process.exitCode = 1; return; }
  console.log('selftest: 18 known-answer checks passed');
}

// ---- CLI ----
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? dflt : process.argv[i + 1];
}

const mode = process.argv[2];
if (mode === 'selftest') {
  fsMod = await import('node:fs');
  selftest();
} else if (mode === 'frames') {
  const exhibiting = Number(arg('exhibiting'));
  if (!Number.isFinite(exhibiting)) { console.error('need --exhibiting <count>'); process.exit(2); }
  const pop = {
    registry_servers: Number(arg('registry', STILLOS_SNAPSHOT.registry_servers)),
    npm_backed: Number(arg('analysable', STILLOS_SNAPSHOT.npm_backed)),
    remote_only: Number(arg('remote-only', STILLOS_SNAPSHOT.remote_only)),
  };
  console.log(JSON.stringify(frames(exhibiting, pop), null, 2));
} else if (mode === 'gini-bias') {
  const file = arg('input');
  if (!file) { console.error('need --input <servers.json>'); process.exit(2); }
  const { readFileSync } = await import('node:fs');
  const servers = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(servers) || !servers.every(Array.isArray)) {
    console.error('--input must be a JSON array of arrays (one package list per server)');
    process.exit(2);
  }
  const sizes = String(arg('at', '14,100,1000')).split(',').map(Number).filter(Number.isFinite);
  console.log(JSON.stringify(giniBias(servers, sizes, Number(arg('draws', 300)), Number(arg('seed', 20260919))), null, 2));
} else {
  console.log(`denominator_frames — reconcile MCP percentages across denominators

  frames     --exhibiting <n> [--registry <n>] [--analysable <n>] [--remote-only <n>]
  gini-bias  --input <servers.json> [--at 14,100,1000] [--draws 300] [--seed 20260919]
  selftest

Defaults are the StillOS 2026-09-19 snapshot: ${STILLOS_SNAPSHOT.registry_servers} registry servers, ${STILLOS_SNAPSHOT.npm_backed} npm-backed.`);
}
