import {
  canonicalizePackageFiles,
  computeArtifactDigest,
  computePackageDigest,
  type PackageFile,
} from './canonical-digest.js';
import { workbenchPackageManifestSchema, type WorkbenchPackageManifest } from '../../../packages/validation/src/package.js';

export type LocalPackageBuildInput = Readonly<{
  packageIdentity: string;
  packageVersion: string;
  sourceCommit: string;
  serverEntry: string;
  clientEntry: string;
  files: readonly PackageFile[];
}>;

export type LocalPackageBuildResult = Readonly<{
  manifest: WorkbenchPackageManifest;
  files: readonly PackageFile[];
}>;

export const buildLocalPackage = (input: LocalPackageBuildInput): LocalPackageBuildResult => {
  const files = canonicalizePackageFiles(input.files);
  const metadata = {
    package_identity: input.packageIdentity,
    package_version: input.packageVersion,
    source_commit: input.sourceCommit,
    server_entry: input.serverEntry,
    client_entry: input.clientEntry,
    contract_evidence_level: 'pending_checks' as const,
  };
  const artifactDigest = computeArtifactDigest(files, metadata);
  const manifest = workbenchPackageManifestSchema.parse({
    ...metadata,
    payload_files: files.map((file) => ({
      path: file.path,
      digest: computePackageDigest([file]),
    })),
    artifact_digest: artifactDigest,
  });

  return { manifest, files };
};
