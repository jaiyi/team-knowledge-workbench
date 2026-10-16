import { z } from 'zod';
import { isSafePackagePath } from './package-path.js';
import { strictSemverSchema } from './semver.js';

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const sourceCommit = z.string().regex(/^[0-9a-f]{40}$/);
const safeRelativePath = z.string().min(1).max(500).refine(
  isSafePackagePath,
  { message: 'must be a safe relative POSIX path' },
);

export const workbenchPackageManifestSchema = z.strictObject({
  package_identity: z.string().trim().min(1).max(200),
  package_version: strictSemverSchema,
  source_commit: sourceCommit,
  server_entry: safeRelativePath,
  client_entry: safeRelativePath,
  payload_files: z.array(z.strictObject({ path: safeRelativePath, digest })).min(1),
  artifact_digest: digest,
  runtime_identity_digest: digest,
  contract_evidence_level: z.enum(['fact', 'candidate', 'pending_checks', 'warning']),
}).superRefine((manifest, context) => {
  const paths = new Set<string>();
  manifest.payload_files.forEach((file, index) => {
    if (paths.has(file.path)) {
      context.addIssue({ code: 'custom', path: ['payload_files', index, 'path'], message: 'payload path must be unique' });
    }
    paths.add(file.path);
  });
  if (!paths.has(manifest.server_entry)) {
    context.addIssue({ code: 'custom', path: ['server_entry'], message: 'server entry must be included in payload files' });
  }
  if (!paths.has(manifest.client_entry)) {
    context.addIssue({ code: 'custom', path: ['client_entry'], message: 'client entry must be included in payload files' });
  }
});

export type WorkbenchPackageManifest = z.infer<typeof workbenchPackageManifestSchema>;
