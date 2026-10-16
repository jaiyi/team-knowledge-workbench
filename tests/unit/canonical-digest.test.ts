import { describe, expect, it } from 'vitest';
import {
  canonicalizePackageFiles,
  computePackageDigest,
} from '../../packages/distribution-adapter/src/canonical-digest.js';

describe('canonical package digest', () => {
  const files: ReadonlyArray<{ path: string; content: string }> = [
    { path: 'client/index.js', content: 'export const client = true;\n' },
    { path: 'server/index.js', content: 'export const server = true;\n' },
  ];

  it('is independent of file order', () => {
    expect(computePackageDigest(files)).toBe(
      computePackageDigest([...files].reverse()),
    );
  });

  it('changes when payload bytes change', () => {
    expect(computePackageDigest(files)).not.toBe(
      computePackageDigest([
        files[0]!,
        { ...files[1]!, content: 'export const server = false;\n' },
      ]),
    );
  });

  it('rejects unsafe and duplicate paths', () => {
    expect(() => canonicalizePackageFiles([{ path: '../secret', content: 'x' }])).toThrow(
      'unsafe package path',
    );
    expect(() =>
      canonicalizePackageFiles([
        { path: 'server/index.js', content: 'x' },
        { path: 'server/index.js', content: 'y' },
      ]),
    ).toThrow('duplicate package path');
  });

  it('rejects platform-specific and encoded traversal paths', () => {
    for (const path of ['C:/Windows/evil.js', 'C:evil.js', '//server/share.js', '%2e%2e/secret.js']) {
      expect(() => canonicalizePackageFiles([{ path, content: 'x' }])).toThrow(
        'unsafe package path',
      );
    }
  });

  it('uses deterministic byte ordering for Unicode paths', () => {
    const combining = { path: 'ä/file.js', content: 'x' };
    const composed = { path: 'ä/file.js', content: 'y' };
    expect(computePackageDigest([combining, composed])).toBe(
      computePackageDigest([composed, combining]),
    );
  });
});
