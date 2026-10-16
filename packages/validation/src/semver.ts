import { z } from 'zod';
import semver from 'semver';

const canonicalSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const strictSemverSchema = z.string().refine(
  (value) => canonicalSemver.test(value) && semver.valid(value) !== null,
  {
    message: 'must be a canonical Semantic Version',
  },
);
