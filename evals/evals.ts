/**
 * Eval suite.
 *
 * Two classes of check, because they fail differently:
 *   CONTRACT — the probe classifies known-answer endpoints correctly.
 *   DEFINITION QUALITY — the tool definitions are usable by an agent without
 *     guessing. This is the thing buyers cannot verify from a README and the
 *     reason most MCP servers are unpleasant to drive.
 */
import { probeEndpoint, parseRpc, detectWaf } from '../src/probe.js';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function main(): Promise<void> {
  console.log('\n— parser contract —');
  ok('parses plain JSON-RPC', parseRpc('{"jsonrpc":"2.0","id":1,"result":{}}')?.['id'] === 1);
  ok('parses SSE-framed body', parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":7}\n')?.['id'] === 7);
  ok('parses JSON past a long preamble (no truncation)',
    parseRpc(':' + 'x'.repeat(5000) + '\ndata: {"id":42}')?.['id'] === 42);
  ok('returns undefined on garbage, never throws', parseRpc('not json at all') === undefined);

  console.log('\n— WAF detection (a CDN refusal is not an auth refusal) —');
  ok('detects cf-ray', detectWaf(new Headers({ 'cf-ray': 'abc123' }), '') === 'cf-ray');
  ok('detects vercel', detectWaf(new Headers({ 'x-vercel-id': 'iad1' }), '') === 'x-vercel-id');
  ok('no false positive on a clean 401', detectWaf(new Headers({ 'www-authenticate': 'Bearer' }), '') === undefined);

  console.log('\n— probe contract against known answers —');
  const dead = await probeEndpoint('https://this-host-does-not-exist-stillos.invalid/mcp', { timeoutMs: 6000 });
  ok('unresolvable host => DEAD (not NOT_MCP)', dead.state === 'DEAD', `got ${dead.state}`);
  const notMcp = await probeEndpoint('https://example.com/', { timeoutMs: 8000 });
  ok('HTTP site that is not MCP => NOT_MCP or DEAD',
    ['NOT_MCP', 'DEAD', 'WAF_BLOCKED', 'TIMEOUT'].includes(notMcp.state), `got ${notMcp.state}`);
  ok('probe never throws — always a typed state', typeof dead.state === 'string');
  ok('elapsedMs always recorded', dead.elapsedMs >= 0);

  console.log('\n— tool-definition quality —');
  const { server } = await import('../src/index.js');
  const reg = (server as unknown as { _registeredTools: Record<string, {
    description?: string; inputSchema?: unknown }> })._registeredTools ?? {};
  const names = Object.keys(reg);
  ok('tools are registered', names.length >= 3, `found ${names.length}`);
  for (const n of names) {
    const d = reg[n]?.description ?? '';
    ok(`${n}: description states what it RETURNS`, /returns|reports|performs/i.test(d));
    ok(`${n}: description states a LIMIT (what it cannot determine)`, /cannot|not the same|only|does not/i.test(d));
    ok(`${n}: description is substantive (>120 chars)`, d.length > 120, `${d.length} chars`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
