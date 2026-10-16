import { describe, expect, it } from 'vitest';
import {
  readLocalPackageArtifact,
  verifyLocalPackageArtifact,
  writeLocalPackageArtifact,
} from '../../packages/distribution-adapter/src/local-package-artifact.js';

const input = {
  packageIdentity: 'team-knowledge-workbench',
  packageVersion: '0.1.0',
  sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  serverEntry: 'server/index.js',
  clientEntry: 'client/index.js',
  files: [
    { path: 'server/index.js', content: 'export const server = true;\n' },
    { path: 'client/index.js', content: 'export const client = true;\n' },
  ],
};

const temporaryDirectory = async (): Promise<string> => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  return mkdtemp(`${tmpdir()}/workbench-package-`);
};

describe('local package artifact', () => {
  it('writes and verifies a deterministic manifest and payload', async () => {
    const outputDir = await temporaryDirectory();
    const written = await writeLocalPackageArtifact(input, outputDir);
    const loaded = await readLocalPackageArtifact(outputDir);

    expect(loaded.manifest).toEqual(written.manifest);
    expect(verifyLocalPackageArtifact(loaded)).toEqual({ ok: true, manifest: written.manifest });
  });

  it('rejects tampered payload content', async () => {
    const outputDir = await temporaryDirectory();
    await writeLocalPackageArtifact(input, outputDir);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${outputDir}/server/index.js`, 'tampered\n', 'utf8');
    const loaded = await readLocalPackageArtifact(outputDir);

    expect(verifyLocalPackageArtifact(loaded)).toMatchObject({ ok: false, reason: 'payload digest mismatch' });
  });

  it('rejects symlinked payload files instead of reading outside the artifact', async () => {
    const outputDir = await temporaryDirectory();
    await writeLocalPackageArtifact(input, outputDir);
    const { rm, symlink } = await import('node:fs/promises');
    await rm(`${outputDir}/server/index.js`);
    await symlink('/etc/hosts', `${outputDir}/server/index.js`);

    await expect(readLocalPackageArtifact(outputDir)).rejects.toThrow(/regular file|symbolic links|outside/i);
  });

  it('rejects tampered manifest metadata', async () => {
    const outputDir = await temporaryDirectory();
    await writeLocalPackageArtifact(input, outputDir);
    const { readFile, writeFile } = await import('node:fs/promises');
    const manifestPath = `${outputDir}/manifest.json`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.package_version = '9.9.9';
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const loaded = await readLocalPackageArtifact(outputDir);
    expect(verifyLocalPackageArtifact(loaded)).toMatchObject({
      ok: false,
      reason: 'artifact digest mismatch',
    });
  });

  it('rejects an artifact written into a non-empty directory', async () => {
    const outputDir = await temporaryDirectory();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${outputDir}/existing.txt`, 'existing\n', 'utf8');

    await expect(writeLocalPackageArtifact(input, outputDir)).rejects.toThrow(
      'artifact output directory must be empty',
    );
  });
});
