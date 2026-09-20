# mcp-census-server

An MCP server that audits other MCP servers.

Built in TypeScript on `@modelcontextprotocol/sdk`, under `strict` with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Every classification rule
in it was derived from measuring the public ecosystem — 33,489 registry entries, 1,300
live endpoint probes, 285 server-years of version history — not from reading the spec.

```bash
npm install && npm run build
npm start            # stdio transport
npm run start:http   # HTTP transport, OAuth 2.1 protected
npm run evals        # 39 checks: contract, definition quality, and auth
```

## Tools

| tool | what it answers |
|---|---|
| `probe_mcp_endpoint` | Is this endpoint live, what does it expose, and if it refused — why? |
| `compare_tool_surfaces` | Did a server's tool surface change between two observations? |
| `ecosystem_baseline` | Is what I just measured normal for this ecosystem? |

All baseline figures carry their sample size and date. Two of them are sample-sensitive and
say so in the tool output: the drift half-lives are computed over servers that have a real
release history, so they describe active servers rather than the whole population; and the
registry-hygiene rate falls from 9.5% to **6.5%** once the single largest hosting namespace
is excluded, because dead endpoints are correlated by provider rather than independent.

## Four measurements that shaped the implementation

**1. The `initialize` handshake is not optional.** A naive `tools/list` probe reports
**7.5%** of registry endpoints as reachable. The identical population, probed with a
correct handshake, reports **54.8%**. Skipping the handshake does not measure the
ecosystem — it measures your client. This is a failure mode worth naming because it is
easy to hit and the two results look equally publishable; careful prior work in this area
does handshake correctly, and independently arrived at the same ~52-55% figure.

**2. A 401/403 is not evidence of authentication.** **61.7%** of refusals carry a CDN/WAF
fingerprint (`cf-ray`, `x-vercel-id`, `x-amz-cf-id`). Counting those as "requires
credentials" overstates real server-level auth by roughly 3x. `probe_mcp_endpoint`
returns `WAF_BLOCKED` and `AUTH_REQUIRED` as distinct states for exactly this reason.

**3. Streamable HTTP responses may be SSE-framed**, and the JSON-RPC body can sit past a
naive byte cutoff. Truncating the read turns a healthy server into a "does not speak MCP"
result. The parser scans every line and never truncates.

**4. Timeouts are not failures.** `TIMEOUT` is a distinct state from `DEAD`. A probe that
folds "no answer yet" into "broken" manufactures findings.

## Why the tool descriptions look like that

Every description states what the tool **returns** and what it **cannot determine**.
The usual failure mode is a description written for a human skimming a README, which
leaves an agent guessing at parameters and misreading results — a caller that cannot
distinguish *no evidence* from *evidence of absence* will confidently report a false zero.

The eval suite enforces this as a contract: each tool description must state a return,
state a limit, and exceed 120 characters. Definition quality is tested, not asserted.

## Verified end-to-end

Driven over stdio against a live third-party server:

```
initialize            -> { name: "mcp-census", version: "1.0.0" }
tools/list            -> probe_mcp_endpoint, compare_tool_surfaces, ecosystem_baseline
probe_mcp_endpoint    -> state: LIVE
                         server: a2awire 0.1.0   protocol: 2025-06-18
                         tools: 23   surface hash: d0df1b80…   elapsed: 1193 ms
```

Structured logs go to **stderr only** — stdout is the JSON-RPC channel on a stdio
transport, and writing to it is the most common way a working MCP server becomes an
unparseable one.

## OAuth 2.1 Resource Server

Enabled by setting `MCP_OAUTH_ISSUER` and `MCP_OAUTH_RESOURCE`; it then **fails closed**
on every request to `/mcp`.

| path | protected |
|---|---|
| `/.well-known/oauth-protected-resource` | **public** — RFC 9728 discovery |
| `/healthz` | public, leaks nothing |
| `/mcp` | gated; 401 carries `WWW-Authenticate` |

Gating the metadata document would be a bug, not extra security: a client that cannot
read it cannot discover how to authenticate, and the 401 becomes unrecoverable.

### 🚨 Audience binding is the check that matters

The MCP spec forbids accepting a token that was not issued for this server. Without an
`aud` check, anyone holding a valid token for *any* resource on the same issuer can spend
it here — the confused-deputy attack. `aud` is the field most often skipped, and skipping
it turns authentication into decoration. It is verified explicitly, and reported as its own
`invalid_audience` state rather than collapsing into a generic failure.

Verified live against a running server with real minted tokens:

```
1. PRM discovery (must be PUBLIC)   HTTP 200  ["http://127.0.0.1:8792"]
2. NO token                         HTTP 401  WWW-Authenticate: Bearer realm="mcp", resource_metadata=...
3. token for ANOTHER resource       HTTP 401  invalid_audience
4. VALID token, correct audience    HTTP 200  -> MCP initialize OK: mcp-census 1.0.0
5. /healthz (public)                HTTP 200  {"ok":true,"auth":"required"}
```

18 auth evals mint real RS256 tokens against a real JWKS and assert every refusal:
wrong audience, absent audience, expired, wrong issuer, tampered signature, missing
scope, malformed header, empty header.

## Scope and limits

- Read-only. Lists tools on a target; never invokes them.
- `bearer` is supported so you can probe endpoints you own or are authorized to test.
- Registry-declared surfaces and live surfaces are different things. A remote server can
  change its `tools/list` without touching its registry entry, and the registry publishes
  no tool list at all — which is why `compare_tool_surfaces` compares observations rather
  than trusting any declaration.

MIT.
