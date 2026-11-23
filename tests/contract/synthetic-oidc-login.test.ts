import { describe, expect, it } from 'vitest';
import { createSyntheticOidcLogin } from '../support/synthetic-oidc-login.js';

const issuer = 'https://identity.example.invalid';
const backendOrigin = 'https://workbench.example.invalid';
const environment = 'isolated-test';
const host = { hostId: 'desktop-a', hostSecret: 'host-secret-a', backendOrigin, environment };
const otherHost = { hostId: 'desktop-b', hostSecret: 'host-secret-b', backendOrigin, environment };
const denied = { ok: false, reason: 'unavailable' };

const setup = () => {
  let now = Date.parse('2026-07-01T09:00:00Z');
  const login = createSyntheticOidcLogin({
    issuer, clientId: 'workbench-test', audience: 'workbench-backend', backendOrigin, environment,
    identities: [
      { issuer, sub: 'person-a', principalId: 'principal-a', email: 'same@example.invalid' },
      { issuer, sub: 'person-b', principalId: 'principal-b', email: 'same@example.invalid' },
      { issuer: 'https://other.example.invalid', sub: 'person-a', principalId: 'principal-other' },
    ],
    clock: () => now,
  });
  login.registerHost(host.hostId, host.hostSecret);
  login.registerHost(otherHost.hostId, otherHost.hostSecret);
  return { login, advance: (milliseconds: number) => { now += milliseconds; } };
};

const begin = (login: ReturnType<typeof createSyntheticOidcLogin>, selectedHost = host) => {
  const result = login.begin(selectedHost);
  if (!result.ok) throw new Error('Expected a synthetic login attempt');
  return result;
};
const callback = (login: ReturnType<typeof createSyntheticOidcLogin>, sub = 'person-a') => {
  const attempt = begin(login);
  const code = login.issueFixtureCode(attempt.state, sub);
  if (!code) throw new Error('Expected a synthetic issuer code');
  return { attempt, code, request: { state: attempt.state, code, backendOrigin, environment } };
};

