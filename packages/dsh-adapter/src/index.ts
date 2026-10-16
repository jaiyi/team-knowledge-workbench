import { z } from 'zod';

import { createWorkbenchPlugin, type WorkbenchPluginContext } from './host-plugin.js';

const artifactConfigSchema = z.strictObject({
  artifact_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

const packageIdentity = {
  package_identity: 'team-knowledge-workbench',
  package_version: '0.1.0',
  source_commit: '0123456789abcdef0123456789abcdef01234567',
};

export const apply = (context: WorkbenchPluginContext, config: unknown): void => {
  const parsedConfig = artifactConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new Error('DSH host must provide the Workbench artifact digest');
  }

  const plugin = createWorkbenchPlugin({
    identity: { ...packageIdentity, artifact_digest: parsedConfig.data.artifact_digest },
    healthProbe: async () => ({ status: 'unknown', reference: 'health-probe-not-configured' }),
  });
  plugin.apply(context);
};
