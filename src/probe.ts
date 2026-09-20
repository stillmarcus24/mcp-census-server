/**
 * Live MCP endpoint probing.
 *
 * Every rule in this file was derived by measuring the public MCP ecosystem
 * (33,489 registry entries; 1,300 live endpoint probes; 285 server-years of
 * version history). The measurements that shaped it:
 *
 *  1. You MUST complete the `initialize` handshake before `tools/list`.
 *     A naive `tools/list` probe reports 7.5% of endpoints as reachable.
 *     The same population with a correct handshake reports 54.8%. Skipping the
 *     handshake does not measure the ecosystem, it measures your client.
 *
 *  2. A 401/403 is NOT evidence the server requires credentials. 61.7% of
 *     refusals carry a CDN/WAF fingerprint (cf-ray, vercel, x-amz-cf). Counting
 *     those as "auth required" overstates real server-level auth by ~3x.
 *
 *  3. Streamable HTTP replies may be SSE-framed. The JSON-RPC body arrives on a
 *     `data:` line, and can sit past a naive byte cutoff — truncating the read
 *     silently turns a healthy server into a "does not speak MCP" result.
 *
 *  4. Servers that issue `Mcp-Session-Id` on initialize require it echoed on
 *     subsequent calls, or the session is rejected.
 */

export const PROTOCOL_VERSION = '2025-06-18';

/** Why an endpoint could not be enumerated — deliberately distinct states. */
export type ProbeState =
  | 'LIVE'              // handshake + tools/list both succeeded
  | 'TOOLS_DENIED'      // initialize succeeded, tools/list refused (real MCP-level authz)
  | 'AUTH_REQUIRED'     // 401/403 with no CDN fingerprint — server-level auth
  | 'WAF_BLOCKED'       // 401/403 carrying a CDN/WAF signature — client filtered, not authz
  | 'NOT_MCP'           // answered HTTP but did not speak the protocol
  | 'DEAD'              // DNS failure, connection refused, 404 at the declared URL
  | 'TIMEOUT';          // no answer in budget — NOT counted as broken

export interface ToolSummary {
  readonly name: string;
  readonly description?: string | undefined;
  /** Top-level input parameter names, for surface hashing and drift detection. */
  readonly params: readonly string[];
}

export interface ProbeResult {
  readonly url: string;
  readonly state: ProbeState;
  readonly httpStatus?: number | undefined;
  /** CDN vendor fingerprint if one was detected on the response. */
  readonly waf?: string | undefined;
  readonly serverName?: string | undefined;
  readonly serverVersion?: string | undefined;
  readonly protocolVersion?: string | undefined;
  readonly tools?: readonly ToolSummary[] | undefined;
  /** Stable hash of the sorted tool-name set — the drift anchor. */
  readonly toolSurfaceHash?: string | undefined;
  readonly elapsedMs: number;
  readonly detail?: string | undefined;
}

const WAF_MARKERS = ['cf-ray', 'cloudflare', 'x-amz-cf-id', 'x-vercel-id', 'incapsula', 'sucuri', 'fastly', 'akamai'];

/** Detect a CDN/WAF fingerprint so a bot-filter is never misreported as auth. */
export function detectWaf(headers: Headers, body: string): string | undefined {
  const hay = [...headers.entries()].map(([k, v]) => `${k}:${v}`).join(' ').toLowerCase()
    + ' ' + body.slice(0, 400).toLowerCase();
  return WAF_MARKERS.find((m) => hay.includes(m));
}

/**
 * Extract the first JSON-RPC object from a response body.
 * Handles both plain JSON and SSE framing (`data: {...}`), and never truncates.
 */
export function parseRpc(raw: string): Record<string, unknown> | undefined {
  for (const line of raw.split('\n')) {
    const s = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!s.startsWith('{')) continue;
    try { return JSON.parse(s) as Record<string, unknown>; } catch { /* keep scanning */ }
  }
  return undefined;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface RpcCall {
  readonly url: string;
  readonly body: unknown;
  readonly sessionId?: string | undefined;
  readonly timeoutMs: number;
  readonly bearer?: string | undefined;
}

