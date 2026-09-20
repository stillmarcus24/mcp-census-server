/**
 * OAuth 2.1 Resource Server for MCP (spec revision 2025-06-18).
 *
 * An MCP server is a RESOURCE SERVER, never an authorization server. It validates
 * tokens minted elsewhere and publishes where to get them.
 *
 * 🚨 The check that matters most is AUDIENCE BINDING.
 *
 * The MCP authorization spec is explicit: a server MUST NOT accept a token that
 * was not issued for it, and MUST NOT pass a client's token through to an
 * upstream API. Without an audience check, any caller holding a valid token for
 * *any* resource on the same issuer can spend it here — the confused-deputy
 * attack. Every field below (`iss`, `aud`, `exp`, `nbf`, signature) is verified;
 * `aud` is the one that is routinely omitted, and omitting it turns
 * authentication into decoration.
 *
 * Token validation is delegated to `jose` (JWKS caching, algorithm handling,
 * clock skew). Hand-rolling JWT verification is a liability, not a credential.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthConfig {
  /** Authorization server issuer URL, e.g. https://auth.example.com — must match `iss` exactly. */
  readonly issuer: string;
  /**
   * This server's canonical resource identifier (RFC 8707). Tokens MUST carry it
   * in `aud` or they are rejected.
   */
  readonly resource: string;
  /** JWKS endpoint. Defaults to `${issuer}/.well-known/jwks.json`. */
  readonly jwksUri?: string;
  /** Scopes a caller must hold. Empty means authentication only. */
  readonly requiredScopes?: readonly string[];
  /** Accepted signing algorithms. Deliberately allow-listed — never trust `alg` from the token. */
  readonly algorithms?: readonly string[];
}

export type AuthFailure =
  | 'missing_token'
  | 'malformed_header'
  | 'invalid_token'      // signature, issuer, expiry, nbf
  | 'invalid_audience'   // token was minted for a DIFFERENT resource
  | 'insufficient_scope';

export interface AuthResult {
  readonly ok: boolean;
  readonly failure?: AuthFailure;
  readonly claims?: JWTPayload;
  readonly detail?: string;
}

/** RFC 9728 Protected Resource Metadata — how a client discovers where to authenticate. */
export function protectedResourceMetadata(cfg: AuthConfig): Record<string, unknown> {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: cfg.requiredScopes ?? [],
    // Only advertised when the operator sets it. Shipping a hardcoded URL we do not
    // control would publish a dead link in a discovery document clients actually fetch.
    ...(process.env['MCP_RESOURCE_DOCS'] ? { resource_documentation: process.env['MCP_RESOURCE_DOCS'] } : {}),
  };
}

/**
 * The `WWW-Authenticate` value returned on 401, pointing a client at the metadata
 * document. Without this header a client cannot discover how to authenticate and
 * simply fails — the spec requires it.
 */
export function wwwAuthenticate(cfg: AuthConfig, failure?: AuthFailure): string {
  const parts = [
    `Bearer realm="mcp"`,
    `resource_metadata="${cfg.resource}/.well-known/oauth-protected-resource"`,
  ];
  if (failure === 'insufficient_scope') parts.push(`error="insufficient_scope"`);
  else if (failure && failure !== 'missing_token') parts.push(`error="invalid_token"`);
  return parts.join(', ');
}

export class TokenVerifier {
  readonly #cfg: AuthConfig;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(cfg: AuthConfig) {
    this.#cfg = cfg;
    const uri = cfg.jwksUri ?? `${cfg.issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    // jose caches keys and handles rotation; a cold key fetch happens at most once per kid.
    this.#jwks = createRemoteJWKSet(new URL(uri));
  }

  /** Extract a bearer token from an Authorization header value. */
  static extractBearer(header: string | undefined): { token?: string; failure?: AuthFailure } {
    if (!header) return { failure: 'missing_token' };
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m?.[1]) return { failure: 'malformed_header' };
    return { token: m[1] };
  }

  async verify(authorizationHeader: string | undefined): Promise<AuthResult> {
    const { token, failure } = TokenVerifier.extractBearer(authorizationHeader);
    if (!token) return { ok: false, failure: failure ?? 'missing_token' };

    let claims: JWTPayload;
    try {
      const { payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.#cfg.issuer,
        algorithms: [...(this.#cfg.algorithms ?? ['RS256', 'ES256'])],
        clockTolerance: 5,
        // `aud` is checked explicitly below so audience failure is reported as its
        // own state rather than collapsing into a generic invalid_token.
      });
      claims = payload;
    } catch (e) {
      return { ok: false, failure: 'invalid_token', detail: e instanceof Error ? e.message : 'verification failed' };
    }

    // 🚨 AUDIENCE BINDING — the confused-deputy guard.
    const aud = claims.aud;
    const audiences = Array.isArray(aud) ? aud : aud ? [aud] : [];
    if (!audiences.includes(this.#cfg.resource)) {
      return {
        ok: false,
        failure: 'invalid_audience',
        detail: `token audience [${audiences.join(', ') || 'none'}] does not include this resource ` +
                `(${this.#cfg.resource}); refusing a token minted for a different server`,
      };
    }

    const required = this.#cfg.requiredScopes ?? [];
    if (required.length > 0) {
      const granted = typeof claims['scope'] === 'string' ? claims['scope'].split(/\s+/) : [];
      const missing = required.filter((s) => !granted.includes(s));
      if (missing.length > 0) {
        return { ok: false, failure: 'insufficient_scope', detail: `missing scope: ${missing.join(' ')}` };
      }
    }

    return { ok: true, claims };
  }
}
