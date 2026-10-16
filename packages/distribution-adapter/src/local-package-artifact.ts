import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import {
  buildLocalPackage,
  type LocalPackageBuildInput,
  type LocalPackageBuildResult,
} from './local-package-builder.js';
import { canonicalizePackageFiles, computeArtifactDigest, computePackageDigest, type PackageFile } from './canonical-digest.js';
import { workbenchPackageManifestSchema } from '../../../packages/validation/src/package.js';

const manifestFileName = 'manifest.json';

export type LocalPackageArtifact = Readonly<{
  manifest: LocalPackageBuildResult['manifest'];
  files: readonly PackageFile[];
}>;

export type ArtifactVerificationResult =
  | Readonly<{ ok: true; manifest: LocalPackageArtifact['manifest'] }>
  | Readonly<{ ok: false; reason: string }>;

const withinDirectory = (root: string, candidate: string): boolean => (
  candidate === root || candidate.startsWith(`${root}${sep}`)
);

const artifactPath = (root: string, path: string): string => {
  const candidate = resolve(root, path);
  if (!withinDirectory(resolve(root), candidate)) {
    throw new Error(`artifact path escapes output directory: ${path}`);
  }
  return candidate;
};

const assertRegularPath = async (root: string, relativePath: string): Promise<void> => {
  let current = root;
  for (const component of relativePath.split('/')) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed: ${relativePath}`);
    }
  }
};

const readRegularFile = async (root: string, relativePath: string): Promise<string> => {
  const path = artifactPath(root, relativePath);
  await assertRegularPath(root, relativePath);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`artifact payload must be a regular file: ${path}`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
};

const readPayloadFiles = async (root: string, paths: readonly string[]): Promise<readonly PackageFile[]> => {
  const files = await Promise.all(paths.map(async (path) => ({
    path,
    content: await readRegularFile(root, path),
  })));
  return canonicalizePackageFiles(files);
};

const listPayloadFiles = async (root: string): Promise<readonly string[]> => {
  const entries: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${child.name}`);
      if (child.isDirectory()) {
        await visit(childPath);
      } else if (child.isFile() && child.name !== manifestFileName) {
        entries.push(relative(root, childPath).split(sep).join('/'));
      }
    }
  };
  await visit(root);
  return entries.sort();
};

export const writeLocalPackageArtifact = async (
  input: LocalPackageBuildInput,
  outputDirectory: string,
): Promise<LocalPackageArtifact> => {
  const built = buildLocalPackage(input);
  const root = resolve(outputDirectory);
  await mkdir(root, { recursive: true });
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory()) throw new Error('artifact output path must be a directory');
  const existing = await readdir(root);
  if (existing.length > 0) throw new Error('artifact output directory must be empty');

  await Promise.all(built.files.map(async (file) => {
    const destination = artifactPath(root, file.path);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
  }));
  await writeFile(join(root, manifestFileName), `${JSON.stringify(built.manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { manifest: built.manifest, files: built.files };
};

export const readLocalPackageArtifact = async (outputDirectory: string): Promise<LocalPackageArtifact> => {
  const root = resolve(outputDirectory);
  await assertRegularPath(root, manifestFileName);
  const manifest = workbenchPackageManifestSchema.parse(JSON.parse(await readRegularFile(root, manifestFileName)));
  const files = await readPayloadFiles(root, manifest.payload_files.map((file) => file.path));
  return { manifest, files };
};

export const verifyLocalPackageArtifact = (artifact: LocalPackageArtifact): ArtifactVerificationResult => {
  try {
    const manifest = workbenchPackageManifestSchema.parse(artifact.manifest);
    const files = canonicalizePackageFiles(artifact.files);
    const manifestPaths = manifest.payload_files.map((file) => file.path);
    if (files.length !== manifestPaths.length || files.some((file, index) => file.path !== manifestPaths[index])) {
      return { ok: false, reason: 'unexpected payload file' };
    }
    for (const file of files) {
      const expected = manifest.payload_files.find((entry) => entry.path === file.path);
      if (expected === undefined || computePackageDigest([file]) !== expected.digest) {
        return { ok: false, reason: 'payload digest mismatch' };
      }
    }
    if (computeArtifactDigest(files, manifest) !== manifest.artifact_digest) {
      return { ok: false, reason: 'artifact digest mismatch' };
    }
    return { ok: true, manifest };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'artifact verification failed' };
  }
};

export const inspectLocalPackageArtifact = async (outputDirectory: string): Promise<ArtifactVerificationResult> => {
  const root = resolve(outputDirectory);
  const artifact = await readLocalPackageArtifact(root);
  const listed = await listPayloadFiles(root);
  const declared = artifact.manifest.payload_files.map((file) => file.path).sort();
  if (listed.length !== declared.length || listed.some((path, index) => path !== declared[index])) {
    return { ok: false, reason: 'unexpected payload file' };
  }
  return verifyLocalPackageArtifact(artifact);
};

export type { LocalPackageBuildInput };
