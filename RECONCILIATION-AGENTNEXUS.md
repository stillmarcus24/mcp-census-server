# Reconciliation — Agent Nexus catalogue

Requested in [#1](https://github.com/stillmarcus24/mcp-census-server/issues/1) on
2026-10-13: *"Option 1, please: open the PR against this repo, keyed to our slugs. We
would rather carry your column next to ours than keep a private reconciliation."*

This is that column. 114 rows, joined on the Agent Nexus slug.

- Artifact: [`reconciliation/agentnexus-2026-10-12.json`](reconciliation/agentnexus-2026-10-12.json)
- Reproduce every number below: `node tools/reconcile_agentnexus.mjs`
- Known-answer checks: `node tools/reconcile_agentnexus.mjs selftest` (15 cases, zero deps)

Same contract as [`DENOMINATORS.md`](DENOMINATORS.md): **this document is not allowed to
carry a figure the tool cannot reproduce from the artifact.**

## This is a dated observation, not current state

`measured_at_utc: 2026-10-12T23:17:00Z`, and `is_current_state` is `false` in the
artifact itself.

Agent Nexus acted on these findings on 2026-10-13 — `linear-mcp-server` moved to
`mcp.linear.app/mcp`, Cloudflare's docs endpoint moved `/sse` → `/mcp`, the
`figma-mcp-server` loopback row was withdrawn rather than given a false verdict, 10
duplicate pairs merged, 4 entries retired, and two rows pointing at nonexistent
packages corrected.

**So rows here will disagree with their live feed, by design.** The only way to know the
2026-10-12 surface is to have asked on 2026-10-12. A column that silently updates itself
to match today is not a record of anything.

## The StillOS column

| n | class | definition |
|---|---|---|
| 37 | `LIVE` | MCP `initialize` returned a usable result to an anonymous prober |
| 22 | `WAF` | a challenge/interstitial answered instead of the server |
| 14 | `AUTH` | reachable, requires credentials |
| 9 | `TOOLS_DENIED` | `initialize` succeeded, `tools/list` refused |
| 4 | `DEAD` | no answer at the published endpoint |
| 28 | `NOT_REMOTELY_OBSERVABLE` | the entry is a local stdio command (`npx`/`uvx`/`docker`) and has no HTTP surface to probe |
| **114** | | |

**Correction to the thread:** the 2026-10-13 comment said *3 `DEAD`*. The artifact says
**4**. The artifact is the measurement; the comment was a transcription error, and the
selftest pins the figure at 4 so it cannot drift back.

## What neither side can produce alone

**28 rows are not remotely observable.** They are local stdio commands. A `health_ok` on
those is a statement about whether an agent can still *obtain the artifact* from a
package registry — a real and useful measurement, and not a server measurement. Our
column stays silent on them rather than manufacturing an HTTP verdict, and the selftest
asserts that no such row carries one.

**25 rows have `their_health_ok: true` while our prober got no usable answer** — mostly
`401` and `WAF`. Neither column is wrong. They are measuring artifact availability and
credentialed reachability; we are measuring what an anonymous caller sees. The
disagreement is the signal, and it is the one thing a single scanner cannot generate.

**17 silent surface changes across 6 endpoints** — tool definitions changed with **no
version increment**:

| changes | slug | last change |
|---|---|---|
| 7 | `jithox-payment-checks-mcp` | 2026-10-05 |
| 3 | `agentcheck-mcp` | 2026-10-10 |
| 3 | `goai-moat-ai-visibility-audit-mcp` | 2026-10-06 |
| 2 | `agentguard-mcp` | 2026-10-12 |
| 1 | `uwear-mcp` | 2026-10-12 |
| 1 | `stringer-synthesizer-mcp` | 2026-10-06 |

A consumer pinning by version would have seen none of these.

## Standing arrangement

Both sides publish disagreements as they appear, rather than reconciling privately
first. Our column is clock-indexed; theirs is version- and credential-indexed. Neither
axis reconstructs the other, which is why carrying both beats agreeing on one.
