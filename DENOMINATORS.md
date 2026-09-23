# Denominators

Two scanners can measure the same registry, agree on every raw count, and publish
numbers 3.8x apart. This document fixes the definitions so that does not happen,
and ships a tool that reconciles them.

Everything below is from a single snapshot: **2026-09-19, 33,489 registry entries,
seed 20260919**. Reproduce with `node tools/denominator_frames.mjs selftest`
(18 known-answer checks, zero dependencies).

## The population is three classes, not two

| class | n | share | dependency-analysable? |
|---|---|---|---|
| npm-backed | 8,845 | 26.4% | yes |
| remote-only | 19,047 | 56.9% | **no — structurally incapable** |
| other artifact (PyPI, OCI, NuGet) | 5,597 | 16.7% | not by an npm tool |

**The trap:** `33,489 − 8,845 = 24,644`, which is *not* the remote-only count.
Subtracting npm-backed from the registry total overstates remote-only by ~29%,
because it silently absorbs the 5,597 non-npm artifacts. We hit this while
building the tool in this repo; the self-test now pins all three classes so it
cannot recur.

A remote-only entry has no artifact and no dependency graph. It cannot exhibit a
dependency-layer property at any sample size. Whether your denominator includes
entities that are structurally incapable of exhibiting the property is the entire
disagreement between two otherwise-correct scans.

## One fact, two defensible percentages

6,867 servers transitively depend on `@modelcontextprotocol/sdk`.

```
$ node tools/denominator_frames.mjs frames --exhibiting 6867

  npm-backed servers (dependency-analysable)   8,845    77.6%
  all registry servers                        33,489    20.5%
  swing                                                  3.79x
```

Both are true. Neither is wrong. They answer different questions, and a headline
that does not name its denominator is unreadable. Use your own counts:

```
node tools/denominator_frames.mjs frames \
  --exhibiting 1200 --registry 40000 --analysable 9000 --remote-only 21000
```

## Sample size is not the problem — we tested this and were wrong

We expected to show that studies using a ~6,030-server denominator materially
misstate their conclusions when recomputed on 33,489. Resampling our own
population refuted it:

| n | top-package reach | 95% range | packages ≥75% |
|---|---|---|---|
| 14 | 85.0% | 64.3–100 | 59.5 |
| 100 | 84.5% | 78–91 | 78.9 |
| 1,000 | 84.0% | 81.9–86.3 | 89.7 |
| 6,030 | 84.0% | 83.1–84.9 | 90 |
| 8,845 (truth) | **84.04%** | — | **90** |

At n=6,030 the estimates are essentially exact. A larger population does not by
itself make a smaller study's rate claims wrong. **Before claiming a bigger-n
study corrects a smaller one, resample your population down to their n and
check.** The correction is almost always the frame, not the count.

And never divide your absolute count by another study's sample size — their
servers are not your servers. Our first attempt at that table produced
">100% (impossible)" rows, which would have read as a fake gotcha.

## Concentration coefficients need a bias correction

Gini over package incidence, resampled from the same population:

| n | mean Gini | vs truth |
|---|---|---|
| 14 | 0.478 | **−0.483** |
| 100 | 0.784 | −0.177 |
| 1,000 | 0.907 | −0.054 |
| 8,845 (truth) | **0.9605** | — |

Gini is severely biased low at small n. A coefficient is **not comparable across
studies with different n** without a correction, and no current MCP work reports
one. Deep-scan small-n results remain valid as existence proofs; they cannot
support population rate claims.

Measure the bias on your own data before publishing a coefficient. A runnable
demo against the shipped synthetic fixture (2,000 servers, kernel-plus-tail shape,
seed 20260919):

```
$ node tools/denominator_frames.mjs gini-bias \
    --input tools/fixtures/example-servers.json --at 14,100,1000 --draws 100

  truth gini 0.7312  (n=2000)
  n=14     gini_mean=0.5098   bias=-0.2214
  n=100    gini_mean=0.6221   bias=-0.1091
  n=1000   gini_mean=0.7096   bias=-0.0216
```

Swap in your own scan. The input is one array of package names per server:
`[["@modelcontextprotocol/sdk","zod"], ["@modelcontextprotocol/sdk"], ["express"]]`.
Every `--at` size must be **≤ your population**; larger sizes are reported as
skipped rather than silently resampled with replacement.

Resampling draws **servers** and recomputes package incidence — the same direction
as a real scan, which is what makes the bias visible. Package-level resampling
does not reproduce it.

The fixture is synthetic and is there so the command above runs for anyone who
clones this repo. It is not a second measurement of the ecosystem, and its 0.7312
is not comparable to the 0.9605 measured on the real population.

## Reference distribution

`tools/fixtures/reach-histogram.json` is our measured package-reach distribution
(18,407 closure packages over 8,845 npm-backed servers). Top package `zod` at
84.04%; 90 packages at ≥75% reach; and an **empty band from 9.93% to 77.64%** —
nothing sits between the long tail and the kernel. The self-test pins all of it.

## Comparing against another scan

Report these five numbers and any two scans become reconcilable:

1. Registry total, with snapshot date.
2. Analysable subset, and the rule that defines it.
3. Structurally-incapable subset (cannot exhibit the property at any n).
4. Numerator as an **absolute count**, never only as a percentage.
5. For any coefficient: n, and the bias correction applied.

MIT. Corrections welcome as issues — a number in here that is wrong is worth more
to us than one that is unchallenged.
