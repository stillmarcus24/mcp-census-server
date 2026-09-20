/**
 * OAuth 2.1 resource-server evals.
 *
 * Real RSA keypair, real JWKS served over loopback, real signed tokens. Asserting
 * that audience binding works without minting a wrong-audience token and watching
 * it get rejected is not a test — it is a claim. Each case below is a token the
 * verifier MUST refuse, plus one it must accept, so a regression that opens the
 * door is caught rather than assumed away.
 */
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import { createServer, type Server } from 'node:http';
import { TokenVerifier, protectedResourceMetadata, wwwAuthenticate } from '../src/auth.js';

const ISSUER = 'http://127.0.0.1:8791';
const RESOURCE = 'https://census.example.com/mcp';
const OTHER_RESOURCE = 'https://someone-elses-server.example.com/mcp';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

async function main(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key-1'; jwk.alg = 'RS256'; jwk.use = 'sig';

  const jwks: Server = createServer((req, res) => {
    if (req.url?.startsWith('/.well-known/jwks.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk as JWK] }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => jwks.listen(8791, '127.0.0.1', r));

  const mint = (opts: { aud?: string | string[]; exp?: string; scope?: string; iss?: string }) => {
    let t = new SignJWT({ ...(opts.scope ? { scope: opts.scope } : {}) })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(opts.iss ?? ISSUER)
      .setSubject('agent-42')
      .setIssuedAt();
    if (opts.aud !== undefined) t = t.setAudience(opts.aud);
    return t.setExpirationTime(opts.exp ?? '5m').sign(privateKey);
  };

  const v = new TokenVerifier({ issuer: ISSUER, resource: RESOURCE, requiredScopes: ['census:read'] });

  console.log('\n— tokens that MUST be accepted —');
  const good = await mint({ aud: RESOURCE, scope: 'census:read census:write' });
  const r1 = await v.verify(`Bearer ${good}`);
  ok('valid token, correct audience, required scope => accepted', r1.ok, JSON.stringify(r1.failure));
  ok('claims are returned for the caller', r1.claims?.sub === 'agent-42');
  const multi = await mint({ aud: [OTHER_RESOURCE, RESOURCE], scope: 'census:read' });
  ok('multi-audience token containing this resource => accepted', (await v.verify(`Bearer ${multi}`)).ok);

  console.log('\n— 🚨 audience binding (confused-deputy guard) —');
  const wrongAud = await mint({ aud: OTHER_RESOURCE, scope: 'census:read' });
  const r2 = await v.verify(`Bearer ${wrongAud}`);
  ok('token minted for ANOTHER resource => invalid_audience', r2.failure === 'invalid_audience', String(r2.failure));
  ok('   ...and is NOT accepted', !r2.ok);
  const noAud = await mint({ scope: 'census:read' });
  ok('token with NO audience => invalid_audience', (await v.verify(`Bearer ${noAud}`)).failure === 'invalid_audience');

  console.log('\n— tokens that MUST be refused —');
  const expired = await mint({ aud: RESOURCE, exp: '-60s', scope: 'census:read' });
  ok('expired token => invalid_token', (await v.verify(`Bearer ${expired}`)).failure === 'invalid_token');
  const wrongIss = await mint({ aud: RESOURCE, iss: 'https://evil.example.com', scope: 'census:read' });
  ok('wrong issuer => invalid_token', (await v.verify(`Bearer ${wrongIss}`)).failure === 'invalid_token');
  const badSig = (await mint({ aud: RESOURCE, scope: 'census:read' })).slice(0, -6) + 'AAAAAA';
  ok('tampered signature => invalid_token', (await v.verify(`Bearer ${badSig}`)).failure === 'invalid_token');
  const noScope = await mint({ aud: RESOURCE, scope: 'something:else' });
  ok('missing required scope => insufficient_scope',
    (await v.verify(`Bearer ${noScope}`)).failure === 'insufficient_scope');

  console.log('\n— header handling —');
  ok('absent header => missing_token', (await v.verify(undefined)).failure === 'missing_token');
  ok('non-bearer scheme => malformed_header', (await v.verify('Basic abc123')).failure === 'malformed_header');
  ok('"Bearer" with no token => malformed_header', (await v.verify('Bearer')).failure === 'malformed_header');
  ok('fails CLOSED on empty string', !(await v.verify('')).ok);

  console.log('\n— RFC 9728 discovery —');
  const cfg = { issuer: ISSUER, resource: RESOURCE, requiredScopes: ['census:read'] };
  const meta = protectedResourceMetadata(cfg);
  ok('metadata names this resource', meta['resource'] === RESOURCE);
  ok('metadata names the authorization server', Array.isArray(meta['authorization_servers']));
  ok('WWW-Authenticate points at the metadata document',
    wwwAuthenticate(cfg).includes('/.well-known/oauth-protected-resource'));
  ok('WWW-Authenticate marks scope failures distinctly',
    wwwAuthenticate(cfg, 'insufficient_scope').includes('insufficient_scope'));

  jwks.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e: unknown) => { console.error(e); process.exit(1); });
