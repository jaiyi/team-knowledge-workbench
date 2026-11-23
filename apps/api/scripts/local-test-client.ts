import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const mode = process.argv[2];
if (mode !== 'memberA' && mode !== 'memberB' && mode !== 'isolation-check') {
  throw new Error('Choose memberA, memberB or isolation-check');
}
const origin = process.env.WORKBENCH_TEST_ORIGIN ?? 'http://127.0.0.1:3407';
const url = new URL(origin);
if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
  throw new Error('A canonical loopback TEST origin is required');
}
const hostId = randomBytes(32).toString('base64url');
const environment = 'isolated-test';
const post = async (path: string, payload: object, session?: string) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}`, 'x-workbench-host': hostId } : {}) },
  body: JSON.stringify(payload),
});
const context = (session: string, team?: string, space?: string) => fetch(
  `${origin}/v1/context${team && space ? `?teamId=${team}&assetSpaceId=${space}` : ''}`,
  { headers: { authorization: `Bearer ${session}`, 'x-workbench-host': hostId } },
);
const expectStatus = (response: Response, status: number, label: string) => {
  if (response.status !== status) throw new Error(`${label}: expected ${status}, got ${response.status}`);
  process.stdout.write(`${label}: ${status}\n`);
};
const sessions = new Set<string>();
const cli = createInterface({ input: stdin, output: stdout });
async function login(member: 'memberA' | 'memberB') {
  const claimSecret = randomBytes(32).toString('base64url');
  const started = await post('/test-identity/attempts', { account: member, hostId, claimSecret, environment });
  if (started.status !== 201) throw new Error('TEST login could not start');
  const attempt = await started.json() as { attemptId: string; loginPath: string };
  process.stdout.write(`请在 3 分钟内用系统浏览器打开 ${origin}${attempt.loginPath} 并以 ${member} 登录；客户端正在等待领取。\n`);
  let claimed: Response | undefined;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await post(`/test-identity/attempts/${attempt.attemptId}/claim`, { hostId, claimSecret, environment });
    if (response.status === 200) { claimed = response; break; }
    if (response.status !== 403) throw new Error('TEST login claim failed');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!claimed) throw new Error('TEST login not completed within 3 minutes');
  const session = (await claimed.json() as { sessionHandle: string }).sessionHandle;
  sessions.add(session);
  return session;
}
async function readSpaces(session: string, expected: string) {
  const response = await context(session);
  expectStatus(response, 200, '当前空间读取');
  const result = await response.json() as { spaces: Array<{ teamId: string; assetSpaceId: string }> };
  const spaces = result.spaces.map((space) => `${space.teamId}/${space.assetSpaceId}`);
  if (spaces.length !== 1 || spaces[0] !== expected) throw new Error('TEST space isolation mismatch');
  process.stdout.write(`当前可访问空间：${spaces[0]}\n`);
}
async function logout(session: string) {
  const response = await post('/test-identity/logout', {}, session);
  if (response.status !== 204) throw new Error('TEST logout was not confirmed');
  sessions.delete(session);
}
try {
  if (mode === 'isolation-check') {
    const first = await login('memberA');
    await readSpaces(first, 'team-a/space-a');
    expectStatus(await context(first, 'team-b', 'space-b'), 403, 'A 跨空间拒绝');
    const second = await login('memberB');
    expectStatus(await context(first), 401, '切号后 A 旧会话拒绝');
    sessions.delete(first);
    await readSpaces(second, 'team-b/space-b');
    expectStatus(await context(second, 'team-a', 'space-a'), 403, 'B 跨空间拒绝');
    await logout(second);
    expectStatus(await context(second), 401, 'B 登出后旧会话拒绝');
  } else {
    const session = await login(mode);
    const response = await context(session);
    if (response.status !== 200) throw new Error('No authorized context');
    const result = await response.json() as { spaces: Array<{ teamId: string; assetSpaceId: string }> };
    process.stdout.write(`当前可访问空间：${result.spaces.map((space) => `${space.teamId}/${space.assetSpaceId}`).join(', ') || '无'}\n`);
    await cli.question('按 Enter 登出并撤销测试会话：');
    await logout(session);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'TEST login failed'}\n`);
  process.exitCode = 1;
} finally {
  for (const session of sessions) {
    try {
      const response = await post('/test-identity/logout', {}, session);
      if (response.status !== 204 && response.status !== 401) throw new Error('TEST logout was not confirmed');
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'TEST logout failed'}\n`);
      process.exitCode = 1;
    }
  }
  cli.close();
}
