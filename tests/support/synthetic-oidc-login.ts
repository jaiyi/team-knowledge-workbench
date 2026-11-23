import { createHash, randomBytes } from 'node:crypto';

type Identity = { issuer: string; sub: string; principalId: string; email?: string };
type Claims = {
  issuer: string; sub: string; clientId: string; audience: string; nonce: string;
  challenge: string; backendOrigin: string; environment: string; email?: string;
};
type Host = { hostId: string; hostSecret: string; backendOrigin: string; environment: string };
type Transaction = {
  hostId: string; hostSecretDigest: string; nonce: string; verifier: string; challenge: string;
  expiresAt: number; backendOrigin: string; environment: string;
};
type Return = { hostId: string; hostSecretDigest: string; state: string; principalId: string;
  issuer: string; sub: string; expiresAt: number; backendOrigin: string; environment: string };
type Session = { hostId: string; hostSecretDigest: string; principalId: string;
  issuer: string; sub: string; expiresAt: number };

const denied = { ok: false as const, reason: 'unavailable' };
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');

// Isolated test fixture only: fixture-issued codes stand in for a real IdP and are NOT signed OIDC tokens.
export function createSyntheticOidcLogin(fixture: {
  issuer: string; clientId: string; audience: string; backendOrigin: string; environment: string;
  identities: Identity[]; clock: () => number;
}) {
  const hosts = new Map<string, string>();
  const identities = new Map(fixture.identities.map((identity) =>
    [JSON.stringify([identity.issuer, identity.sub]), identity.principalId]));
  const transactions = new Map<string, Transaction>();
  const codes = new Map<string, { claims: Claims; state: string; verifierDigest: string; expiresAt: number }>();
  const returns = new Map<string, Return>();
  const sessions = new Map<string, Session>();
  const revoked = new Set<string>();
  let issuerAvailable = true;
  let backendAvailable = true;
  let revocationAvailable = true;

  const trustedHost = (host: Host) => host.backendOrigin === fixture.backendOrigin
    && host.environment === fixture.environment && hosts.get(host.hostId) === digest(host.hostSecret);
  const active = (issuer: string, sub: string) => revocationAvailable
    && !revoked.has(JSON.stringify([issuer, sub]));
  const clearHost = (hostId: string) => {
    for (const [state, attempt] of transactions) if (attempt.hostId === hostId) transactions.delete(state);
    for (const [reference, pending] of returns) if (pending.hostId === hostId) returns.delete(reference);
    for (const [handle, session] of sessions) if (session.hostId === hostId) sessions.delete(handle);
  };

  return {
    registerHost(hostId: string, secret: string) {
      if (!hostId || !secret) return;
      clearHost(hostId);
      hosts.set(hostId, digest(secret));
    },
    begin(host: Host) {
      if (!backendAvailable || !trustedHost(host)) return denied;
      clearHost(host.hostId);
      const state = token();
      const nonce = token();
      const verifier = token();
      const challenge = digest(verifier);
      transactions.set(state, {
        hostId: host.hostId, hostSecretDigest: digest(host.hostSecret), nonce, verifier, challenge,
        expiresAt: fixture.clock() + 60_000, backendOrigin: host.backendOrigin, environment: host.environment,
      });
      return { ok: true as const, state, nonce, challenge, clientId: fixture.clientId, audience: fixture.audience };
    },
    // Test-only issuer hook; never expose this method as a Backend or renderer API.
    issueFixtureCode(state: string, sub: string, overrides: Partial<Claims> & { verifier?: string } = {}): string | null {
      const attempt = transactions.get(state);
      if (!issuerAvailable || !attempt || attempt.expiresAt <= fixture.clock()) return null;
      const { verifier = attempt.verifier, ...claimOverrides } = overrides;
      const code = token();
      codes.set(code, {
        state, verifierDigest: digest(verifier), expiresAt: fixture.clock() + 60_000,
        claims: {
          issuer: fixture.issuer, sub, clientId: fixture.clientId, audience: fixture.audience,
          nonce: attempt.nonce, challenge: attempt.challenge, backendOrigin: attempt.backendOrigin,
          environment: attempt.environment, ...claimOverrides,
        },
      });
      return code;
    },
    completeCallback(request: { state: string; code: string; backendOrigin: string; environment: string }) {
      if (!backendAvailable || !issuerAvailable || !revocationAvailable
        || request.backendOrigin !== fixture.backendOrigin || request.environment !== fixture.environment) return denied;
      const attempt = transactions.get(request.state);
      const authorization = codes.get(request.code);
      if (!attempt || !authorization || authorization.state !== request.state) return denied;
      codes.delete(request.code);
      transactions.delete(request.state);
      const claims = authorization.claims;
      const principalId = identities.get(JSON.stringify([claims.issuer, claims.sub]));
      if (attempt.expiresAt <= fixture.clock() || authorization.expiresAt <= fixture.clock()
        || claims.issuer !== fixture.issuer || claims.clientId !== fixture.clientId
        || claims.audience !== fixture.audience || claims.nonce !== attempt.nonce
        || claims.challenge !== attempt.challenge || authorization.verifierDigest !== digest(attempt.verifier)
        || claims.backendOrigin !== attempt.backendOrigin
        || claims.environment !== attempt.environment || !principalId || !active(claims.issuer, claims.sub)) return denied;
      const reference = token();
      returns.set(reference, {
        hostId: attempt.hostId, hostSecretDigest: attempt.hostSecretDigest, state: request.state,
        principalId, issuer: claims.issuer, sub: claims.sub, expiresAt: fixture.clock() + 30_000,
        backendOrigin: attempt.backendOrigin, environment: attempt.environment,
      });
      return { ok: true as const, reference };
    },
    // Host-only operation; the resulting handle must remain in Host custody, never the renderer.
    redeem(request: Host & { reference: string }) {
      if (!backendAvailable || !trustedHost(request)) return denied;
      const pending = returns.get(request.reference);
      if (!pending || pending.hostId !== request.hostId
        || pending.hostSecretDigest !== digest(request.hostSecret)
        || pending.backendOrigin !== request.backendOrigin || pending.environment !== request.environment
        || pending.expiresAt <= fixture.clock() || !active(pending.issuer, pending.sub)) return denied;
      returns.delete(request.reference);
      const sessionHandle = token();
      sessions.set(sessionHandle, {
        hostId: pending.hostId, hostSecretDigest: pending.hostSecretDigest, principalId: pending.principalId,
        issuer: pending.issuer, sub: pending.sub, expiresAt: fixture.clock() + 300_000,
      });
      return { ok: true as const, sessionHandle };
    },
    session(request: Host & { sessionHandle: string }) {
      if (!backendAvailable || !trustedHost(request)) return denied;
      const session = sessions.get(request.sessionHandle);
      if (!session || session.hostId !== request.hostId || session.hostSecretDigest !== digest(request.hostSecret)
        || session.expiresAt <= fixture.clock() || !active(session.issuer, session.sub)) return denied;
      return { ok: true as const, principalId: session.principalId };
    },
    logout(host: Host) { if (trustedHost(host)) clearHost(host.hostId); },
    revoke(issuer: string, sub: string) {
      revoked.add(JSON.stringify([issuer, sub]));
    },
    setIssuerAvailable(available: boolean) { issuerAvailable = available; },
    setBackendAvailable(available: boolean) { backendAvailable = available; },
    setRevocationAvailable(available: boolean) { revocationAvailable = available; },
  };
}
