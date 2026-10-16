import { describe, expect, it } from 'vitest';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';

describe('Workbench package fixture', () => {
  it('contains an official Host bundle manifest and candidate cordis registration', () => {
    const input = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' });
    const server = input.files.find((file) => file.path === 'index.js');
    const manifest = input.files.find((file) => file.path === 'package.json');
    const registration = input.files.find((file) => file.path === 'cordis.patch.yml');

    expect(server?.content).toContain('export function apply(ctx)');
    expect(manifest?.content).toContain('"@local/team-knowledge-workbench"');
    expect(manifest?.content).toContain('"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }');
    expect(registration?.content).toContain('team-knowledge-workbench');
    expect(registration?.content).toContain('name: \'@local/team-knowledge-workbench\'');
    expect(registration?.content).toContain('artifact_digest:');
  });
});
