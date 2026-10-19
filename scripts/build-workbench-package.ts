import { execFile as executeFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { inspectLocalPackageArtifact, writeLocalPackageArtifact } from '../packages/distribution-adapter/src/local-package-artifact.js';
import { buildWorkbenchPackageInput } from '../packages/distribution-adapter/src/workbench-package-fixture.js';

const execFile = promisify(executeFile);

export const readSourceCommit = async (cwd: string = process.cwd()): Promise<string> => {
  const status = await execFile('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd });
  if (status.stdout.trim()) {
    throw new Error('Workbench package requires a clean Git working tree');
  }
  const result = await execFile('git', ['rev-parse', 'HEAD'], { cwd });
  const sourceCommit = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('git rev-parse HEAD did not return a valid commit');
  }
  return sourceCommit;
};

export const parseBackendEndpoint = (args: readonly string[]): string | undefined => {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== '--backend-endpoint' || !args[1]) {
    throw new Error('Usage: package:workbench [--backend-endpoint http://127.0.0.1:<port>]');
  }
  return args[1];
};

const main = async (): Promise<void> => {
  const sourceCommit = await readSourceCommit(fileURLToPath(new URL('..', import.meta.url)));
  const backendEndpoint = parseBackendEndpoint(process.argv.slice(2));
  const input = buildWorkbenchPackageInput({
    sourceCommit,
    ...(backendEndpoint === undefined ? {} : { backendEndpoint }),
  });
  const outputDirectory = await mkdtemp(`${tmpdir()}/team-knowledge-workbench-`);
  const artifact = await writeLocalPackageArtifact(input, outputDirectory);
  const verification = await inspectLocalPackageArtifact(outputDirectory);
  if (!verification.ok) throw new Error(`artifact verification failed: ${verification.reason}`);

  process.stdout.write(`${JSON.stringify({
    output_directory: outputDirectory,
    package_identity: artifact.manifest.package_identity,
    package_version: artifact.manifest.package_version,
    source_commit: artifact.manifest.source_commit,
    artifact_digest: artifact.manifest.artifact_digest,
    payload_files: artifact.manifest.payload_files.map((file) => file.path),
    verification: 'passed',
    evidence_level: artifact.manifest.contract_evidence_level,
  }, null, 2)}\n`);
};

if (process.argv[1]?.endsWith('/scripts/build-workbench-package.ts')) {
  await main();
}
