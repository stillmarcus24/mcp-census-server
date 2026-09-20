/**
 * HTTP transport with OAuth 2.1 protection.
 *
 * Route order is load-bearing:
 *   1. `/.well-known/oauth-protected-resource` is PUBLIC. A client that cannot
 *      reach the metadata document cannot discover how to authenticate, so
 *      gating it produces an unrecoverable 401 loop.
 *   2. `/healthz` is PUBLIC and leaks nothing.
 *   3. `/mcp` is gated. A rejection returns 401 WITH `WWW-Authenticate`.
 *
 * Auth is enabled only when MCP_OAUTH_ISSUER and MCP_OAUTH_RESOURCE are both
 * set. It fails CLOSED per-request: if a verifier is configured, no request
 * reaches the transport without a valid token.
 */
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { server } from './index.js';
import { TokenVerifier, protectedResourceMetadata, wwwAuthenticate, type AuthConfig } from './auth.js';
import { log } from './telemetry.js';

export function buildApp(cfg?: AuthConfig): express.Express {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  const verifier = cfg ? new TokenVerifier(cfg) : undefined;

  // (1) PUBLIC — RFC 9728 discovery. Never gate this.
  app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
    if (!cfg) { res.status(404).json({ error: 'auth_not_configured' }); return; }
    res.json(protectedResourceMetadata(cfg));
  });

  // (2) PUBLIC — liveness, no detail.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true, auth: cfg ? 'required' : 'disabled' });
  });

  // (3) GATED — fails closed whenever a verifier exists.
  app.post('/mcp', async (req: Request, res: Response) => {
    if (verifier && cfg) {
      const result = await verifier.verify(req.header('authorization'));
      if (!result.ok) {
        log('auth_reject', { failure: result.failure, detail: result.detail });
        res.status(result.failure === 'insufficient_scope' ? 403 : 401)
           .set('WWW-Authenticate', wwwAuthenticate(cfg, result.failure))
           .json({ error: result.failure, error_description: result.detail });
        return;
      }
      log('auth_ok', { sub: String(result.claims?.sub ?? 'unknown') });
    }
    // Stateless: a fresh transport per request. No session to hijack, and no
    // cross-request state to leak between differently-authorized callers.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    res.on('close', () => { void transport.close(); });
    // Upstream typing gap, not laxity here: the SDK's `Transport` interface declares
    // `onclose?: () => void`, which does not satisfy `exactOptionalPropertyTypes` because
    // the implementation's property is `(() => void) | undefined`. Relaxing the compiler
    // flag would hide this class of bug across the whole project, so the assertion is
    // confined to this one line. Remove it when the SDK's types are updated.
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

export function authConfigFromEnv(): AuthConfig | undefined {
  const issuer = process.env['MCP_OAUTH_ISSUER'];
  const resource = process.env['MCP_OAUTH_RESOURCE'];
  if (!issuer || !resource) return undefined;
  const cfg: AuthConfig = {
    issuer, resource,
    ...(process.env['MCP_OAUTH_JWKS_URI'] ? { jwksUri: process.env['MCP_OAUTH_JWKS_URI'] } : {}),
    ...(process.env['MCP_OAUTH_SCOPES'] ? { requiredScopes: process.env['MCP_OAUTH_SCOPES'].split(/\s+/) } : {}),
  };
  return cfg;
}

if (process.argv[1]?.endsWith('http.js')) {
  const cfg = authConfigFromEnv();
  const port = Number(process.env['PORT'] ?? 8770);
  buildApp(cfg).listen(port, () => {
    log('http_startup', { port, auth: cfg ? 'enabled' : 'DISABLED — set MCP_OAUTH_ISSUER + MCP_OAUTH_RESOURCE' });
  });
}
