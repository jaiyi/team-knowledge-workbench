import { z } from 'zod';

import { createWorkbenchPlugin, type WorkbenchPluginContext } from './host-plugin.js';

const runtimeIdentityConfigSchema = z.strictObject({
  runtime_identity_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  package_identity: z.string().min(1),
  package_version: z.string().min(1),
  source_commit: z.string().regex(/^[0-9a-f]{40}$/),
});

export const apply = (context: WorkbenchPluginContext, config: unknown): void => {
  const parsedConfig = runtimeIdentityConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new Error('DSH host must provide the Workbench runtime identity');
  }

  const plugin = createWorkbenchPlugin({
    identity: parsedConfig.data,
    healthProbe: async () => ({ status: 'unknown', reference: 'health-probe-not-configured' }),
  });
  plugin.apply(context);
};
