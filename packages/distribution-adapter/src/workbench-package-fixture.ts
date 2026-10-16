import type { LocalPackageBuildInput } from './local-package-builder.js';

const packageManifest = `{
  "name": "@local/team-knowledge-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}\n`;
const serverEntry = `export const packageIdentity = 'team-knowledge-workbench';\nexport const packageVersion = '0.1.0';\nexport function apply(ctx) {\n  ctx.effect(() => undefined);\n}\n`;
const clientEntry = `export const packageIdentity = 'team-knowledge-workbench';\nexport const client = true;\n`;
const cordisRegistration = `# Candidate fixture: verify registration fields against the pinned DSH loader before install.\n- insert:\n    - id: team-knowledge-workbench\n      name: '@local/team-knowledge-workbench'\n      config:\n        artifact_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'\n`;

export type WorkbenchPackageFixtureInput = Readonly<{
  sourceCommit: string;
}>;

export const buildWorkbenchPackageInput = (
  input: WorkbenchPackageFixtureInput,
): LocalPackageBuildInput => ({
  packageIdentity: 'team-knowledge-workbench',
  packageVersion: '0.1.0',
  sourceCommit: input.sourceCommit,
  serverEntry: 'index.js',
  clientEntry: 'client/index.js',
  files: [
    { path: 'package.json', content: packageManifest },
    { path: 'index.js', content: serverEntry },
    { path: 'client/index.js', content: clientEntry },
    { path: 'cordis.patch.yml', content: cordisRegistration },
  ],
});
