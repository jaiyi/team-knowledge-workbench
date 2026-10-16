import { createHash } from 'node:crypto';

import { isSafePackagePath, comparePackagePaths } from '../../../packages/validation/src/package-path.js';
import type { WorkbenchPackageManifest } from '../../../packages/validation/src/package.js';

export type PackageFile = Readonly<{
  path: string;
  content: string;
}>;

type ArtifactMetadata = Pick<
  WorkbenchPackageManifest,
  | 'package_identity'
  | 'package_version'
  | 'source_commit'
  | 'server_entry'
  | 'client_entry'
  | 'contract_evidence_level'
>;

const updateLengthPrefixed = (hash: ReturnType<typeof createHash>, value: string): void => {
  const bytes = Buffer.from(value, 'utf8');
  hash.update(Buffer.from(`${bytes.byteLength}:`, 'utf8'));
  hash.update(bytes);
};

export const canonicalizePackageFiles = (files: readonly PackageFile[]): readonly PackageFile[] => {
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    if (!isSafePackagePath(file.path)) throw new Error(`unsafe package path: ${file.path}`);
    if (seen.has(file.path)) throw new Error(`duplicate package path: ${file.path}`);
    seen.add(file.path);
    return { path: file.path, content: file.content };
  });

  return [...normalized].sort((left, right) => comparePackagePaths(left.path, right.path));
};

const updatePackageFiles = (
  hash: ReturnType<typeof createHash>,
  files: readonly PackageFile[],
): void => {
  canonicalizePackageFiles(files).forEach((file) => {
    updateLengthPrefixed(hash, file.path);
    updateLengthPrefixed(hash, file.content);
  });
};

export const computePackageDigest = (files: readonly PackageFile[]): `sha256:${string}` => {
  const hash = createHash('sha256');
  updatePackageFiles(hash, files);
  return `sha256:${hash.digest('hex')}`;
};

export const computeArtifactDigest = (
  files: readonly PackageFile[],
  metadata: ArtifactMetadata,
): `sha256:${string}` => {
  const hash = createHash('sha256');
  updatePackageFiles(hash, files);
  updateLengthPrefixed(hash, JSON.stringify({
    package_identity: metadata.package_identity,
    package_version: metadata.package_version,
    source_commit: metadata.source_commit,
    server_entry: metadata.server_entry,
    client_entry: metadata.client_entry,
    contract_evidence_level: metadata.contract_evidence_level,
  }));
  return `sha256:${hash.digest('hex')}`;
};
