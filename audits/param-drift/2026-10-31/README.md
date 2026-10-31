# MCP Parameter Drift Series v1

**Still OS Digital Holdings LLC** · window **2026-09-21 → 2026-10-31**

What ARGUMENTS changed under a held tool name, on live MCP servers, recorded from
our own observations. No registry, archive or mirror stores historical input
schemas, so this series is not back-fillable by anyone who was not recording. It
ships with its control.

Producer: `core/mcp_param_drift.cjs` (self-test 48/48). Prober:
`core/mcp_surface_clock.cjs` `observe()` — the same one that produced the series,
not a second implementation. Every file here is written by that producer, so a
published figure cannot disagree with its stdout.

## Files

| file | what it is |
|---|---|
| `params-changed-2026-09-21_2026-10-31.jsonl` | 2,822 attributable events, URL-keyed, one row per event, `version_before`/`version_after` verbatim including nulls |
| `unattributable.jsonl` | 611 events held OUT of the clean cut (see below) |
| `measurement.json` | the headline measurement |
| `classes.json` | `CREDENTIAL_ARRIVED`, `DESTINATION_ARRIVED`, `SAFETY_REMOVED`, attributed rows |
| `control.json` | the three controls |
| `reprobe-2026-10-31.json` | 14 silent rows asked of the servers themselves |

## The measurement

- **3,433 PARAMS_CHANGED events over 1,218 servers.** 2,524 (73.5%) carry a
  declared version unmoved on both sides.
- **Kill-check:** 2,498 of those carry a real version string on both sides — a
  **72.8% floor**. 26 (0.8%) are vacuous (both null). The flag is not an artifact
  of missing version data.
- **611 events (17.8%) are UNATTRIBUTABLE** and live in their own file. They
  predate the per-tool parameter field our clock added 2026-10-03. They are
  reported separately and never folded into a denominator as if clean.
- **Direction:** +11,156 gained / −1,315 lost = **8.5:1**. Surfaces accumulate
  arguments.
- **Durability:** 10,722 durable parameter slots vs 420 flapping (3.8%). Drift,
  not churn.
- **Concentration:** top-10 servers 7.2%, top-20 11.6%.

## The control — it cuts the headline above

**A rate without a baseline is not a finding.**

**A. Silent share by event kind, same population:**

| kind | events | silent |
|---|---|---|
| `DESCRIPTION_CHANGED` | 29,175 | 93.4% |
| `SURFACE_CHANGED` | 6,428 | 78.7% |
| `PARAMS_CHANGED` | 3,433 | **73.5%** |

Parameters are the **least** silent of the three. The raw share is therefore a
statement about version hygiene across these servers, **not** about parameters.
Anyone quoting the 73.5% as a parameter-specific finding, us included, is
borrowing the population baseline.

**B. Version-capable subset — what survives.** Restricted to the **1,106 servers
that moved a real version at least once** in the window, i.e. that demonstrably
can signal: **717 of 1,626 param changes (44.1%) were still silent.** This is the
narrower and harder claim, and it is immune to "they simply never version."

**C. Leave-one-out, recomputed rather than re-shared.** Dropping the busiest
server (31 events) gives **74.0%**; dropping the top ten gives **74.2%**. It is
the population, not one actor.

## Live re-probe

14 silent credential/destination rows asked of the servers themselves on
2026-10-31: **13 CONFIRMED** the parameter is still on that tool, **1
UNREACHABLE**, **0 ABSENT**. Reported because it can fail — the rename defect in
this engine's history was caught by a live re-probe and not by code.

`ABSENT` is not a refutation on its own: the surface may have moved again since.

## Known limits

- **Rename is not removal.** A parameter lost and a near-identical one gained in
  the same delta is a rename. The engine suppresses these in the safety class.
- `CREDENTIAL_ARRIVED` is the column worth consuming: **276 events, 186 (67.4%)
  silent, 276 distinct (server, tool, param)**. `DESTINATION_ARRIVED` is 27 events
  / 15 silent and `SAFETY_REMOVED` 26 / 7 — real, small, not headlined.
- A whole-word tokenizer with sense disambiguation is load-bearing: a substring
  matcher on these names measured 82% noise.

## Licence and citation

**Data in this directory: CC BY 4.0.** Code in this repository remains MIT.

> MCP Parameter Drift Series v1, Still OS Digital Holdings LLC, window
> 2026-09-21/2026-10-31.
