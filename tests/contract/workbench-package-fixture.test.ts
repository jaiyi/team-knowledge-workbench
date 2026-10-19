import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildLocalPackage } from '../../packages/distribution-adapter/src/local-package-builder.js';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';

describe('Workbench package fixture', () => {
  it('contains a self-consistent Host bundle and runtime registration', () => {
    const input = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' });
    const built = buildLocalPackage(input);
    const server = built.files.find((file) => file.path === 'index.js');
    const manifest = built.files.find((file) => file.path === 'package.json');
    const registration = built.files.find((file) => file.path === 'cordis.patch.yml');

    expect(server?.content).toContain('export function apply(ctx, config = {})');
    expect(server?.content).toContain('DSH host Workbench runtime identity mismatch');
    expect(manifest?.content).toContain('"@local/team-knowledge-workbench"');
    expect(manifest?.content).toContain('"bundle": { "patch": "./cordis.patch.yml" }');
    expect(registration?.content).toContain('team-knowledge-workbench');
    expect(registration?.content).toContain('name: \'@local/team-knowledge-workbench\'');
    expect(registration?.content).toContain(`runtime_identity_digest: '${built.manifest.runtime_identity_digest}'`);
    expect(registration?.content).not.toContain('sha256:0000000000000000000000000000000000000000000000000000000000000000');
    expect(built.manifest.runtime_identity_digest).not.toBe(built.manifest.artifact_digest);
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