async function rpc({ url, body, sessionId, timeoutMs, bearer }: RpcCall): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Both are required: servers may answer either plain JSON or an SSE stream.
    'Accept': 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export interface ProbeOptions {
  readonly timeoutMs?: number;
  /** Bearer token for endpoints that require auth — enables probing your own gated servers. */
  readonly bearer?: string | undefined;
}

/**
 * Probe one MCP endpoint: initialize, notify initialized, enumerate tools.
 * Never throws — every failure is a typed state, because a thrown probe is a
 * lost measurement.
 */
export async function probeEndpoint(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const started = Date.now();
  const done = (r: Omit<ProbeResult, 'url' | 'elapsedMs'>): ProbeResult =>
    ({ url, elapsedMs: Date.now() - started, ...r });

  let initRes: Response;
  try {
    initRes = await rpc({
      url, timeoutMs, bearer: opts.bearer,
      body: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'mcp-census-server', version: '1.0.0' },
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = /abort|timeout/i.test(msg);
    return done({ state: isTimeout ? 'TIMEOUT' : 'DEAD', detail: msg.slice(0, 160) });
  }

  const initBody = await initRes.text();

  if (!initRes.ok) {
    const waf = detectWaf(initRes.headers, initBody);
    if (initRes.status === 401 || initRes.status === 403) {
      return done({
        state: waf ? 'WAF_BLOCKED' : 'AUTH_REQUIRED',
        httpStatus: initRes.status, waf,
        detail: waf ? `refused by ${waf} — client filtered, not necessarily authz` : 'server-level auth',
      });
    }
    if (initRes.status === 404) return done({ state: 'DEAD', httpStatus: 404, waf });
    return done({ state: 'NOT_MCP', httpStatus: initRes.status, waf, detail: initBody.slice(0, 160) });
  }

  const initRpc = parseRpc(initBody);
  if (!initRpc || !('result' in initRpc)) {
    return done({ state: 'NOT_MCP', httpStatus: initRes.status, detail: initBody.slice(0, 160) });
  }

  const result = initRpc['result'] as Record<string, unknown> | undefined;
  const info = result?.['serverInfo'] as Record<string, unknown> | undefined;
  const sessionId = initRes.headers.get('mcp-session-id') ?? undefined;

  // Required by spec; failure here is not fatal to enumeration.
  try {
    await rpc({ url, timeoutMs, sessionId, bearer: opts.bearer,
      body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  } catch { /* non-fatal */ }

  let toolsRes: Response;
  try {
    toolsRes = await rpc({ url, timeoutMs, sessionId, bearer: opts.bearer,
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  } catch (e) {
    return done({ state: 'TOOLS_DENIED', detail: e instanceof Error ? e.message.slice(0, 160) : 'unknown' });
  }

  const toolsBody = await toolsRes.text();
  const toolsRpc = parseRpc(toolsBody);
  const list = (toolsRpc?.['result'] as Record<string, unknown> | undefined)?.['tools'];

  const base = {
    httpStatus: initRes.status,
    serverName: typeof info?.['name'] === 'string' ? info['name'] : undefined,
    serverVersion: typeof info?.['version'] === 'string' ? info['version'] : undefined,
    protocolVersion: typeof result?.['protocolVersion'] === 'string' ? result['protocolVersion'] : undefined,
  };

  if (!Array.isArray(list)) {
    return done({ ...base, state: 'TOOLS_DENIED', detail: toolsBody.slice(0, 160) });
  }

  const tools: ToolSummary[] = list.map((t) => {
    const tool = t as Record<string, unknown>;
    const schema = tool['inputSchema'] as Record<string, unknown> | undefined;
    const props = schema?.['properties'] as Record<string, unknown> | undefined;
    return {
      name: String(tool['name'] ?? ''),
      description: typeof tool['description'] === 'string' ? tool['description'] : undefined,
      params: props ? Object.keys(props).sort() : [],
    };
  });

  const surface = tools.map((t) => t.name).sort();
  return done({ ...base, state: 'LIVE', tools, toolSurfaceHash: await sha256Hex(JSON.stringify(surface)) });
}
