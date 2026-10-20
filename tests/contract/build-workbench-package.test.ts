import { execFile as executeFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readSourceCommit, parseBackendEndpoint } from '../../scripts/build-workbench-package.js';

const execFile = promisify(executeFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const repository = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-source-'));
  directories.push(directory);
  const git = (...args: string[]) => execFile('git', args, { cwd: directory });
  await git('init', '-q');
  await writeFile(join(directory, 'source.txt'), 'original');
  await git('add', 'source.txt');
  await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'fixture');
  return { directory, git };
};

describe('Workbench artifact source provenance', () => {
  it('uses HEAD only for a clean repository and rejects tracked or untracked changes', async () => {
    const { directory, git } = await repository();
    const { stdout } = await git('rev-parse', 'HEAD');
    await expect(readSourceCommit(directory)).resolves.toBe(stdout.trim());

    await writeFile(join(directory, 'source.txt'), 'modified');
    await expect(readSourceCommit(directory)).rejects.toThrow('clean Git working tree');
    await git('restore', 'source.txt');
    await writeFile(join(directory, 'new.txt'), 'not committed');
    await expect(readSourceCommit(directory)).rejects.toThrow('clean Git working tree');
  });

  it('does not use the caller repository as the Workbench source', async () => {
    const { directory, git } = await repository();
    const callerCommit = (await git('rev-parse', 'HEAD')).stdout.trim();
    const script = fileURLToPath(new URL('../../scripts/build-workbench-package.ts', import.meta.url));
    const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
    const sourceCommit = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
    const node = process.execPath;
    const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
    const sourceStatus = (await execFile('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: repositoryRoot,
    })).stdout.trim();
    if (sourceStatus) {
      await expect(execFile(node, [tsx, script], { cwd: directory })).rejects.toThrow(
        'Workbench package requires a clean Git working tree',
      );
    } else {
      const { stdout } = await execFile(node, [tsx, script], { cwd: directory });
      const artifact = JSON.parse(stdout) as { source_commit: string; output_directory: string };
      directories.push(artifact.output_directory);
      expect(artifact.source_commit).toBe(sourceCommit);
      expect(artifact.source_commit).not.toBe(callerCommit);
    }
  });

  it('only accepts an explicit endpoint flag once', () => {
    expect(parseBackendEndpoint([])).toBeUndefined();
    expect(parseBackendEndpoint(['--backend-endpoint', 'http://127.0.0.1:3030']))
      .toBe('http://127.0.0.1:3030');
    expect(() => parseBackendEndpoint(['--backend-endpoint'])).toThrow();
    expect(() => parseBackendEndpoint(['--backend-endpoint', 'http://127.0.0.1:3030', '--backend-endpoint', 'http://127.0.0.1:4040'])).toThrow();
    expect(() => parseBackendEndpoint(['http://127.0.0.1:3030'])).toThrow();
  });
});
