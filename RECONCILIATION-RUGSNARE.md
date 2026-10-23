# Reconciliation — rugsnare drift-watch corpus

Our column for the 22-server corpus in [snyk/agent-scan#482](https://github.com/snyk/agent-scan/issues/482),
joined against @Paraphern's
[`registry-mapping.json`](https://github.com/Paraphern/rugsnare/blob/main/audits/drift-watch/registry-mapping.json)
and the package list in their
[2026-10-17 run](https://github.com/Paraphern/rugsnare/blob/main/audits/drift-watch/2026-10-17.md).

- Artifact: [`reconciliation/rugsnare-2026-10-22.json`](reconciliation/rugsnare-2026-10-22.json) (`schema: stillos.reconciliation.v2`)
- Reproduce every number below: `node tools/reconcile_rugsnare.mjs`
- Known-answer checks: `node tools/reconcile_rugsnare.mjs selftest` (29 cases, zero deps)
- Axis gate: `node tools/axis_coverage.mjs reconciliation/rugsnare-2026-10-22.json`

Same contract as [`DENOMINATORS.md`](DENOMINATORS.md): **this document may not carry a
figure the tool cannot reproduce from the artifact.**

## v1 of this column was wrong, and the gate exists because of it

The first version joined **only the hosted axis** — endpoint URL → wall-clock
observation — found 1 of 22 endpoints reachable, and concluded *"we have no silent drift
to contribute."* Every hosted fact in it was correct.

**The conclusion was wrong.** This corpus is npm **packages**, pinned per release. A
package-keyed series with 154,142 rows was on the same box and was never joined. The
real answer is below.

The cause was specific: the column was built by reusing the axis of the previous
reconciliation instead of asking which axis *this* counterparty measures. So it is now a
build gate, not a lesson — [`tools/axis_coverage.mjs`](tools/axis_coverage.mjs) fails the
build if an artifact declares no axis matching the counterparty's vantage, **and** fails
it if this document asserts a negative result the matching axis contradicts. Run against
the v1 artifact it exits non-zero.

## Package axis — matches their vantage

**9 of 22 packages covered · 65 version-pair rows · 17 capability changes.**

| classification | n | meaning |
|---|---|---|
| `CAPABILITY_CHANGE` | 17 | a tracked category or magnitude moved between two releases |
| `BUNDLE_NOISE` | 1 | the diff is dominated by bundled-file string extraction |
| `HASH_ONLY` | 4 | content hash moved, no tracked category did |

| package | version-pair rows | capability changes |
|---|---|---|
| `@browserstack/mcp-server` | 20 | 11 |
| `@sap-ux/fiori-mcp-server` | 17 | 1 |
| `@upstash/context7-mcp` | 8 | 1 |
| `mongodb-mcp-server` | 6 | 0 |
| `chrome-devtools-mcp` | 4 | 3 |
| `@ui5/mcp-server` | 4 | 2 (+1 bundle-noise) |
| `@sentry/mcp-server` | 3 | 1 |
| `@supabase/mcp-server-supabase` | 2 | 2 |
| `figma-developer-mcp` | 1 | 0 |

### The two rows that fill gaps they named in the same thread

- **`@supabase/mcp-server-supabase`** — their 10-17 run records *"scan failed: 0.8.3
  entry path differs from 0.14.0; manual fix queued."* We hold `0.12.0 → 0.13.0`, which
  introduces hosts `127.0.0.1`, `api.supabase.green`, `supabase.green` with
  `exec_delta=8`, `net_delta=15` — plus `0.13.0 → 0.14.0`.
- **`@sentry/mcp-server`** — listed under *"no new releases."* We hold
  `0.39.0 → 0.40.0`, `exec_delta=2`.

### Staging infrastructure crossing into a GA release

`@browserstack/mcp-server` is the densest server in the set at 11 changed windows.
`1.5.0-beta.22 → 1.5.0` adds `ai-platform-service.bsstag.com` and
`auth-preprod.bsstag.com`; `1.5.1 → 2.0.0` adds `staging.example.com`.
`chrome-devtools-mcp 1.11.0 → 1.12.0` adds `internal.corp`.

## What we will not claim

- **`@ui5/mcp-server 0.3.0 → 0.3.1`** reports `net_delta -18391`, `exec -486`,
  `fs -198`, `eval -37` and drops 289 "hosts" including `-asdf.com`, `...`, `.com`,
  `0.0.0.127`. A patch release does not remove eighteen thousand network references — a
  dependency was un-vendored. At that magnitude our instrument cannot separate
  un-vendoring from a real capability change, so it is classified `BUNDLE_NOISE` and
  **not counted as a finding**. The threshold is on magnitude, not on the junk fraction:
  most extracted strings here are plausible hostnames, so a junk-ratio test misses the
  exact case it was written for.
- **4 windows are `HASH_ONLY`** — the content hash moved and no tracked category did.
  Reported as themselves.

## Hosted axis — does NOT match their vantage

Kept because v1's facts were never the problem, and labelled so it cannot be read as the
answer to their question.

| slug | our state | endpoint |
|---|---|---|
| `context7` | **`LIVE`** · 2 events, 0 silent | `mcp.context7.com/mcp` |
| `hostinger` | `WAF` | `mcp.hostinger.com` |
| `sentry` | `WAF` | `mcp.sentry.dev/mcp` |
| `currents` | `TOOLS_DENIED` | `gateway.pipeworx.io/currents/mcp` |
| `browserstack` | `NOT_UNDER_CLOCK` | `mcp.browserstack.com/mcp` |

**5 of 22 declare any remote endpoint. 2 surface events, 0 silent** — both the same
`context7` `4.2.0 → 4.3.0` transition, so a per-release pin already catches them. Six
mapped slugs declare no remote endpoint at all, which is a property of the registry
record, not a finding about the vendor.

`sentry` is a **both-miss**: WAF-walled to our prober on this axis, and on their
could-not-scan list. Zero *exposure* is not zero drift.

## Exact-match law

Package names and endpoint URLs are matched **exactly, never by substring**. A substring
pass put `@ryancardin/noaa-tides-currents-mcp-server` under `currents` and
`@bitbybit-dev/mcp` — a CAD library — under `bybit`. Those two rows would have read as
corroboration. A selftest case asserts no lookalike reached the artifact.

## Dated, not current

`measured_at_utc: 2026-10-22T19:40:08.749Z`, `is_current_state: false`. A column that
silently updates to match today is not a record of anything.
