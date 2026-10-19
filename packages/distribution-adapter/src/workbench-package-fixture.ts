import { computeRuntimeIdentityDigest } from './canonical-digest.js';
import type { LocalPackageBuildInput } from './local-package-builder.js';

const packageIdentity = 'team-knowledge-workbench';
const packageVersion = '0.1.0';

const packageManifest = `{
  "name": "@local/team-knowledge-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client/index.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"]
    }
  }
}\n`;

const buildServerEntry = (sourceCommit: string): string => {
  const runtimeIdentityDigest = computeRuntimeIdentityDigest({
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: sourceCommit,
  });
  return `import { apply as workbenchHostApply } from './workbench-host.js';

export const packageIdentity = '${packageIdentity}';
export const packageVersion = '${packageVersion}';
export function apply(ctx, config = {}) {
  const expected = {
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: '${sourceCommit}',
    runtime_identity_digest: '${runtimeIdentityDigest}',
  };
  for (const [key, value] of Object.entries(config)) {
    if (key in expected && value !== expected[key]) {
      throw new Error('DSH host Workbench runtime identity mismatch');
    }
  }
  return workbenchHostApply(ctx, expected);
}
`;
};

const hostEntry = `const digestPattern = /^sha256:[0-9a-f]{64}$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;

export function apply(ctx, config) {
  if (
    config === null || typeof config !== 'object' ||
    typeof config.package_identity !== 'string' ||
    typeof config.package_version !== 'string' ||
    typeof config.source_commit !== 'string' ||
    typeof config.runtime_identity_digest !== 'string' ||
    !sourceCommitPattern.test(config.source_commit) ||
    !digestPattern.test(config.runtime_identity_digest)
  ) {
    throw new Error('DSH host must provide the Workbench runtime identity');
  }

  const identity = Object.freeze({
    package_identity: config.package_identity,
    package_version: config.package_version,
    source_commit: config.source_commit,
    runtime_identity_digest: config.runtime_identity_digest,
  });
  const registration = Object.freeze({
    kind: 'workbench',
    identity,
    readiness: Object.freeze({ status: 'pending' }),
    lifecycle: 'active',
  });
  if (typeof ctx.provide === 'function') ctx.provide('workbenchIdentity', registration);
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (typeof ctx.provide === 'function') {
        ctx.provide('workbenchIdentity', Object.freeze({
          ...registration,
          readiness: Object.freeze({ status: 'disposed' }),
          lifecycle: 'disposed',
        }));
      }
    }, 'team-knowledge-workbench lifecycle');
  }
}
`;

const buildClientEntry = (): string => `window.__ModuleLoader__.load({
  id: '@local/${packageIdentity}',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const panelId = '${packageIdentity}';

    function WorkbenchPanel() {
      return React.createElement('main', {
        style: { padding: 'var(--dsh-frame-top-clearance, 48px) 24px 24px' },
      },
        React.createElement('h1', null, panelId),
        React.createElement('p', null, 'v${packageVersion}'),
        React.createElement('p', null, '状态：未验证'),
      );
    }

    function WorkbenchIcon({ size }) {
      return React.createElement('span', {
        style: { fontSize: size, fontWeight: 'bold' },
        'aria-hidden': 'true',
      }, 'W');
    }

    module.exports.inject = ['slots'];
    module.exports.apply = (ctx) => {
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: panelId,
      }, WorkbenchPanel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: panelId, label: 'Team Knowledge Workbench',
      }, WorkbenchIcon));
    };
    return module.exports;
  },
});
`;

const buildCordisRegistration = (sourceCommit: string): string => {
  const runtimeIdentityDigest = computeRuntimeIdentityDigest({
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: sourceCommit,
  });
  return `# Candidate fixture: verify registration fields against the pinned DSH loader before install.\n- insert:\n    - id: ${packageIdentity}\n      name: '@local/${packageIdentity}'\n      config:\n        package_identity: '${packageIdentity}'\n        package_version: '${packageVersion}'\n        source_commit: '${sourceCommit}'\n        runtime_identity_digest: '${runtimeIdentityDigest}'\n`;
};

export type WorkbenchPackageFixtureInput = Readonly<{
  sourceCommit: string;
}>;

export const buildWorkbenchPackageInput = (
  input: WorkbenchPackageFixtureInput,
): LocalPackageBuildInput => {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('source commit must be a 40-character lowercase Git commit');
  }

  return {
  packageIdentity,
  packageVersion,
  sourceCommit: input.sourceCommit,
  serverEntry: 'index.js',
  clientEntry: 'client/index.js',
  files: [
    { path: 'package.json', content: packageManifest },
    { path: 'index.js', content: buildServerEntry(input.sourceCommit) },
    { path: 'workbench-host.js', content: hostEntry },
    { path: 'client/index.js', content: buildClientEntry() },
    { path: 'cordis.patch.yml', content: buildCordisRegistration(input.sourceCommit) },
  ],
  };
};
