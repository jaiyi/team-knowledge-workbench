import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Realm = {
  realm: string;
  enabled: boolean;
  sslRequired: string;
  registrationAllowed: boolean;
  clients: Array<{
    clientId: string;
    publicClient: boolean;
    standardFlowEnabled: boolean;
    implicitFlowEnabled: boolean;
    directAccessGrantsEnabled: boolean;
    serviceAccountsEnabled: boolean;
    redirectUris: string[];
    webOrigins: string[];
    attributes: Record<string, string>;
  }>;
  users?: unknown[];
};

const realm = () => JSON.parse(readFileSync(new URL('../../deploy/test-idp/realm.json', import.meta.url), 'utf8')) as Realm;

describe('isolated TEST IdP realm contract', () => {
  it('registers only a public code + S256 Web client with an exact HTTPS callback', () => {
    const config = realm();
    expect(config).toMatchObject({ realm: 'workbench-test', enabled: true, sslRequired: 'external',
      registrationAllowed: false });
    expect(config.clients).toHaveLength(1);
    expect(config.clients[0]).toMatchObject({ clientId: 'workbench-web', publicClient: true,
      standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ['https://workbench.example.invalid/auth/callback'],
      webOrigins: ['https://workbench.example.invalid'],
      attributes: { 'pkce.code.challenge.method': 'S256', 'id.token.signed.response.alg': 'RS256' } });
    expect(JSON.stringify(config)).not.toMatch(/privateKey|clientSecret|password|users|\*|http:\/\//i);
  });
});