// This is a test-only state machine, not an OIDC verifier or a Desktop login flow.
describe('T29 isolated OIDC return contract', () => {
  it('binds a synthetic code exchange and delivers identity only to the initiating Host', () => {
    const { login } = setup();
    const { attempt, code, request } = callback(login);
    expect(attempt).toMatchObject({ ok: true, clientId: 'workbench-test', audience: 'workbench-backend' });
    expect(Object.keys(attempt).sort()).toEqual(['audience', 'challenge', 'clientId', 'nonce', 'ok', 'state']);
    const completed = login.completeCallback(request);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(Object.keys(completed).sort()).toEqual(['ok', 'reference']);
    expect(completed.reference).not.toContain(code);
    expect(JSON.stringify(completed)).not.toContain(host.hostSecret);
    expect(login.redeem({ ...otherHost, reference: completed.reference })).toEqual(denied);
    const redeemed = login.redeem({ ...host, reference: completed.reference });
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(Object.keys(redeemed).sort()).toEqual(['ok', 'sessionHandle']);
    expect(login.session({ ...host, sessionHandle: redeemed.sessionHandle })).toEqual({
      ok: true, principalId: 'principal-a',
    });
    expect(login.redeem({ ...host, reference: completed.reference })).toEqual(denied);
    expect(login.completeCallback(request)).toEqual(denied);
    expect(login.session({ ...otherHost, sessionHandle: redeemed.sessionHandle })).toEqual(denied);
    expect(login.session({ ...host, hostSecret: 'wrong-secret', sessionHandle: redeemed.sessionHandle })).toEqual(denied);
  });

  it('rejects untrusted Backend targets and tampered callback routing', () => {
    const { login } = setup();
    expect(login.begin({ ...host, backendOrigin: 'https://wrong.example.invalid' })).toEqual(denied);
    expect(login.begin({ ...host, environment: 'production' })).toEqual(denied);
    expect(login.begin({ ...host, hostSecret: 'wrong-secret' })).toEqual(denied);
    const { request } = callback(login);
    for (const changed of [
      { backendOrigin: 'https://wrong.example.invalid' }, { environment: 'production' }, { state: 'wrong-state' },
    ]) expect(login.completeCallback({ ...request, ...changed })).toEqual(denied);
    expect(login.completeCallback(request).ok).toBe(true);
  });

  it.each([
    ['issuer', { issuer: 'https://other.example.invalid' }],
    ['client', { clientId: 'other-client' }],
    ['audience', { audience: 'other-service' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['PKCE challenge', { challenge: 'wrong-challenge' }],
    ['PKCE verifier', { verifier: 'wrong-verifier' }],
    ['Backend', { backendOrigin: 'https://wrong.example.invalid' }],
    ['environment', { environment: 'production' }],
  ] as const)('rejects a synthetic code with wrong %s without creating a session', (_name, claims) => {
    const { login } = setup();
    const attempt = begin(login);
    const code = login.issueFixtureCode(attempt.state, 'person-a', claims);
    expect(code).not.toBeNull();
    expect(login.completeCallback({ state: attempt.state, code: code!, backendOrigin, environment })).toEqual(denied);
    expect(login.session({ ...host, sessionHandle: 'none' })).toEqual(denied);
  });

  it('rejects unknown subjects and never merges equal emails or subjects under a different issuer', () => {
    const { login } = setup();
    const attempt = begin(login);
    const unknown = login.issueFixtureCode(attempt.state, 'unknown', { email: 'same@example.invalid' });
    expect(login.completeCallback({ state: attempt.state, code: unknown!, backendOrigin, environment })).toEqual(denied);
    const personB = callback(login, 'person-b');
    const completed = login.completeCallback(personB.request);
    if (!completed.ok) throw new Error('Expected approved subject');
    const redeemed = login.redeem({ ...host, reference: completed.reference });
    if (!redeemed.ok) throw new Error('Expected Host redemption');
    expect(login.session({ ...host, sessionHandle: redeemed.sessionHandle })).toEqual({ ok: true, principalId: 'principal-b' });
    const newAttempt = begin(login);
    const otherIssuer = login.issueFixtureCode(newAttempt.state, 'person-a', { issuer: 'https://other.example.invalid' });
    expect(login.completeCallback({ state: newAttempt.state, code: otherIssuer!, backendOrigin, environment })).toEqual(denied);
  });

  it('expires and consumes codes, one-time references and sessions independently', () => {
    const expiredCode = setup();
    const code = callback(expiredCode.login);
    expiredCode.advance(61_000);
    expect(expiredCode.login.completeCallback(code.request)).toEqual(denied);
    const expiredReturn = setup();
    const returned = callback(expiredReturn.login);
    const completed = expiredReturn.login.completeCallback(returned.request);
    if (!completed.ok) throw new Error('Expected synthetic callback');
    expect(expiredReturn.login.redeem({ ...host, hostSecret: '', reference: completed.reference })).toEqual(denied);
    expect(expiredReturn.login.redeem({ ...host, environment: 'production', reference: completed.reference })).toEqual(denied);
    expect(expiredReturn.login.redeem({ ...host, backendOrigin: 'https://wrong.example.invalid', reference: completed.reference })).toEqual(denied);
    expect(expiredReturn.login.redeem({ ...host, reference: 'guessed-reference' })).toEqual(denied);
    expiredReturn.advance(31_000);
    expect(expiredReturn.login.redeem({ ...host, reference: completed.reference })).toEqual(denied);
    const expiredSession = setup();
    const fresh = callback(expiredSession.login);
    const returnedAgain = expiredSession.login.completeCallback(fresh.request);
    if (!returnedAgain.ok) throw new Error('Expected synthetic callback');
    const session = expiredSession.login.redeem({ ...host, reference: returnedAgain.reference });
    if (!session.ok) throw new Error('Expected session');
    expiredSession.advance(301_000);
    expect(expiredSession.login.session({ ...host, sessionHandle: session.sessionHandle })).toEqual(denied);
  });

  it('invalidates outstanding returns and old sessions on account switch, logout and remote revocation', () => {
    const { login } = setup();
    const first = callback(login);
    const pending = login.completeCallback(first.request);
    if (!pending.ok) throw new Error('Expected pending return');
    const second = begin(login);
    expect(login.redeem({ ...host, reference: pending.reference })).toEqual(denied);
    const secondCode = login.issueFixtureCode(second.state, 'person-b');
    const secondReturn = login.completeCallback({ state: second.state, code: secondCode!, backendOrigin, environment });
    if (!secondReturn.ok) throw new Error('Expected second return');
    const secondSession = login.redeem({ ...host, reference: secondReturn.reference });
    if (!secondSession.ok) throw new Error('Expected second session');
    expect(login.session({ ...host, sessionHandle: secondSession.sessionHandle })).toEqual({ ok: true, principalId: 'principal-b' });
    login.logout(host);
    expect(login.session({ ...host, sessionHandle: secondSession.sessionHandle })).toEqual(denied);
    const third = callback(login, 'person-b');
    const thirdReturn = login.completeCallback(third.request);
    if (!thirdReturn.ok) throw new Error('Expected third return');
    const thirdSession = login.redeem({ ...host, reference: thirdReturn.reference });
    if (!thirdSession.ok) throw new Error('Expected third session');
    login.revoke(issuer, 'person-b');
    expect(login.session({ ...host, sessionHandle: thirdSession.sessionHandle })).toEqual(denied);
    const revokedAttempt = begin(login);
    const revokedCode = login.issueFixtureCode(revokedAttempt.state, 'person-b');
    expect(login.completeCallback({ state: revokedAttempt.state, code: revokedCode!, backendOrigin, environment })).toEqual(denied);
  });

  it('does not exchange a code under another transaction or redeem a revoked or logged-out return', () => {
    const { login } = setup();
    const first = callback(login);
    const other = begin(login, otherHost);
    expect(login.completeCallback({ ...first.request, state: other.state })).toEqual(denied);
    const code = login.issueFixtureCode(other.state, 'person-a');
    const pending = login.completeCallback({ state: other.state, code: code!, backendOrigin, environment });
    if (!pending.ok) throw new Error('Expected pending return');
    login.revoke(issuer, 'person-a');
    expect(login.redeem({ ...otherHost, reference: pending.reference })).toEqual(denied);
    const another = setup();
    const returned = callback(another.login);
    const pendingLogout = another.login.completeCallback(returned.request);
    if (!pendingLogout.ok) throw new Error('Expected pending return');
    another.login.logout(host);
    expect(another.login.redeem({ ...host, reference: pendingLogout.reference })).toEqual(denied);
  });

  it('fails closed if issuer, Backend or revocation status cannot be checked', () => {
    const { login } = setup();
    login.setIssuerAvailable(false);
    expect(login.issueFixtureCode(begin(login).state, 'person-a')).toBeNull();
    login.setIssuerAvailable(true);
    const { request } = callback(login);
    login.setBackendAvailable(false);
    expect(login.completeCallback(request)).toEqual(denied);
    login.setBackendAvailable(true);
    const valid = login.completeCallback(request);
    if (!valid.ok) throw new Error('Expected callback');
    login.setRevocationAvailable(false);
    expect(login.redeem({ ...host, reference: valid.reference })).toEqual(denied);
  });
});
