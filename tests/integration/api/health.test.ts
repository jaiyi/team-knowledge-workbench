import { afterEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../../../apps/api/src/server.js';

const servers = new Set<ReturnType<typeof createApiServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
});

describe('API health check', () => {
  it('reports that the API process is alive', async () => {
    const server = createApiServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to expose a TCP port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns not found for an unknown route', async () => {
    const server = createApiServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to expose a TCP port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/unknown`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ status: 'not_found' });
  });
});
