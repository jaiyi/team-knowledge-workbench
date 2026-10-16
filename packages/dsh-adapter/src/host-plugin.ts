import { z } from 'zod';

import { strictSemverSchema } from '../../../packages/validation/src/semver.js';

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const sourceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

const workbenchIdentitySchema = z.strictObject({
  package_identity: z.string().trim().min(1).max(200),
  package_version: strictSemverSchema,
  source_commit: sourceCommitSchema,
  runtime_identity_digest: digestSchema,
});

export type WorkbenchPluginIdentity = Readonly<z.infer<typeof workbenchIdentitySchema>>;

export type WorkbenchPluginHealth = Readonly<{
  status: 'ok' | 'degraded' | 'unknown';
  reference: string;
}>;

export type WorkbenchPluginRegistration = {
  kind: 'workbench';
  identity: WorkbenchPluginIdentity;
  readiness: Readonly<{ status: 'pending' | 'disposed' }>;
  lifecycle: 'active' | 'disposed';
};

export interface WorkbenchPluginContext {
  effect(dispose: () => void): void;
  register(registration: WorkbenchPluginRegistration): void;
}

export type WorkbenchPluginOptions = Readonly<{
  identity: WorkbenchPluginIdentity;
  healthProbe: () => Promise<WorkbenchPluginHealth>;
}>;

export type WorkbenchPlugin = Readonly<{
  apply(context: WorkbenchPluginContext): void;
  readiness(): Promise<WorkbenchPluginHealth>;
}>;

export const createWorkbenchPlugin = (options: WorkbenchPluginOptions): WorkbenchPlugin => {
  const parsedIdentity = workbenchIdentitySchema.safeParse(options.identity);
  if (!parsedIdentity.success) {
    throw new Error('invalid Workbench package identity');
  }

  let registration: WorkbenchPluginRegistration | undefined;
  let disposed = false;

  return {
    apply(context) {
      if (registration !== undefined) return;

      registration = {
        kind: 'workbench',
        identity: Object.freeze({ ...parsedIdentity.data }),
        readiness: Object.freeze({ status: 'pending' }),
        lifecycle: 'active',
      };
      context.register(registration);
      context.effect(() => {
        if (disposed) return;
        disposed = true;
        registration = Object.freeze({
          ...registration!,
          readiness: Object.freeze({ status: 'disposed' }),
          lifecycle: 'disposed',
        });
        context.register(registration);
      });
    },
    readiness: async () => {
      if (disposed) return { status: 'unknown', reference: 'plugin-disposed' };
      return options.healthProbe();
    },
  };
};
