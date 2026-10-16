import { execFile as executeFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { inspectLocalPackageArtifact, writeLocalPackageArtifact } from '../packages/distribution-adapter/src/local-package-artifact.js';
import { buildWorkbenchPackageInput } from '../packages/distribution-adapter/src/workbench-package-fixture.js';

const execFile = promisify(executeFile);

const readSourceCommit = async (): Promise<string> => {
  const result = await execFile('git', ['rev-parse', 'HEAD']);
  const sourceCommit = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error('git rev-parse HEAD did not return a valid commit');
  }
  return sourceCommit;
};

const main = async (): Promise<void> => {
  const outputDirectory = await mkdtemp(`${tmpdir()}/team-knowledge-workbench-`);
  const input = buildWorkbenchPackageInput({ sourceCommit: await readSourceCommit() });
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
