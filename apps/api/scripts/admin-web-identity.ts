import { Pool } from 'pg';
import { provisionWebIdentity } from '../src/application/provision-web-identity.js';

type Grant = Readonly<{ teamId: string; assetSpaceId: string; role: 'owner' | 'steward' | 'reviewer' | 'publisher' }>;
type Request = Readonly<{ issuer: string; subject: string; principalId: string }> & (
  Readonly<{ action: 'provision'; grants: Grant[] }> | Readonly<{ action: 'disable' }>);

export function parseAdminRequest(text: string, args: string[]): { request: Request; apply: boolean } {
  if (!(args.length === 0 || args.length === 1 && args[0] === '--dry-run'
    || args.length === 2 && args[0] === '--apply' && args[1] === '--confirm-test-only')) {
    throw new Error('Confirmation required');
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid admin request');
  const input = value as Record<string, unknown>;
  const provision = input.action === 'provision';
  if (!['provision', 'disable'].includes(String(input.action))
    || Object.keys(input).sort().join(',') !== (provision
      ? 'action,grants,issuer,principalId,subject' : 'action,issuer,principalId,subject')
    || !['issuer', 'subject', 'principalId'].every((key) => typeof input[key] === 'string')) {
    throw new Error('Invalid admin request');
  }
  if (provision && (!Array.isArray(input.grants) || !input.grants.length
    || input.grants.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'assetSpaceId,role,teamId'
      || !Object.values(item).every((field) => typeof field === 'string' && field.trim())))) {
    throw new Error('Invalid admin request');
  }
  return { request: input as Request, apply: args[0] === '--apply' };
}

async function main() {
  if (process.env.WORKBENCH_ADMIN_TEST_ONLY !== '1' || !process.env.WORKBENCH_ADMIN_DATABASE_URL) {
    throw new Error('Approved test environment required');
  }
  let text = '';
  for await (const chunk of process.stdin) text += chunk.toString();
  const { request, apply } = parseAdminRequest(text, process.argv.slice(2));
  const url = new URL(process.env.WORKBENCH_ADMIN_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password
    || url.searchParams.get('sslmode') !== 'verify-full' || url.searchParams.getAll('sslmode').length !== 1
    || [...url.searchParams.keys()].some((key) => key !== 'sslmode')) {
    throw new Error('Verified PostgreSQL TLS required');
  }
  const database = new Pool({ connectionString: url.href, max: 1 });
  try {
    const result = await provisionWebIdentity(database, request, apply);
    process.stdout.write(`${result.action}: ${result.outcome}\n`);
  } finally {
    await database.end();
  }
}

if (process.argv[1]?.endsWith('/apps/api/scripts/admin-web-identity.ts')) {
  main().catch(() => {
    process.stderr.write('Administrator binding failed; review approved input and database state\n');
    process.exitCode = 1;
  });
}
