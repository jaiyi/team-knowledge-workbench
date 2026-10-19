import { createServer, type Server, type ServerResponse } from 'node:http';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from '../../apps/api/src/server.js';
import { buildLocalPackage } from '../../packages/distribution-adapter/src/local-package-builder.js';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';

const servers = new Set<Server>();
const listen = async (server: Server): Promise<string> => {
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local server');
  return `http://127.0.0.1:${address.port}`;
};
const close = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  servers.delete(server);
};
afterEach(async () => {
  await Promise.all([...servers].map(close));
});

const loadHost = async (config: Record<string, unknown>, withConnection = true) => {
  const files = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' }).files;
  const host = files.find((file) => file.path === 'workbench-host.js')?.content;
  const server = files.find((file) => file.path === 'index.js')?.content;
  if (!host || !server) throw new Error('Expected Host bundle files');
  const registrations: Array<{ readiness: {
    status: string;
    probe?: () => Promise<{ status: string; reference: string }>;
  } }> = [];
  const effects: Array<() => (() => void)> = [];
  const routes: Array<{ path: string; methods: string[]; requestBody: string; fetch: (request: Request) => Promise<Response> }> = [];
  const activeRoutes = new Set<string>();
  const hostUrl = `data:text/javascript,${encodeURIComponent(host)}`;
  const serverUrl = `data:text/javascript,${encodeURIComponent(server.replace("'./workbench-host.js'", JSON.stringify(hostUrl)))}`;
  const serverModule = await import(serverUrl) as { apply: (ctx: {
    provide: (_name: string, registration: typeof registrations[number]) => void;
    effect: (effect: () => (() => void)) => void;
    connection?: { fetch: { register: (route: typeof routes[number]) => void } };
  }, config: Record<string, unknown>) => void };
  serverModule.apply({
    provide: (_name, registration) => registrations.push(registration),
    effect: (effect) => effects.push(effect),
    ...(withConnection ? { connection: { fetch: { register: (route: typeof routes[number]) => {
      routes.push(route);
      activeRoutes.add(route.path);
      effects.push(() => () => { activeRoutes.delete(route.path); });
    } } } } : {}),
  }, config);
  const requestStatus = async (method = 'GET') => {
    const route = routes.find((item) => item.path === '/api/team-knowledge-workbench.health');
    if (!route || !activeRoutes.has(route.path) || !route.methods.includes(method)) return undefined;
    return route.fetch(new Request('http://localhost/api/team-knowledge-workbench.health', { method }));
  };
  return { registrations, effects, routes, requestStatus };
};

