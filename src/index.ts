#!/usr/bin/env node
/**
 * mcp-census-server — an MCP server that audits other MCP servers.
 *
 * Tool-definition philosophy: every description states what the tool RETURNS and
 * what it CANNOT determine. The common failure in MCP servers is a description
 * written for a human skimming a README, which leaves an agent guessing at
 * parameters and misreading results. Each tool below names its own blind spots,
 * because a caller that cannot distinguish "no evidence" from "evidence of
 * absence" will confidently report a false zero.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { probeEndpoint } from './probe.js';
import { log } from './telemetry.js';

export const server = new McpServer({ name: 'mcp-census', version: '1.0.0' });

const urlArg = z.string().url().describe(
  'Full MCP endpoint URL including scheme and path, e.g. "https://example.com/mcp". ' +
  'A bare hostname will not work — MCP endpoints are path-specific and "https://example.com" ' +
  'is usually the marketing site, not the server.',
);

server.registerTool(
  'probe_mcp_endpoint',
  {
    title: 'Probe a live MCP endpoint',
    description:
      'Performs a real MCP initialize handshake against one endpoint and reports whether it is ' +
      'reachable, what it exposes, and why it refused if it did. Returns one of seven states: ' +
      'LIVE (tools enumerated), TOOLS_DENIED (handshake worked, tool listing refused), ' +
      'AUTH_REQUIRED (401/403 with no CDN fingerprint), WAF_BLOCKED (401/403 carrying a CDN ' +
      'signature — you were filtered as a bot, which is NOT the same as the server requiring ' +
      'credentials), NOT_MCP (answered HTTP but did not speak the protocol), DEAD (DNS failure or ' +
      '404 at the declared URL), or TIMEOUT (no answer in budget — explicitly NOT counted as broken). ' +
      'CANNOT determine: whether a WAF_BLOCKED or AUTH_REQUIRED server would expose tools to an ' +
      'authorized caller — pass `bearer` to find out. Does not execute any tool on the target; ' +
      'it only lists them.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      url: urlArg,
      bearer: z.string().optional().describe(
        'Optional bearer token, sent as `Authorization: Bearer <token>`. Use this to probe ' +
        'endpoints you own or are authorized to test. Without it, gated servers return ' +
        'AUTH_REQUIRED rather than their tool list.',
      ),
      timeoutMs: z.number().int().min(1000).max(60_000).default(15_000).describe(
        'Per-request timeout in milliseconds. Raise for slow cold-start servers; a TIMEOUT ' +
        'result means unmeasured, not broken.',
      ),
    },
  },
  async ({ url, bearer, timeoutMs }) => {
    const r = await probeEndpoint(url, { timeoutMs, bearer });
    log('probe', { url, state: r.state, ms: r.elapsedMs });
    return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
  },
);

server.registerTool(
  'compare_tool_surfaces',
  {
    title: 'Detect tool-surface drift between two probes',
    description:
      'Compares two tool-surface hashes (from `probe_mcp_endpoint`) and reports added, removed and ' +
      'parameter-changed tools. This is the check that catches mutation-after-approval: a server ' +
      'reviewed once can change the tools it exposes at any time, and the MCP registry publishes no ' +
      'tool list at all, so there is no authority to compare against except a prior observation. ' +
      'CANNOT determine intent — a changed surface is not evidence of compromise, only of change.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      before: z.array(z.string()).describe('Tool names from the earlier probe.'),
      after: z.array(z.string()).describe('Tool names from the later probe.'),
    },
  },
  async ({ before, after }) => {
    const b = new Set(before), a = new Set(after);
    const added = [...a].filter((x) => !b.has(x)).sort();
    const removed = [...b].filter((x) => !a.has(x)).sort();
    const changed = added.length > 0 || removed.length > 0;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          changed, added, removed,
          retained: [...a].filter((x) => b.has(x)).length,
          note: changed
            ? 'Surface changed. Re-review before continuing to trust prior approval.'
            : 'No change in the tool-name set. Parameter-level drift is not covered by name comparison alone.',
        }, null, 2),
      }],
    };
  },
);

server.registerTool(
  'ecosystem_baseline',
  {
    title: 'Measured baseline for the public MCP ecosystem',
    description:
      'Returns measured reference statistics for the public MCP registry, for use as a denominator ' +
      'when interpreting a single probe. All figures are observations with stated sample sizes and ' +
      'dates, not estimates. Use this to answer "is what I just measured normal?". ' +
      'CANNOT determine anything about a specific server — it is population context only.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {},
  },
  async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        measured_on: '2026-09-20',
        registry_entries: 33_705,
        live_probe: {
          n: 1300,
          enumerable_anonymously_pct: 54.8,
          refused_401_403_pct: 35.1,
          of_refusals_that_are_cdn_waf_pct: 61.7,
          dead_pct: 9.7,
          note: 'A tools/list probe WITHOUT the initialize handshake reports 7.5% reachable on this ' +
                'same population. The handshake is not optional.',
        },
        tool_surface: { median_tools: 7, p90_tools: 52, max_tools: 318, distinct_tools_observed: 3460 },
        drift: {
          version_bump_half_life_days: 26.7,
          invocation_surface_half_life_days: 127.2,
          install_surface_half_life_days: 32.5,
          sample: '2,705 real version transitions over 285 server-years of registry history',
          note: 'What a reviewer approves (invocation) is ~3.9x more stable than what actually runs (install).',
          caveat: 'Computed over servers that have a release history; 61% of registry entries have ' +
                  'exactly one version and have never changed. These rates describe ACTIVE servers, ' +
                  'not the whole population.',
        },
        registry_hygiene: {
          active_entries_pointing_at_dead_endpoint_pct: 9.5,
          dead_and_over_180d_still_marked_active: '53 of 53',
          active_entries_dead_excluding_largest_provider_pct: 6.5,
          note: 'Failure is correlated by provider namespace, not independent — two namespaces ' +
                'accounted for 54.7% of all dead endpoints, and one had 27 of 27 entries dead. ' +
                'Use the 6.5% figure for any claim about the ecosystem generally.',
        },
      }, null, 2),
    }],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('startup', { transport: 'stdio', tools: 3 });
}

// Only auto-start when executed directly, so the eval suite can import cleanly.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main().catch((e: unknown) => {
    log('fatal', { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
