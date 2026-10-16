import { describe, expect, it } from 'vitest';
import {
  createWorkbenchPlugin,
  type WorkbenchPluginContext,
  type WorkbenchPluginHealth,
} from '../../packages/dsh-adapter/src/host-plugin.js';

const identity = {
  package_identity: 'team-knowledge-workbench',
  package_version: '0.1.0',
  source_commit: '0123456789abcdef0123456789abcdef01234567',
  runtime_identity_digest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
};

const createContext = () => {
  const disposers: Array<() => void> = [];
  const registrations: unknown[] = [];
  const context: WorkbenchPluginContext = {
    effect(dispose) {
      disposers.push(dispose);
    },
    register(registration) {
      registrations.push(registration);
    },
  };
  return { context, disposers, registrations };
};

describe('Workbench DSH host plugin', () => {
  it('registers a redacted identity and readiness probe through the host context', async () => {
    const { context, registrations } = createContext();
    const health: WorkbenchPluginHealth = { status: 'ok', reference: 'fake-health-1' };
    const plugin = createWorkbenchPlugin({ identity, healthProbe: async () => health });

    plugin.apply(context);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      kind: 'workbench',
      identity,
      readiness: { status: 'pending' },
    });

    await expect(plugin.readiness()).resolves.toEqual(health);
    expect(JSON.stringify(registrations)).not.toContain('secret');
  });

  it('reports backend degradation without converting it to success', async () => {
    const { context } = createContext();
    const plugin = createWorkbenchPlugin({
      identity,
      healthProbe: async () => ({ status: 'degraded', reference: 'api-unavailable' }),
    });

    plugin.apply(context);

    await expect(plugin.readiness()).resolves.toEqual({
      status: 'degraded',
      reference: 'api-unavailable',
    });
  });

  it('registers cleanup and makes disposal idempotent', () => {
    const { context, disposers, registrations } = createContext();
    const plugin = createWorkbenchPlugin({ identity, healthProbe: async () => ({ status: 'ok', reference: 'x' }) });

    plugin.apply(context);
    expect(disposers).toHaveLength(1);
    disposers[0]!();
    disposers[0]!();
    expect(registrations[1]).toMatchObject({ kind: 'workbench', lifecycle: 'disposed' });
  });

  it('does not run readiness probes after disposal', async () => {
    const { context, disposers } = createContext();
    let probes = 0;
    const plugin = createWorkbenchPlugin({
      identity,
      healthProbe: async () => {
        probes += 1;
        return { status: 'ok', reference: 'healthy' };
      },
    });

    plugin.apply(context);
    disposers[0]!();

    await expect(plugin.readiness()).resolves.toEqual({
      status: 'unknown',
      reference: 'plugin-disposed',
    });
    expect(probes).toBe(0);
  });

  it('accepts the runtime identity digest supplied by the host config', async () => {
    const { context, registrations } = createContext();
    const runtimeDigest = `sha256:${'b'.repeat(64)}` as `sha256:${string}`;
    const plugin = createWorkbenchPlugin({
      identity: { ...identity, runtime_identity_digest: runtimeDigest },
      healthProbe: async () => ({ status: 'unknown', reference: 'not-configured' }),
    });

    plugin.apply(context);

    expect(registrations[0]).toMatchObject({
      identity: { runtime_identity_digest: runtimeDigest },
    });
  });


  it('rejects an identity with a malformed digest before registration', () => {
    const { context, registrations } = createContext();

    expect(() => createWorkbenchPlugin({
      identity: { ...identity, runtime_identity_digest: 'not-a-digest' as `sha256:${string}` },
      healthProbe: async () => ({ status: 'ok', reference: 'x' }),
    })).toThrow('invalid Workbench package identity');
    expect(registrations).toHaveLength(0);
  });
});