describe('Workbench package fixture', () => {
  it('contains a self-consistent Host bundle and runtime registration', () => {
    const input = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' });
    const built = buildLocalPackage(input);
    const server = built.files.find((file) => file.path === 'index.js');
    const manifest = built.files.find((file) => file.path === 'package.json');
    const registration = built.files.find((file) => file.path === 'cordis.patch.yml');

    expect(server?.content).toContain('export function apply(ctx, config = {})');
    expect(server?.content).toContain("export const inject = ['connection']");
    expect(server?.content).toContain('DSH host Workbench runtime identity mismatch');
    expect(manifest?.content).toContain('"@local/team-knowledge-workbench"');
    expect(manifest?.content).toContain('"bundle": { "patch": "./cordis.patch.yml" }');
    expect(registration?.content).toContain('team-knowledge-workbench');
    expect(registration?.content).toContain('name: \'@local/team-knowledge-workbench\'');
    expect(registration?.content).toContain(`runtime_identity_digest: '${built.manifest.runtime_identity_digest}'`);
    expect(registration?.content).not.toContain('sha256:0000000000000000000000000000000000000000000000000000000000000000');
    expect(built.manifest.runtime_identity_digest).not.toBe(built.manifest.artifact_digest);
  });

  it('writes an explicitly configured local API endpoint into the patch and generated Host', async () => {
    const api = createApiServer();
    const backendEndpoint = await listen(api);
    const input = buildWorkbenchPackageInput({
      sourceCommit: '0123456789abcdef0123456789abcdef01234567', backendEndpoint,
    });
    const patch = input.files.find((file) => file.path === 'cordis.patch.yml')?.content;
    expect(patch).toContain(`backendEndpoint: '${backendEndpoint}'`);
    const configuredEndpoint = patch?.match(/backendEndpoint: '([^']+)'/)?.[1];
    const { registrations } = await loadHost({ backendEndpoint: configuredEndpoint });
    await expect(registrations[0]?.readiness.probe?.()).resolves.toEqual({
      status: 'ok', reference: 'api-health-reachable',
    });
  });

  it('omits the endpoint by default and refuses noncanonical or remote inputs', () => {
    const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
    const patch = buildWorkbenchPackageInput({ sourceCommit }).files.find(
      (file) => file.path === 'cordis.patch.yml',
    )?.content;
    expect(patch).not.toContain('backendEndpoint');
    for (const backendEndpoint of [
      'http://localhost:3000', 'https://127.0.0.1:3000', 'http://192.168.1.1:3000',
      'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000?token=secret',
      'http://user:pass@127.0.0.1:3000', 'http://127.0.0.1:3000/#fragment',
      'http://127.0.0.1:3000/%2e%2e/', 'http://127.0.0.1',
    ]) {
      expect(() => buildWorkbenchPackageInput({ sourceCommit, backendEndpoint })).toThrow(
        'backend endpoint must be a canonical loopback HTTP origin',
      );
    }
  });

  it('probes the configured local API and degrades on disconnect before recovering', async () => {
    const server = createApiServer();
    const backendEndpoint = await listen(server);
    const { registrations, effects } = await loadHost({ backendEndpoint });
    const probe = registrations[0]?.readiness.probe;
    expect(typeof probe).toBe('function');
    expect(registrations[0]?.readiness.status).toBe('pending');
    await expect(probe?.()).resolves.toEqual({ status: 'ok', reference: 'api-health-reachable' });

    await close(server);
    await expect(probe?.()).resolves.toEqual({ status: 'degraded', reference: 'api-unavailable' });
    const replacement = createApiServer();
    servers.add(replacement);
    await new Promise<void>((resolve) => replacement.listen(Number(new URL(backendEndpoint).port), '127.0.0.1', resolve));
    await expect(probe?.()).resolves.toEqual({ status: 'ok', reference: 'api-health-reachable' });

    for (const effect of effects) effect()();
    expect(registrations).toHaveLength(1);
    await close(replacement);
    await expect(probe?.()).resolves.toEqual({ status: 'degraded', reference: 'host-disposed' });
  });

  it('does not register new Host services during Cordis unload', async () => {
    const registrations: unknown[] = [];
    const effects: Array<() => () => void> = [];
    const files = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' }).files;
    const host = files.find((file) => file.path === 'workbench-host.js')?.content;
    if (!host) throw new Error('Expected Host entry');
    const hostModule = await import(`data:text/javascript,${encodeURIComponent(host)}`) as {
      apply: (ctx: {
        provide: (_name: string, value: unknown) => void;
        effect: (effect: () => () => void) => void;
        connection: { fetch: { register: (_route: unknown) => void } };
      }, config: Record<string, string>) => void;
    };
    let unloading = false;
    hostModule.apply({
      provide: (_name, value) => {
        if (unloading) throw new Error('cannot provide during unload');
        registrations.push(value);
      },
      effect: (effect) => effects.push(effect),
      connection: { fetch: { register: () => {} } },
    }, {
      package_identity: 'team-knowledge-workbench', package_version: '0.1.0',
      source_commit: '0123456789abcdef0123456789abcdef01234567',
      runtime_identity_digest: `sha256:${'a'.repeat(64)}`,
    });
    unloading = true;
    expect(() => effects[0]?.()()).not.toThrow();
    expect(registrations).toHaveLength(1);
  });

  it('registers only a read-only Connection-owned status route and rejects absent connection', async () => {
    const loaded = await loadHost({});
    const route = loaded.routes[0];
    expect(route).toMatchObject({
      path: '/api/team-knowledge-workbench.health', methods: ['GET'], requestBody: 'buffered',
    });
    expect(loaded.routes).toHaveLength(1);
    expect(route?.methods).not.toContain('POST');
    await expect(loaded.requestStatus('POST')).resolves.toBeUndefined();
    const response = await loaded.requestStatus();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(await response?.json()).toEqual({ status: 'unknown', reference: 'api-not-configured' });
    expect(loaded.registrations).toHaveLength(1);
    await expect(loadHost({}, false)).rejects.toThrow('DSH host requires Connection fetch service');
  });

  it('reads redacted status via the route through disconnect, recovery and unload', async () => {
    const api = createApiServer();
    const backendEndpoint = await listen(api);
    const loaded = await loadHost({ backendEndpoint });
    const read = async () => {
      const response = await loaded.requestStatus();
      expect(response?.status).toBe(200);
      expect(response?.headers.get('cache-control')).toBe('no-store');
      return response?.json();
    };
    expect(await read()).toEqual({ status: 'ok', reference: 'api-health-reachable' });
    await close(api);
    expect(await read()).toEqual({ status: 'degraded', reference: 'api-unavailable' });
    const replacement = createApiServer();
    servers.add(replacement);
    await new Promise<void>((resolve) => replacement.listen(Number(new URL(backendEndpoint).port), '127.0.0.1', resolve));
    expect(await read()).toEqual({ status: 'ok', reference: 'api-health-reachable' });
    const pendingResponse = loaded.requestStatus();
    for (const effect of loaded.effects) effect()();
    const finishedResponse = await pendingResponse;
    expect(await finishedResponse?.json()).toEqual({ status: 'degraded', reference: 'host-disposed' });
    await close(replacement);
    await expect(loaded.requestStatus()).resolves.toBeUndefined();
  });

  it('does not probe an absent or non-loopback endpoint', async () => {
    const unconfigured = await loadHost({});
    await expect(unconfigured.registrations[0]?.readiness.probe?.()).resolves.toEqual({
      status: 'unknown', reference: 'api-not-configured',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      for (const backendEndpoint of [
        'https://127.0.0.1:3000', 'http://localhost:3000', 'http://192.168.1.1:3000',
        'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000?secret=hidden',
        'http://user:pass@127.0.0.1:3000', 'http://127.0.0.1',
        'http://127.0.0.1:3000\\@external.example', 'http://127.0.0.1:3000/%2e%2e/',
      ]) {
        const { registrations } = await loadHost({ backendEndpoint });
        await expect(registrations[0]?.readiness.probe?.()).resolves.toEqual({
          status: 'unknown', reference: 'api-endpoint-invalid',
        });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects malformed or non-success health responses without exposing their contents', async () => {
    for (const [code, contentType, body] of [
      [503, 'application/json', '{"secret":"do-not-log"}'],
      [200, 'text/plain', '{"status":"ok"}'],
      [200, 'application/json', '{"status":"ready"}'],
      [200, 'application/json', '{"status":"ok","ready":true}'],
      [200, 'application/json', 'not-json'],
    ] as const) {
      const server = createServer((_request, response) => {
        response.writeHead(code, { 'content-type': contentType });
        response.end(body);
      });
      const { registrations } = await loadHost({ backendEndpoint: await listen(server) });
      await expect(registrations[0]?.readiness.probe?.()).resolves.toEqual({
        status: 'degraded', reference: 'api-health-invalid',
      });
      await close(server);
    }
  });

  it('does not follow a local health redirect to another destination', async () => {
    const destination = createServer((_request, response) => response.end('{"status":"ok"}'));
    const destinationEndpoint = await listen(destination);
    let destinationRequests = 0;
    destination.on('request', () => { destinationRequests += 1; });
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { location: `${destinationEndpoint}/healthz` });
      response.end();
    });
    const { registrations } = await loadHost({ backendEndpoint: await listen(redirect) });
    await expect(registrations[0]?.readiness.probe?.()).resolves.toEqual({
      status: 'degraded', reference: 'api-health-invalid',
    });
    expect(destinationRequests).toBe(0);
  });

  it('bounds a stalled health request and discards a late successful result after disposal', async () => {
    const responses: ServerResponse[] = [];
    const server = createServer((_request, response) => {
      responses.push(response);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
    });
    const { registrations, effects } = await loadHost({ backendEndpoint: await listen(server) });
    const probe = registrations[0]?.readiness.probe;
    await expect(probe?.()).resolves.toEqual({ status: 'degraded', reference: 'api-unavailable' });
    const pending = probe?.();
    await vi.waitFor(() => expect(responses.length).toBe(2));
    for (const effect of effects) effect()();
    responses[1]?.end('{"status":"ok"}');
    await expect(pending).resolves.toEqual({ status: 'degraded', reference: 'host-disposed' });
  });

  it('registers a visible client panel through the target Desktop slots', () => {
    const built = buildLocalPackage(buildWorkbenchPackageInput({
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    }));
    const manifest = JSON.parse(built.files.find((file) => file.path === 'package.json')?.content ?? '{}') as {
      exports?: Record<string, string>;
      dsh?: { client?: { platform?: string; inject?: string[] } };
    };
    const client = built.files.find((file) => file.path === 'client/index.js')?.content ?? '';
    const registrations: Array<{ name: string; key?: string; id?: string; label?: string }> = [];
    const components: Record<string, (props: { size?: number }) => unknown> = {};
    const elements: Array<{ tag: string; props: Record<string, unknown>; children: unknown[] }> = [];
    const slots = {
      inject: (_slot: string, register: () => unknown) => register(),
      register: (options: { name: string; key?: string; id?: string; label?: string }, component: unknown) => {
        expect(typeof component).toBe('function');
        registrations.push(options);
        components[options.name] = component as (props: { size?: number }) => unknown;
        return () => {};
      },
    };
    let clientModule: { inject?: string[]; apply?: (ctx: { slots: typeof slots }) => void } = {};
    runInNewContext(client, {
      window: { __ModuleLoader__: { load: ({ id, factory }: {
        id: string;
        factory: (require: (name: string) => unknown) => typeof clientModule;
      }) => {
        expect(id).toBe('@local/team-knowledge-workbench');
        clientModule = factory((name) => {
          if (name !== 'react') throw new Error(`unexpected client dependency: ${name}`);
          return { createElement: (tag: string, props: Record<string, unknown>, ...children: unknown[]) => {
            const element = { tag, props, children };
            elements.push(element);
            return element;
          } };
        });
      } } },
    });

    expect(manifest.exports?.['./client']).toBe('./client/index.js');
    expect(manifest.dsh?.client).toMatchObject({ platform: 'web', inject: expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ]) });
    expect(manifest.dsh?.client).not.toHaveProperty('external');
    expect(clientModule.inject).toContain('slots');
    clientModule.apply?.({ slots });
    expect(registrations).toEqual([
      { name: 'main', key: 'team-knowledge-workbench' },
      { name: 'sidebar.panellist', id: 'team-knowledge-workbench', label: 'Team Knowledge Workbench' },
    ]);
    components.main?.({});
    components['sidebar.panellist']?.({ size: 18 });
    expect(elements.some((element) => element.children.includes('team-knowledge-workbench'))).toBe(true);
    expect(elements.some((element) => element.children.includes('v0.1.0'))).toBe(true);
    expect(elements.some((element) => element.children.some((child) => typeof child === 'string' && child.includes('未验证')))).toBe(true);
    expect(client).not.toContain('desktopWorkbenches.register');
  });

  it('rejects a source commit that could alter generated module syntax', () => {
    expect(() => buildWorkbenchPackageInput({ sourceCommit: 'x'.repeat(40) })).toThrow(
      'source commit must be a 40-character lowercase Git commit',
    );
  });
});
